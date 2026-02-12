# Problem 6: Real-time Scoreboard API Module Specification

## Executive Summary

This document specifies a backend API module for a real-time scoreboard system. Users complete actions to earn points, and the system maintains a live leaderboard of the top 10 users while preventing unauthorized score manipulation.

---

## 1. Overview

### Purpose

Provide a secure, real-time API service that:

- Manages user scores and actions
- Displays the top 10 users with highest scores
- Implements live updates via WebSocket connections
- Prevents malicious score manipulation

### Key Features

- User authentication and authorization
- Action-based score updates
- Real-time broadcast to all connected clients
- Rate limiting and fraud detection
- Audit logging for all score changes

### Technology Stack (Recommended)

- **Language**: TypeScript / Node.js
- **Framework**: Express.js
- **Real-time**: Socket.io (WebSocket)
- **Database**: PostgreSQL or MongoDB
- **Cache**: Redis (for leaderboard caching)
- **Authentication**: JWT (JSON Web Tokens)

---

## 2. Architecture Overview

```
┌─────────────┐
│   Clients   │
│  (Browser)  │
└──────┬──────┘
       │ WebSocket
       │ HTTP
       ▼
┌──────────────────────────────────────┐
│   Load Balancer / API Gateway        │
└──────────┬───────────────────────────┘
           │
       ┌───┴────┐
       │         │
       ▼         ▼
   ┌────────┐  ┌────────┐
   │ Server │  │ Server │ (Scaled horizontally)
   │ Pod 1  │  │ Pod 2  │
   └───┬────┘  └───┬────┘
       │           │
       └─────┬─────┘
             │
      ┌──────▼──────┐
      │  Database   │
      │ (PostgreSQL)│
      └─────┬──────┘
            │
      ┌─────▼──────┐
      │    Redis   │ (Leaderboard cache)
      │   Cache    │
      └────────────┘
```

---

## 3. API Endpoints Specification

### Base URL

```
https://api.scoreboard.service/v1
```

### 3.1 User Action & Score Update

#### Endpoint: POST /actions/complete

**Purpose**: Record completion of a user action and update score.

**Authentication**: Required (Bearer Token / JWT)

**Request Headers**:

```
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
```

**Request Body**:

```json
{
  "actionId": "uuid-string",
  "actionType": "string", // e.g., "quest", "achievement", "challenge"
  "timestamp": "2026-02-12T10:30:00Z"
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "userId": "user-123",
  "newScore": 1050,
  "scoreAdded": 50,
  "actionId": "uuid-string"
}
```

**Error Responses**:

- `400 Bad Request` — Invalid action data
- `401 Unauthorized` — Missing/invalid token
- `403 Forbidden` — User not authorized for this action
- `409 Conflict` — Action already completed (idempotency)
- `429 Too Many Requests` — Rate limit exceeded
- `500 Internal Server Error` — Server error

---

### 3.2 Retrieve Top 10 Leaderboard

#### Endpoint: GET /leaderboard/top10

**Purpose**: Fetch the top 10 users by score (read-only).

**Authentication**: Optional (can be public or require token)

**Response** (200 OK):

```json
{
  "timestamp": "2026-02-12T10:30:00Z",
  "leaderboard": [
    {
      "rank": 1,
      "userId": "user-001",
      "username": "PlayerA",
      "score": 5000,
      "actionsCompleted": 42
    },
    {
      "rank": 2,
      "userId": "user-002",
      "username": "PlayerB",
      "score": 4850,
      "actionsCompleted": 40
    }
    // ... (8 more entries)
  ]
}
```

---

### 3.3 User Score Endpoint

#### Endpoint: GET /users/:userId/score

**Purpose**: Get current score of a specific user.

**Authentication**: Required (Bearer Token)

**Response** (200 OK):

```json
{
  "userId": "user-123",
  "username": "player-name",
  "score": 1050,
  "rank": 234, // Rank among all users
  "actionsCompleted": 21
}
```

---

### 3.4 Leaderboard WebSocket (Real-time Updates)

#### WebSocket Endpoint: wss://api.scoreboard.service/v1/leaderboard/live

**Purpose**: Establish real-time connection to receive leaderboard updates.

**Connection**:

```
wss://api.scoreboard.service/v1/leaderboard/live?token=<JWT_TOKEN>
```

**Messages Emitted** (Server → Client):

1. **Initial Leaderboard** (on connection):

```json
{
  "event": "leaderboard:initial",
  "data": {
    /* top 10 leaderboard data */
  }
}
```

2. **Score Updated** (when any user's score changes):

```json
{
  "event": "leaderboard:update",
  "data": {
    "userId": "user-123",
    "username": "player-name",
    "newScore": 1050,
    "newRank": 15,
    "previousRank": 20,
    "timestamp": "2026-02-12T10:30:00Z"
  }
}
```

3. **Leaderboard Refresh** (every 30 seconds or when top 10 changes):

```json
{
  "event": "leaderboard:refresh",
  "data": {
    /* full top 10 data */
  }
}
```

**Messages Received** (Client → Server):

1. **Ping** (for connection keep-alive):

```json
{
  "event": "ping"
}
```

Response:

```json
{
  "event": "pong"
}
```

---

## 4. Authentication & Authorization

### 4.1 JWT Token Structure

```
Header: {
  "alg": "HS256",
  "typ": "JWT"
}

Payload: {
  "userId": "user-123",
  "username": "player-name",
  "email": "player@example.com",
  "iat": 1644654600,
  "exp": 1644741000,
  "permissions": ["action:complete", "score:read"]
}

Signature: HMACSHA256(base64UrlEncode(header) + "." + base64UrlEncode(payload), secret)
```

### 4.2 Token Validation

- All score update requests **must** include a valid JWT
- Token expiry: 24 hours (configurable)
- Refresh token mechanism for renewing expired tokens
- Blacklist mechanism for revoked tokens

### 4.3 Permission Levels

- **`action:complete`** — User can complete actions and update their own score
- **`score:read`** — User can view their score and leaderboard
- **`admin:manage`** — Admin can manually adjust scores / review audit logs

---

## 5. Fraud Detection & Prevention

### 5.1 Rate Limiting

- **Per-user limit**: Maximum 10 action completions per minute
- **Backend enforcement**: Validate action cooldown (cannot complete same action twice within 5 seconds)
- **Return 429 Too Many Requests** if limit exceeded

### 5.2 Action Validation

- Each action must be pre-registered in the system with:
  - Unique `actionId`
  - Score reward amount
  - Cooldown period
  - Required prerequisites (optional)

### 5.3 Idempotency

- If the same action is submitted multiple times within 30 seconds:
  - Return success with flag `"alreadyCompleted": true`
  - Do **not** add score again
  - Use unique request ID or idempotency key

### 5.4 Audit Logging

- Log all score changes with:
  - User ID
  - Action ID
  - Score delta
  - Timestamp
  - Client IP
  - Request signature (HMAC)
- Store in immutable audit table for compliance

### 5.5 Anomaly Detection

- Flag and review suspicious patterns:
  - User completing 100+ actions in <1 minute
  - Score jumps inconsistent with action rewards
  - Multiple users from same IP/device
  - Rapid score fluctuations

---

## 6. Data Model

### 6.1 Database Schema

#### Users Table

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  total_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Actions Table

```sql
CREATE TABLE actions (
  id UUID PRIMARY KEY,
  action_type VARCHAR(100) NOT NULL,
  score_reward INT NOT NULL,
  cooldown_seconds INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### User Actions Completion Table

```sql
CREATE TABLE user_action_completions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  action_id UUID NOT NULL REFERENCES actions(id),
  score_earned INT NOT NULL,
  completed_at TIMESTAMP DEFAULT NOW(),
  client_ip VARCHAR(50),
  request_signature VARCHAR(255),
  UNIQUE(user_id, action_id, completed_at) -- Prevent exact duplicates
);
```

#### Score Audit Log Table

```sql
CREATE TABLE score_audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  action_id UUID REFERENCES actions(id),
  score_delta INT NOT NULL,
  score_before INT NOT NULL,
  score_after INT NOT NULL,
  change_type VARCHAR(50), -- 'action', 'admin_adjustment', 'refund'
  details JSONB,
  timestamp TIMESTAMP DEFAULT NOW(),
  INDEX (user_id, timestamp)
);
```

### 6.2 Caching Strategy

**Redis Leaderboard Cache**:

```
Key: "leaderboard:top10"
Value: Sorted set of { userId : score }
TTL: 30 seconds (refresh on any score change)

Key: "user:{userId}:score"
Value: Integer score
TTL: 60 seconds
```

---

## 7. Execution Flow Diagram

```
┌─────────────────────┐
│   Client Browser    │
│  (User completes    │
│   an action)        │
└──────────┬──────────┘
           │
           │ POST /actions/complete
           │ + JWT Token
           │
           ▼
   ┌───────────────────────────┐
   │  API Server: Middleware   │
   │  - Validate JWT           │
   │  - Rate limiting check    │
   └───────────┬───────────────┘
               │
               ▼
    ┌─────────────────────────────┐
    │ Business Logic Handler      │
    │ 1. Verify action exists     │
    │ 2. Check cooldown period    │
    │ 3. Validate action rewards  │
    └───────────┬─────────────────┘
                │
                ▼
     ┌──────────────────────────────┐
     │ Fraud Detection Service      │
     │ - Anomaly detection          │
     │ - Duplicate check            │
     │ - Score validation           │
     └───────────┬──────────────────┘
                 │
                 ▼
      ┌─────────────────────────────┐
      │   Database Transaction      │
      │  1. Update user.total_score │
      │  2. Insert completion log   │
      │  3. Insert audit log        │
      │  (Atomic operation)         │
      └───────────┬─────────────────┘
                  │
                  ▼
       ┌──────────────────────────────┐
       │  Update Redis Cache          │
       │  - Recalculate top 10        │
       │  - Update user score cache   │
       └───────────┬──────────────────┘
                   │
                   ▼
        ┌──────────────────────────────┐
        │  Real-time Notifications     │
        │  - Broadcast via WebSocket   │
        │  - Push to all clients       │
        └───────────┬──────────────────┘
                    │
                    ▼
         ┌──────────────────────────────┐
         │  Response to Client          │
         │  { success: true, newScore } │
         └──────────────────────────────┘
```

---

## 8. Implementation Recommendations

### 8.1 Security Best Practices

1. **HTTPS Only** — All endpoints must be served over HTTPS
2. **CORS Policy** — Restrict origins to trusted domains
3. **Rate Limiting** — Use `express-rate-limit` middleware
4. **Input Validation** — Sanitize and validate all inputs (use `joi` or `zod`)
5. **Token Expiry** — Keep JWT expiry short (15-60 minutes for actions, longer for refresh tokens)
6. **Secret Management** — Store JWT secret in environment variables (use `.env` files or secrets manager)
7. **HMAC Signature** — Sign critical requests to prevent tampering

### 8.2 Performance Optimization

1. **Connection Pooling** — Use database connection pools (e.g., `pg-boss` for PostgreSQL)
2. **Read Replicas** — Separate read traffic for leaderboard queries
3. **API Caching** — Cache leaderboard with short TTL (30 seconds)
4. **Message Queuing** — Use Redis or RabbitMQ for async audit logging
5. **Database Indexing** — Create indexes on `user_id`, `action_id`, `completed_at`
6. **Socket.io Namespaces** — Separate leaderboard updates into dedicated namespace to reduce message overhead

### 8.3 Monitoring & Observability

1. **Logging** — Log all score changes and anomalies (use Winston or Bunyan)
2. **Metrics** — Track:
   - API response times (percentiles: p50, p95, p99)
   - Fraud detection rate
   - WebSocket connection count
   - Database query times
3. **Alerts** — Alert on:
   - High anomaly rate (>5% suspicious actions)
   - API latency >500ms
   - Database connection pool exhaustion
4. **Distributed Tracing** — Use OpenTelemetry for request tracing

### 8.4 Error Handling

1. **Graceful Degradation** — If Redis is down, fall back to database queries (slower but functional)
2. **Retry Logic** — Implement exponential backoff for transient failures
3. **Circuit Breaker** — Fail fast if database is unreachable
4. **Detailed Error Messages** — Return meaningful error details (without exposing internal structure)

### 8.5 Testing Strategy

1. **Unit Tests** — Test individual functions (fraud detection, score calculation)
2. **Integration Tests** — Test API endpoints with mocked database
3. **E2E Tests** — Full flow from client action to leaderboard update
4. **Load Testing** — Simulate 1000+ concurrent users
5. **Security Testing** — Attempt unauthorized score manipulation, token injection, rate limit bypass

### 8.6 Deployment Recommendations

1. **Containerization** — Use Docker for consistent environment
2. **Orchestration** — Deploy with Kubernetes for auto-scaling
3. **CI/CD** — Automate testing and deployment
4. **A/B Testing** — Gradual rollout (canary deployment)
5. **Database Migration** — Use migration tools (Flyway, Knex) for schema changes

---

## 9. Known Limitations & Future Improvements

### Current Limitations

1. **Top 10 Only** — Scoreboard limited to top 10; consider paginated leaderboard for rank visibility
2. **No Tiebreaker** — Users with same score are ordered by completion time; consider secondary metrics
3. **No Seasonal Reset** — Scores accumulate indefinitely; consider monthly/yearly resets
4. **Admin Adjustments** — Manual score changes not implemented; consider admin override with audit trail

### Suggestions for Enhancement

1. **Achievements & Badges** — Award badges for milestones (first action, 100 actions, etc.)
2. **Leaderboard Filters** — Add regional/time-period filters (e.g., "top 10 this week")
3. **Social Features** — Allow users to follow each other and see friend scores
4. **Mobile API** — Optimize responses for mobile (reduce payload size)
5. **Push Notifications** — Notify users when they enter/leave top 10
6. **Replay Detection** — Detect botting patterns and auto-ban suspicious accounts
7. **Fair Play** — Implement reputation system to weight scores from verified users

---

## 10. Glossary

| Term                  | Definition                                                    |
| --------------------- | ------------------------------------------------------------- |
| **JWT**               | JSON Web Token; stateless authentication mechanism            |
| **Idempotency**       | Property that multiple identical requests produce same result |
| **Rate Limiting**     | Restricting number of requests per time period                |
| **Anomaly Detection** | Identifying unusual patterns (e.g., impossible scores)        |
| **Audit Log**         | Immutable record of all data changes                          |
| **Socket.io**         | Real-time bidirectional communication library                 |
| **Redis**             | In-memory data store for caching                              |

---

## 11. Contact & Support

- **Primary Owner**: Backend Team Lead
- **Technical Review**: Security & Infrastructure Teams
- **Documentation Updates**: TBD

---

**Document Version**: 1.0  
**Last Updated**: February 12, 2026  
**Status**: Ready for Implementation
