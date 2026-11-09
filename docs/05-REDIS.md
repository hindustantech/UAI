# Redis

Redis is **required** for the API to start (`await connectRedis()` in `server.js` exits the
process on failure) and is the backbone of the notification subsystem: BullMQ queues, dedup,
distributed locks, rate limiting and the circuit breaker.

Backend: `ioredis` 5.

---

## Connection

`config/redis.js` creates **two** clients:

| Client | Accessor | Use |
|---|---|---|
| `redisClient` | `getRedisClient()` | All commands, BullMQ producer/consumer connections, Lua scripts |
| `redisSubscriber` | `getRedisSubscriber()` | Reserved for pub/sub (currently created but not used by the notification code) |

Options:

```js
{
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,   // required by BullMQ
  enableReadyCheck: false,
}
```

`REDIS_DB` is read by `src/notification/config/index.js` but the shared client in
`config/redis.js` does **not** pass it — the notification subsystem therefore runs on DB 0
unless the shared client is changed.

---

## Key namespaces

| Prefix | Owner | TTL | Purpose |
|---|---|---|---|
| `notification:lock:<key>` | `utils/redisLock.js` | `LOCK_TTL` (60 s) | Distributed mutex (`SET ... PX NX`) |
| `notification:idempotency:<type>:<parts>` | `utils/idempotency.js` | `IDEMPOTENCY_TTL` (24 h) | At-most-once processing guard |
| `notification:channel:<channel>` | `utils/channelManager.js` | none | Per-channel on/off switch (`1`/`0`) |
| `notification:reminder:sched:<companyId>:<label>` | `scheduler/subscriptionReminder.js` | delay + 24 h | Prevents duplicate reminder scheduling |
| `notification:ratelimit:<channel>:<tier>` | `priority/rateLimiter.js` | 1 h | Token-bucket hash (`tokens`, `lastRefill`) |
| `notification:circuit:state` | `priority/loadShedder.js` | 30 s–300 s | `CLOSED` / `OPEN` / `HALF_OPEN` |
| `notification:circuit:critical_high_depth` | `priority/loadShedder.js` | 10 s | Total critical+high queue depth |
| `notification:circuit:dropped` | `priority/loadShedder.js` | 7 days | Dropped-job counter |
| `notification:paused:<tier>` | `priority/loadShedder.js` | 60 s | Load-shedding pause flags |
| `bull:<queue>:*` | BullMQ | library | Job data, locks, events, delayed sets |

---

## Mechanisms

### Distributed lock (`utils/redisLock.js`)

```js
SET notification:lock:<key> <pid-timestamp-random> PX <ttl> NX
```

- `acquireLock` returns the lock value or `null`.
- `releaseLock` only deletes if the stored value still matches (compare-and-delete).
- `withLock(key, fn, ttl)` runs `fn` only if the lock was acquired, and always releases.
- `acquireLockWithRetry` retries `LOCK_RETRY_COUNT` times, `LOCK_RETRY_DELAY` ms apart.

Used by: subscription billing cron, catch-up script, report scheduling, reminder scheduling.

### Idempotency (`utils/idempotency.js`)

Key builders:

| Helper | Key |
|---|---|
| `makeIdempotencyKeyForSubscription(companyId, planId, label)` | `notification:idempotency:subscription:<companyId>:<planId>:<label>` |
| `makeIdempotencyKeyForAttendance(employeeId, date)` | `notification:idempotency:attendance:<employeeId>:<date>` |
| `makeIdempotencyKeyForReport(companyId, date)` | `notification:idempotency:report:<companyId>:<date>` |
| `makeIdempotencyKeyForOtp(userId, requestId)` | `notification:idempotency:otp:<userId>:<requestId>` |

`claimIdempotency` uses `SET ... PX <ttl> NX`; a successful claim means "you own this work".

### Token-bucket rate limiter (`priority/rateLimiter.js`)

Per `channel:tier` hash with `tokens` and `lastRefill`. Implemented as a Lua script loaded once
and executed with `EVALSHA`. Capacity and refill rate come from `TIER_CONFIG`
(`TIER_*_RATE` per minute). Keys expire after 1 hour.

### Circuit breaker / load shedding (`priority/loadShedder.js`)

A Lua script atomically evaluates queue depth and moves the circuit between states:

| State | Transition |
|---|---|
| `CLOSED` | depth > `CB_CRITICAL_HIGH_DEPTH_OPEN` (100) → `OPEN`, pause `bulk` + `low` |
| `CLOSED` | depth > `CB_CRITICAL_HIGH_DEPTH_OPEN_ALL` (500) → `OPEN` |
| `OPEN` | after 30 s → `HALF_OPEN` |
| `HALF_OPEN` | depth ≤ `CB_RECOVERY_DEPTH` (50) → `CLOSED` |
| `HALF_OPEN` | still deep → `OPEN` again |

Evaluation runs every 10 s from `workers/index.js` (`updateQueueDepth()` then
`evaluateCircuitBreaker()`).

### Channel switches

`setChannelEnabled(channel, enabled)` writes `notification:channel:<channel>` and updates an
in-memory cache. On boot, `initializeChannelCache()` seeds from `DISABLE_EMAIL`,
`DISABLE_WHATSAPP`, `DISABLE_PUSH`; `syncChannelFromRedis()` then applies Redis overrides.
Admin endpoints under `/api/admin/notifications` toggle these.

---

<!-- AUTO:START:redis -->
| Key / pattern | Where | File |
|---|---|---|
| `notification:channel:` | `CHANNEL_PREFIX` | `src/notification/utils/channelManager.js`:4 |
| `notification:circuit:critical_high_depth` | `DEPTH_KEY` | `src/notification/priority/loadShedder.js`:6 |
| `notification:circuit:dropped` | `DROPPED_COUNTER` | `src/notification/priority/loadShedder.js`:7 |
| `notification:circuit:state` | `CIRCUIT_KEY` | `src/notification/priority/loadShedder.js`:5 |
| `notification:idempotency:` | `IDEMPOTENCY_PREFIX` | `src/notification/utils/idempotency.js`:7 |
| `notification:lock:` | `LOCK_PREFIX` | `src/notification/utils/redisLock.js`:5 |
| `notification:paused:` | `PAUSED_PREFIX` | `src/notification/priority/loadShedder.js`:8 |
| `notification:ratelimit:` | `RATE_LIMITER_PREFIX` | `src/notification/priority/rateLimiter.js`:5 |
| `notification:reminder:sched:${companyId}:${reminder.label}` | `dynamic` | `src/notification/scheduler/subscriptionReminder.js`:33 |
<!-- AUTO:END:redis -->

---

## Operations

- **Do not flush the DB** while BullMQ has active jobs — job locks live in Redis and in-flight
  work will be re-delivered or lost depending on `attempts`.
- Losing Redis mid-run causes workers to reconnect (`maxRetriesPerRequest: null`); producers will
  block rather than throw.
- The API hard-exits if Redis is unreachable at boot. If you need API-without-notifications,
  make `connectRedis()` non-fatal and guard the worker startup (already wrapped in `try/catch`).

> Put notes **outside** the AUTO markers above.
