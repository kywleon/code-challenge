# Problem 6: Implementation Comments & Improvement Suggestions

## Overview

This document provides detailed comments, best practices, and suggested improvements for the Real-time Scoreboard API.

---

## 1. Code Comments & Implementation Notes

### 1.1 JWT Token Validation (Middleware)

```typescript
/**
 * Middleware: Validate JWT token from request headers
 *
 * IMPORTANT NOTES:
 * - ALWAYS verify signature using the SECRET_KEY (never trust the payload alone)
 * - Check token expiration; do not accept expired tokens
 * - Consider maintaining a token blacklist for revoked tokens
 * - For critical operations, re-verify token signature against database
 *
 * POTENTIAL ISSUE:
 * - Token lifetime too long (>24h) increases compromise window
 * - Recommendation: Short-lived tokens (15-60 min) + refresh token flow
 *
 * OPTIMIZATION:
 * - Cache public key if using RS256 (asymmetric signing)
 * - Consider stateless token validation for horizontal scaling
 */
export const validateJWT = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    // SECURITY: Use algorithm whitelist to prevent 'none' algorithm exploit
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ["HS256"], // Explicitly allow only HS256
    });
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Invalid token", details: err.message });
  }
};
```

### 1.2 Action Completion Handler

```typescript
/**
 * Handler: Complete user action and update score
 *
 * CRITICAL SECURITY CHECKS:
 * 1. User ID from JWT must match action's user ID (prevent cross-user attacks)
 * 2. Action ID must be pre-registered (no arbitrary score values)
 * 3. Cooldown check: User cannot complete same action within N seconds
 * 4. Idempotency: Duplicate requests should NOT double the score
 *
 * DATABASE TRANSACTION:
 * - Use BEGIN/COMMIT/ROLLBACK to ensure atomicity
 * - If any insert fails, entire transaction rolls back (no partial updates)
 * - Prevents: User score update succeeds but audit log fails
 *
 * RACE CONDITION PREVENTION:
 * - Lock the user row during update: SELECT ... FOR UPDATE
 * - Prevents: Two concurrent requests both reading old score = score duplication
 *
 * FRAUD DETECTION:
 * - Check if score jump is physically possible
 * - Example: User earned 10 pts/sec for 60 seconds = 600 max pts, but claims 5000
 * - Flag this as suspicious for admin review (but still allow)
 *
 * LOGGING:
 * - Log successful updates with: userId, actionId, score delta, timestamp, IP
 * - Log failed attempts with same details + reason for failure
 * - Enable investigation of fraud attempts
 */
export const completeAction = async (req: Request, res: Response) => {
  const { actionId } = req.body;
  const userId = req.userId; // From JWT

  // ✓ IMPORTANT: Validate action exists and get reward amount
  const action = await Action.findById(actionId);
  if (!action) {
    return res.status(400).json({ error: "Invalid action" });
  }

  // ✓ IMPORTANT: Check cooldown to prevent spam
  const lastCompletion = await UserActionCompletion.findOne({
    where: { userId, actionId },
    order: { completedAt: "DESC" },
  });

  if (lastCompletion && Date.now() - lastCompletion.completedAt < 5000) {
    return res.status(409).json({
      error: "Action on cooldown",
      nextAvailableAt: new Date(lastCompletion.completedAt.getTime() + 5000),
    });
  }

  // ✓ IMPORTANT: Use database transaction
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // ✓ IMPORTANT: Lock user row to prevent race conditions
    const user = await queryRunner.query(
      "SELECT * FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );

    const oldScore = user[0].total_score;
    const newScore = oldScore + action.scoreReward;

    // Fraud check: Is score jump suspicious?
    const isProbable = isSuspiciousJump(userId, newScore, oldScore, action);

    // Update score
    await queryRunner.query(
      "UPDATE users SET total_score = $1, updated_at = NOW() WHERE id = $2",
      [newScore, userId],
    );

    // Log completion
    await queryRunner.query(
      `INSERT INTO user_action_completions (id, user_id, action_id, score_earned, completed_at, client_ip)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [generateUUID(), userId, actionId, action.scoreReward, req.ip],
    );

    // Audit log
    await queryRunner.query(
      `INSERT INTO score_audit_logs (id, user_id, action_id, score_delta, score_before, score_after, 
       change_type, details, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        generateUUID(),
        userId,
        actionId,
        action.scoreReward,
        oldScore,
        newScore,
        "action",
        JSON.stringify({ suspicious: isProbable }),
      ],
    );

    await queryRunner.commitTransaction();

    // Update cache (non-critical, ok if it fails)
    await redis.del("leaderboard:top10");
    await redis.set(`user:${userId}:score`, newScore, "EX", 60);

    // Broadcast update to WebSocket clients
    io.emit("leaderboard:update", {
      userId,
      newScore,
      scoreAdded: action.scoreReward,
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      newScore,
      scoreAdded: action.scoreReward,
      flaggedForReview: isProbable,
    });
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error("Action completion failed:", err);
    res.status(500).json({ error: "Failed to update score" });
  } finally {
    await queryRunner.release();
  }
};
```

### 1.3 Rate Limiting Implementation

```typescript
/**
 * Rate Limiting: Per-user maximum actions per time window
 *
 * ISSUE: Memory exhaustion
 * - Tracking rates in memory (Node.js) causes memory bloat with 100k+ users
 * - Each user = object with timestamps array = high memory
 *
 * SOLUTION: Use Redis
 * - Each user has key "ratelimit:user:{userId}"
 * - Value = requests counter
 * - TTL = 60 seconds (auto-expire)
 *
 * EDGE CASE: Clock skew
 * - If server time jumps backward, rate limit counter may reset unexpectedly
 * - Use server time source from Redis (not client)
 * - Or use NTP to sync server clocks
 *
 * DISTRIBUTED SYSTEMS:
 * - Problem: User hits server A with req 1, then server B with req 2
 * - Both servers might not see both requests => bypass rate limit
 * - Solution: Redis as central rate limit counter (all servers check same key)
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = req.userId;
  const key = `ratelimit:${userId}`;

  try {
    const count = await redis.incr(key);

    // Set TTL only on first request in window
    if (count === 1) {
      await redis.expire(key, 60); // 60-second window
    }

    const limit = 10; // Max 10 actions per minute

    if (count > limit) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: 60, // seconds
      });
    }

    res.setHeader("X-RateLimit-Remaining", limit - count);
    next();
  } catch (err) {
    console.error("Rate limit check failed:", err);
    // IMPORTANT: On cache failure, fail OPEN (not CLOSED)
    // Reason: Better to allow a potentially fraudulent request than block legitimate one
    // But log the incident for investigation
    next();
  }
};
```

### 1.4 Anomaly Detection

```typescript
/**
 * Anomaly Detection: Flag suspicious score patterns
 *
 * False Positives vs False Negatives:
 * - False Positive: Legitimate player flagged (bad UX, but low risk)
 * - False Negative: Fraudster not caught (high risk, lost revenue)
 * - Recommendation: Err on side of False Positives (flag for admin review)
 *
 * METRICS TO MONITOR:
 * 1. Score velocity: Points per second (should be < 1 pts/sec for most actions)
 * 2. Action frequency: Actions per minute (already rate-limited, but check outliers)
 * 3. Score jump: Single action reward vs user's average
 * 4. Time-of-completion: Suspicious if user completes 100 actions at 3 AM
 * 5. Geographic: Same user from USA then Singapore in 10 minutes
 * 6. Device fingerprint: Same score updated from 5 different devices
 *
 * SCORING APPROACH:
 * - Assign points to each check (0-100 scale)
 * - Sum points; if > 70, flag as suspicious
 * - Example:
 *   - Score jump +30 points (high)
 *   - Action frequency +20 points (medium)
 *   - New account age +10 points (low)
 *   - Total = 60 (underneath threshold, allow)
 *
 * HANDLING FLAGGED REQUESTS:
 * Current approach: Allow but flag for admin
 * Alternative: Require CAPTCHA verification for flagged actions
 * Risk: Fraudster uses automation to solve CAPTCHAs (costly but possible)
 */
export const detectAnomalies = async (
  userId: string,
  newScore: number,
  actionReward: number,
): Promise<{
  isSuspicious: boolean;
  anomalyScore: number;
  reasons: string[];
}> => {
  let anomalyScore = 0;
  const reasons: string[] = [];

  // Check 1: Score jump too large?
  const userHistory = await getUserScoreHistory(userId, 10); // Last 10 actions
  const avgReward = userHistory.reduce((a, b) => a + b, 0) / userHistory.length;
  if (actionReward > avgReward * 5) {
    anomalyScore += 30;
    reasons.push(`Exceptional reward: ${actionReward} vs avg ${avgReward}`);
  }

  // Check 2: User too new?
  const user = await User.findById(userId);
  if (Date.now() - user.createdAt < 24 * 60 * 60 * 1000) {
    // < 24 hours
    anomalyScore += 20;
    reasons.push("New account (< 24h)");
  }

  // Check 3: Rate of actions
  const actionsLast5Min = await getActionCount(userId, 300); // Last 5 min
  if (actionsLast5Min > 20) {
    anomalyScore += 40;
    reasons.push(`High action frequency: ${actionsLast5Min} in 5 min`);
  }

  // Check 4: Geographic anomaly
  const lastIP = await getLastClientIP(userId);
  if (lastIP && lastIP !== req.ip) {
    const country1 = await geolocate(lastIP);
    const country2 = await geolocate(req.ip);
    if (country1 !== country2) {
      anomalyScore += 25;
      reasons.push(`Geographic change: ${country1} → ${country2}`);
    }
  }

  return {
    isSuspicious: anomalyScore > 70,
    anomalyScore,
    reasons,
  };
};
```

---

## 2. Improvement Suggestions

### 2.1 Short-Term Improvements (Week 1-2)

#### Add Leaderboard Pagination

**Problem**: Top 10 only shows elite players; rank 500 player has no visibility

**Solution**:

```typescript
GET /leaderboard/rank/:rank?window=50 // Get rank 25-75

Response:
{
  rank: 50,
  window: { start: 25, end: 75 },
  leaderboard: [ /* 50 users around rank 50 */ ],
  userRank: 50, // Current user's rank
  userScore: 850
}
```

**Benefit**: Improves engagement for mid-tier players

---

#### Add Tiebreaker Logic

**Problem**: Two users with same score (1000 pts) — which ranks higher?

**Current**: Order by completion time (first to reach 1000 pts wins)

**Suggested**: Secondary metrics:

1. Time to reach current score (faster = higher rank)
2. Number of actions completed (more actions = slight boost)
3. Account age (older accounts ranked slightly higher if tied on score)

```typescript
ORDER BY total_score DESC, reached_score_time ASC, action_count DESC
```

---

#### Admin Override Endpoint

**Problem**: Fraudster gained 10,000 pts via exploit — hard to remove

**Solution**:

```typescript
POST /admin/users/:userId/adjust-score
Authorization: Bearer <ADMIN_TOKEN>
Body: {
  delta: -10000,
  reason: "Fraud: exploit abuse",
  auditTrail: "ticket-12345"
}

// Creates new audit log:
{
  change_type: 'admin_adjustment',
  changedBy: 'admin-1',
  reason: 'Fraud: exploit abuse'
}
```

**Security**: Requires admin token + logged forever

---

### 2.2 Medium-Term Improvements (Month 1-2)

#### Add Seasonal/Monthly Leaderboards

**Problem**: User who was active 1 year ago still dominates all-time leaderboard

**Solution**:

```typescript
GET /leaderboard/top10?period=month // Current month
GET /leaderboard/top10?period=week  // Current week
GET /leaderboard/top10?period=allTime // All-time

// Database view:
CREATE VIEW leaderboard_monthly AS
SELECT * FROM users
WHERE YEAR(updated_at) = YEAR(NOW())
  AND MONTH(updated_at) = MONTH(NOW())
ORDER BY total_score DESC
LIMIT 10;
```

**Benefit**: Encourages recurring engagement; freshness

---

#### Push Notifications

**Problem**: User doesn't know they dropped from rank 5 to 6; no incentive to check

**Solution**:

```typescript
// When user's rank changes:
IF (oldRank < 10 AND newRank >= 10) {
  // User fell out of top 10
  sendPushNotification(userId,
    "You're no longer in top 10! Complete more actions to climb back."
  );
}

IF (oldRank > 10 AND newRank <= 10) {
  // User entered top 10
  sendPushNotification(userId,
    `Congratulations! You're now rank ${newRank}!`
  );
}
```

**Benefit**: Re-engagement, viral growth (users brag about top 10)

---

#### Achievements & Badges

**Problem**: All motivation is pure score chasing — monotonous

**Solution**:

```
Badges:
- "First Steps" — Complete 1 action
- "Getting Started" — Complete 10 actions
- "Speedrunner" — Complete 5 actions in 1 minute
- "Night Owl" — 50 actions between midnight-6am
- "Hall of Fame" — Rank 1 all-time
- "Comeback King" — Drop from top 10, climb back

User Response:
{
  score: 1000,
  achievements: [
    { id: 'first_steps', unlockedAt: '2026-01-01T...' },
    { id: 'speedrunner', unlockedAt: '2026-02-10T...' }
  ]
}
```

**Benefit**: Gamification; diverse achievement paths

---

### 2.3 Long-Term Improvements (Q2+)

#### Social Leaderboard

**Problem**: Isolated competition — users don't interact

**Solution**:

```
- Follow other players
- See friends' scores in separate "friends leaderboard"
- Challenge mechanic: "Beat my high score this week!"
- Team leaderboard: Guilds/clans compete

GET /leaderboard/friends-top10
GET /leaderboard/team/:teamId/top10
GET /challenges/:challengeId/leaderboard
```

**Benefit**: Network effects; longer retention

---

#### Skill-Based Ranking

**Problem**: Scoreboard = luck+botting, not skill

**Suggested Enhancement**:

```
Two Metrics:
1. Score (existing)
2. Skill Rating (new)

Skill = (success_rate * difficulty)
- Easy action (reward=10): 100% success rate = 10 skill pts
- Hard action (reward=50): 30% success rate = 15 skill pts

Rank by: (Skill, -Difficulty, +Score) // Encourages hard content
```

**Benefit**: Competitive integrity; harder to cheat

---

#### Replay Detection

**Problem**: Same action completed thousands of times in seconds

**Solution**:

```typescript
const isReplay = await checkReplay(userId, actionId);

function checkReplay(userId, actionId) {
  // Get last 100 actions by this user
  const recent = await getUserLatestActions(userId, 100);

  // Check for patterns: More than 10 identical actions in 60 seconds?
  const counts = {};
  recent.forEach((action) => {
    counts[action.id] = (counts[action.id] || 0) + 1;
  });

  return Object.values(counts).some((count) => count > 10);
}

// If detected: Flag and temporarily suspend user's action privileges
if (isReplay) {
  flagForAdminReview(userId, "Replay detected");
  res.status(403).json({ error: "Account temporarily suspended" });
}
```

**Benefit**: Catch botting automatically

---

#### Machine Learning Fraud Model

**Problem**: Anomaly detection rules are static, fraudsters adapt

**Solution**: Train ML model to detect fraud patterns

```
Input features:
- Time since account creation
- # of consecutive actions
- Score jump magnitude
- Geographic consistency
- Device fingerprint changes
- Time-of-day pattern
- Action type sequence

Output: Fraud probability (0-1)

Threshold: If prob > 0.8, flag for human review
```

**Benefit**: Adaptive; catches novel fraud vectors

**Cost**: High upfront; requires data scientist

---

### 2.4 Operational Improvements

#### Monitoring & Alerting

**Currently Missing**:

- Real-time fraud detection dashboard
- Leaderboard cache hit rate monitoring
- WebSocket connection count vs. expected
- False positive rate of anomaly detection

**Implementation**:

```typescript
// Instrument key operations
metrics.gauge('leaderboard.cache_hit_rate', cacheHitRate);
metrics.gauge('websocket.active_connections', wsConnCount);
metrics.histogram('api.response_time_ms', responseTime);
metrics.increment('fraud.alerts_triggered', { reason: anomalyType });

// Alert conditions
if (websocket.active_connections < expected * 0.5) {
  sendAlert('WebSocket connection count dropped 50%');
}

if (fraud.alert_rate > 10%) {
  sendAlert('Fraud detection rate > 10% (check tuning)');
}
```

---

#### Load Testing & Capacity Planning

**Recommended**:

- Load test with 10k concurrent users
- Verify WebSocket can handle broadcasts to all
- Measure database query times at scale
- Identify bottlenecks (usually DB or cache)

```bash
# Load test example using Artillery
artillery quick --count 1000 --num 100 https://api.scoreboard.service/leaderboard/top10
```

---

## 3. Security Hardening Checklist

- [ ] **HTTPS Enforced**: Redirect HTTP to HTTPS; set HSTS header
- [ ] **CORS Tightened**: Only allow specific origins (not `*`)
- [ ] **SQL Injection Prevention**: Use parameterized queries everywhere
- [ ] **XSS Protection**: Sanitize user inputs; escape outputs
- [ ] **Rate Limiting**: Per-user + per-IP limits
- [ ] **Request Signing**: Optional HMAC signature for critical endpoints
- [ ] **Secrets Management**: Use AWS Secrets Manager / HashiCorp Vault
- [ ] **Regular Audits**: Monthly review of audit logs
- [ ] **Pen Testing**: Annual security assessment
- [ ] **Patch Management**: Keep dependencies updated (use Dependabot)

---

## 4. Performance Optimization Checklist

- [ ] **Redis**: Cache top 10 + user scores
- [ ] **Database Indexing**: Indexes on frequently queried columns
- [ ] **Connection Pooling**: Prevent exhausting DB connections
- [ ] **Async Logging**: Don't block on audit log writes
- [ ] **CDN**: Serve leaderboard page from edge (static HTML)
- [ ] **Query Optimization**: N+1 query prevention
- [ ] **Compression**: GZIP responses
- [ ] **Load Balancer**: Sticky sessions for stateful WebSocket

---

## Conclusion

This specification provides a foundation for building a secure, scalable real-time leaderboard system. The improvement suggestions above can be prioritized based on product roadmap and resource availability.

**Recommended Implementation Order**:

1. **Phase 1 (MVP)**: Core API + WebSocket + basic fraud detection
2. **Phase 2 (Month 2)**: Pagination, admin override, seasonal boards
3. **Phase 3 (Month 3-4)**: Social features, achievements, ML fraud model

---

**Document Version**: 1.0  
**Last Updated**: February 12, 2026  
**Authors**: Backend Architecture Team
