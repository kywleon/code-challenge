# Problem 6: Architecture & Flow Diagrams

This document provides detailed visual diagrams for the Real-time Scoreboard API module.

---

## 1. High-Level System Architecture

ASCII and Mermaid diagrams showing component interactions:

```
┌────────────────────────────────────────────────────────────────────┐
│                          Client Layer                             │
├────────────────────────────────────────────────────────────────────┤
│  Browser / Web App              │        Mobile App               │
│  - HTTP REST calls              │        - WebSocket              │
│  - WebSocket live updates       │        - Real-time leaderboard   │
└──────────────┬──────────────────┴────────────────┬─────────────────┘
               │                                   │
               │ HTTPS + WSS                       │
               │                                   │
┌──────────────▼───────────────────────────────────▼─────────────────┐
│                    API Gateway / Load Balancer                     │
│  - Route requests to servers                                       │
│  - SSL/TLS termination                                             │
│  - Rate limiting (DDoS protection)                                 │
└──────────────┬──────────────────────────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
    ┌────────┐   ┌────────┐
    │Server 1│   │Server 2│  (Replicas for HA)
    │  Pod   │   │  Pod   │
    └───┬────┘   └───┬────┘
        │            │
        └─────┬──────┘
              │
    ┌─────────▼──────────┐
    │   Message Queue    │
    │  (Redis/RabbitMQ)  │
    │  - Async logging   │
    │  - Event broadcast │
    └────────┬───────────┘
             │
    ┌────────▼──────────────────────────┐
    │         Data Layer               │
    ├──────────────────────────────────┤
    │  Primary DB     │     Replica DB │
    │  (PostgreSQL)   │   (Read-only)   │
    │  - User Data    │   - Leaderboard │
    │  - Audit Logs   │   - Score Cache │
    └─────────────────┴──────────────────┘
             │
    ┌────────▼──────────────────────────┐
    │      Cache Layer                │
    ├──────────────────────────────────┤
    │  Redis                           │
    │  - Top 10 leaderboard            │
    │  - User scores (TTL: 60s)        │
    │  - Session management            │
    └──────────────────────────────────┘
```

---

## 2. Request Flow: Score Update

### Scenario: User completes an action

```
TIME │ COMPONENT           │ ACTION
─────┼─────────────────────┼──────────────────────────────────────────────
  1  │ Client Browser      │ [User completes action] → Send POST request
     │                     │ POST /actions/complete + JWT
     │                     │ Body: { actionId, actionType, timestamp }
     │                     │
  2  │ API Gateway         │ Receive request → Check rate limit
     │                     │ Allow / Reject (429 if exceeded)
     │                     │
  3  │ Auth Middleware     │ Decode JWT token → Verify signature
     │                     │ Extract userId, permissions
     │                     │ Return 401 if invalid
     │                     │
  4  │ Input Validation    │ Validate action ID exists
     │                     │ Validate request structure (joi/zod)
     │                     │ Return 400 if invalid
     │                     │
  5  │ Business Logic      │ 1. Fetch action metadata (score reward, cooldown)
     │                     │ 2. Check if user can complete this action
     │                     │ 3. Verify cooldown (not completed in last N seconds)
     │                     │
  6  │ Fraud Detection     │ 1. Check for duplicate action (past 5 min)
     │                     │ 2. Anomaly score: Is jump impossible?
     │                     │ 3. Signal if flagged → Log for review
     │                     │ (But allow completion with flag)
     │                     │
  7  │ Database Lock       │ BEGIN TRANSACTION
     │                     │ (Prevent race conditions)
     │                     │
  8  │ Database Update     │ 1. INSERT into user_action_completions
     │                     │ 2. UPDATE users SET total_score = ...
     │                     │ 3. INSERT into score_audit_logs
     │ (PostgreSQL)        │ COMMIT TRANSACTION
     │                     │
  9  │ Cache Update        │ 1. Fetch updated leaderboard from DB
     │                     │ 2. Update Redis key "leaderboard:top10"
     │ (Redis)             │ 3. Update Redis key "user:{userId}:score"
     │                     │ 4. Decrement rate limit counter
     │                     │
 10  │ WebSocket Broadcast │ 1. Emit "leaderboard:update" to all connected
     │ (Socket.io)         │    clients with new rank/score
     │                     │ 2. Target only clients in leaderboard namespace
     │                     │
 11  │ Async Logging       │ Enqueue audit log message to message queue
     │ (Background Job)    │ (Async processing to avoid blocking)
     │                     │
 12  │ Response to Client  │ Return 200 OK
     │                     │ Body: { success: true, newScore: 1050, ... }
     │                     │
 13  │ Client Browser      │ Update UI: Show new score, leaderboard
     │                     │ OR Receive WebSocket update (real-time)
```

---

## 3. Fraud Detection Flow

```
                    ┌─────────────────────┐
                    │ Score Update       │
                    │ Request            │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Fetch User Profile  │
                    │ (Age, history)      │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
          ┌──────────────────┐  ┌──────────────────┐
          │ Rate Check       │  │ Duplicate Check  │
          │ (10 req/min)     │  │ (Past 30 sec?)   │
          └────┬─────────────┘  └────┬─────────────┘
               │                     │
          Pass │                Pass │
               └──────────┬──────────┘
                          │
                          ▼
          ┌──────────────────────────────┐
          │ Anomaly Detection            │
          │ ├─ Score jump too high?      │
          │ ├─ Impossible action rate?   │
          │ ├─ Geographic anomaly? (IP)  │
          │ └─ Account age < 1 day?      │
          └────┬───────────────────────┬─┘
               │                       │
          PASS │                    FLAG
               │                   (Suspicious)
               │                       │
               │                    ┌──▼─────────┐
               │                    │ Log Alert  │
               │                    │ Admin Flag │
               │                    └────────────┘
               │                       │
               └───────┬───────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ Proceed with Update  │
            │ (Mark as flagged)    │
            └──────────────────────┘
```

---

## 4. Real-time Leaderboard Update Flow (WebSocket)

```
┌─────────────────────────────────────────────────────────┐
│ User A: Action Complete + Score Update                 │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
    ┌──────────────────────────────────┐
    │ Server: Process Score Update     │
    │ 1. Update database               │
    │ 2. Update cache (Redis, top 10)  │
    └──────────────────┬───────────────┘
                       │
                       ▼
    ┌──────────────────────────────────┐
    │ Server: Broadcast to Clients     │
    │ emit('leaderboard:update', {     │
    │   userId, newScore, newRank      │
    │ })                               │
    └────────┬──────────────┬──────────┘
             │              │
      ┌──────▼─┐      ┌─────▼──────┐
      │Client 1│      │Client 2    │
      │(Browser)│     │(Mobile)   │
      │         │     │            │
      │ ┌─────[Receive Update]     │
      │ │                │        │
      │ ▼                ▼        │
      │ Re-render        Update   │
      │ Leaderboard UI   Scores   │
      │ Animation        in      │
      │                  Memory   │
      │                           │
      └─────────────────┬─────────┘
                        │
              ┌─────────▼────────────┐
              │ User sees live       │
              │ leaderboard update   │
              │ in real-time (~100ms)│
              └──────────────────────┘
```

---

## 5. Authentication Flow (JWT)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Login (not detailed here, just JWT generation)      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
    ┌───────────────────────────┐
    │ Server Issues JWT Token   │
    │ Payload:                  │
    │ {                         │
    │   userId: "user-123",     │
    │   iat: 1700000000,        │
    │   exp: 1700086400 (+24h)  │
    │ }                         │
    │ Signed with SECRET_KEY    │
    └────────────────┬──────────┘
                     │
                     ▼
    ┌───────────────────────────┐
    │ Client stores JWT         │
    │ (localStorage / cookie)   │
    └────────────────┬──────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
    ┌──────────────┐      ┌──────────────┐
    │ HTTP Request │      │WebSocket Con │
    │ /actions/    │      │ /leaderboard │
    │ complete     │      │ /live        │
    │ Header: Auth │      │ URL: ?token= │
    │ Bearer <JWT> │      │ <JWT>        │
    └──────┬───────┘      └──────┬───────┘
           │                     │
           └──────────┬──────────┘
                      │
              ┌───────▼─────────┐
              │ Server:         │
              │ 1. Extract JWT  │
              │ 2. Verify sig   │
              │ 3. Check exp    │
              │ 4. Extract usr  │
              │                 │
              ├─ Valid: Allow   │
              └─ Invalid: 401   │
```

---

## 6. Error Handling Flow

```
                    ┌──────────────────┐
                    │ API Request      │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
      ┌────────────┐   ┌──────────────┐  ┌─────────────┐
      │Validation  │   │Rate Limiting │  │JWT Check    │
      │Failed?     │   │Exceeded?     │  │Invalid?     │
      └─┬──────────┘   └──┬───────────┘  └──┬──────────┘
        │ YES (400)       │ YES (429)        │ YES (401)
        │                 │                  │
        └────────┬────────┴──────────────────┤
                 │                           │
                 ▼                           ▼
         ┌──────────────┐          ┌──────────────────┐
         │ Client Error │          │ Auth Error       │
         │ Response     │          │ Response         │
         │              │          │                  │
         │ {error:      │          │ {error:          │
         │  "Invalid    │          │  "Unauthorized", │
         │  request"}   │          │  details: ...}   │
         └──────────────┘          └──────────────────┘
```

---

## 7. Deployment & Scaling Architecture

```
                ┌──────────────────────┐
                │   Internet Users     │
                └──────────┬───────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │   CDN (Static Assets)        │
            └──────────────┬───────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │   Load Balancer (AWS ELB)    │
            │   - Health checks            │
            │   - Session stickiness       │
            └───────────┬──────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────────┐
    │ Instance│   │Instance │   │ Instance    │
    │   1     │   │   2     │   │   3+...     │
    │(Node.js)│   │(Node.js)│   │ (Kubernetes)│
    │(Replica)│   │(Replica)│   │  Pods      │
    └────┬────┘   └────┬────┘   └──────┬──────┘
         │             │               │
         └─────────────┼───────────────┘
                       │
            ┌──────────▼────────────┐
            │  Message Queue (RMQ)  │
            │  - Async tasks        │
            │  - Event streaming    │
            └──────────┬────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐
    │  DB     │  │  Redis  │  │ S3      │
    │ Primary │  │  Cache  │  │ Backups │
    │  (RDS)  │  │ Cluster │  │         │
    └─────────┘  └─────────┘  └─────────┘
```

---

## 8. Decision Tree: Should We Allow the Action?

```
                        Is JWT valid?
                             │
                    ┌────────┴──────────┐
                    │                   │
                   YES                 NO
                    │                   │
                    ▼                   ▼
                  [✓]             Return 401
                    │
          Is action ID valid?
                    │
           ┌────────┴──────────┐
           │                   │
          YES                 NO
           │                   │
           ▼                   ▼
         [✓]             Return 400
           │
    User already did it in last 5s?
           │
      ┌────┴────┐
      │          │
     YES        NO
      │          │
      ▼          ▼
  Return 409   [✓]
               │
        Anomaly flags?
               │
          ┌────┴────┐
          │          │
       YES          NO
        (Many)       │
        │            │
        ▼            ▼
   Log alert   Check rate limit
   + allow          │
        │      ┌────┴────┐
        │      │          │
        │    <10/min    ≥10/min
        │      │          │
        │      ▼          ▼
        │    [✓]    Return 429
        │      │
        └──────┴────┐
                    │
                    ▼
         Update DB + Cache
                    │
                    ▼
         Broadcast WebSocket
                    │
                    ▼
           Return 200 + newScore
```

---

## 9. Suggested Monitoring & Alerts

### Key Metrics to Track

- API response time (p50, p95, p99)
- Success rate (% of 200 responses)
- Fraud detection rate (% flagged)
- WebSocket connection count
- Redis hit rate (% cache hits)
- Database query execution time

### Alert Thresholds

| Metric         | Threshold        | Action       |
| -------------- | ---------------- | ------------ |
| P99 latency    | > 1 sec          | Page on-call |
| Error rate     | > 5%             | Alert team   |
| Fraud flags    | > 10% of actions | Review logs  |
| WebSocket drop | > 50%            | Check server |
| Redis latency  | > 100ms          | Investigate  |
| DB connections | > 80% pool       | Scale up     |

---

## 10. Security Checklist for Implementation

- [ ] All endpoints use HTTPS only
- [ ] JWT signature verified on every request
- [ ] Rate limiting applied at gateway level
- [ ] Input validation on all fields
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS protection (sanitize outputs)
- [ ] CORS policy restricted to trusted origins
- [ ] Sensitive data (scores) authenticated before returning
- [ ] Audit logging for all data modifications
- [ ] Password hashing (bcrypt) for stored credentials
- [ ] Secrets management (not hardcoded)
- [ ] Regular security audits
- [ ] Penetration testing before launch

---

**This document should be reviewed by:**

1. Backend Engineering Team (for implementation feasibility)
2. Security Team (for vulnerability assessment)
3. DevOps Team (for deployment & monitoring strategy)
4. Product Manager (for business alignment)
