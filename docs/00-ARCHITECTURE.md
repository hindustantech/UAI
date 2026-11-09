# Architecture

UAI is a multi-tenant HR platform backend: attendance, leave, payroll, sales sessions, tasks,
subscriptions/billing, partner onboarding, blogs, audit logging and a tiered notification system.

| Piece | Choice |
|---|---|
| Runtime | Node.js, ESM (`"type": "module"`) |
| HTTP | Express 4 |
| Database | MongoDB via Mongoose 8 |
| Cache / queue backend | Redis via ioredis 5 |
| Queue | BullMQ 5 (tiered notification queues) |
| Scheduler | node-cron 4 |
| Auth | JWT (`jsonwebtoken`), Passport + Google OAuth |
| Files | Multer, Cloudinary |
| Email / Push / WhatsApp | Nodemailer, Firebase Admin, QuickHub / WhatsApp API |
| Payments | Razorpay |
| Reporting | ExcelJS, PDFKit, Chart.js canvas |
| Logging | Winston (+ `winston-mongodb`) and Morgan |

---

## Folder layout

| Path | Responsibility |
|---|---|
| `server.js` | Composition root: DB/Redis connect, route mounting, cron + worker boot, shutdown |
| `config/` | `db.js`, `redis.js`, JWT, OAuth, face API config, admin panel, cron logger |
| `routes/` | Express routers only; no business logic |
| `controllers/` | Request handlers, grouped by domain |
| `models/` | Mongoose schemas |
| `services/` | Reusable domain logic (payroll, leave, audit, pricing, exports) |
| `middlewares/` | Auth, permission, subscription/feature gates, uploads, validation |
| `cron/` | node-cron jobs registered at import time |
| `controllers/attandance/crons/` | Leave accrual / allocation jobs (started explicitly) |
| `src/notification/` | Full notification subsystem: queues, workers, providers, templates, scheduler |
| `utils/` | Logger, mailer, WhatsApp, Cloudinary, date/export helpers |
| `mcp-server/` | Separate MCP server (auth, tools, RAG, vector store) — not mounted in `server.js` |
| `templates/`, `docs/`, `tests/`, `Uploads/`, `logs/` | Supporting assets |

---

## Boot sequence

`server.js` runs top-level `await`, so the order below is strict:

1. `dotenv.config()`
2. `await connectDB()` — Mongoose connects to `MONGO_URI`. **Exits process on failure.**
3. Seed permissions `request.update` and `request.export` if missing (non-fatal).
4. `await connectRedis()` — creates **two** ioredis clients: `redisClient` (commands) and
   `redisSubscriber` (pub/sub). **Exits process on failure.**
5. `await startAllWorkers()` + `initializeSchedulers()` — 15 tier workers
   (email/whatsapp/push × 5 tiers) + dead-letter, retry and scheduler workers. Wrapped in
   `try/catch`: if Redis is flaky the API still starts, but notifications are disabled.
6. Express app is created: `cors()`, Morgan→Winston stream, JSON/urlencoded bodies (50 MB),
   15-minute request/response timeout and keep-alive headers.
7. Routes are mounted (`/api/...`, `/exports`, `/uploads`).
8. `app.listen(PORT)`; once listening:
   - `startAttendanceCron()` (auto-close attendance)
   - `startTaskSchedulers()` (task automation)
   - `LeaveMonthlyAccrualCron.initializeCron()`
   - `LeaveYearlyAllocationCron.initializeCron()`
   - `LeaveEarnedAccrualCron.initializeCron()`
9. Server timeouts raised: `server.timeout` 15 min, `keepAliveTimeout` 16 min,
   `headersTimeout` 17 min.
10. `SIGTERM` / `SIGINT` → close BullMQ workers and queues → close HTTP server → exit.

> Some crons are registered as a **side effect of importing them** from `server.js` (there is no
> initializer call): `cron/subscription.js`, `cron/markAbsent.cron.js`,
> `cron/markpunchout.cron.js`, `cron/markSalesSessionPunchOut.cron.js`,
> `cron/compOffExpiry.cron.js` and `models/Attandance/Holiydaycron.js`.
> See [04-CRON-JOBS.md](./04-CRON-JOBS.md).

---

## Request lifecycle

```
HTTP request
  → cors
  → morgan (writes to Winston stream)
  → express.json / urlencoded (50 MB)
  → timeout + keep-alive headers
  → router mount (/api/...)
    → optional authMiddleware / optionalAuth   (JWT → req.user)
    → checkPermission(key)                     (role/direct permission gate)
    → checkSubscription / checkFeature         (plan gating, where used)
    → validators, multer/upload middleware
    → controller
      → service (payroll, leave, audit, pricing…)
      → Mongoose model
      → response json / file stream
```

### Authentication

`middlewares/authMiddleware.js`:
- Reads `Authorization: Bearer <token>`, falls back to `req.cookies.token`.
- Verifies with `JWT_SECRET`, requires `decoded.id`.
- Loads the user with `-password -otp -__v` and merges it into `req.user` (JWT claims win).

`middlewares/optionalAuth.js` does the same but lets anonymous requests through.

### Authorization

`middlewares/checkPermission.js` returns a middleware factory. Order of checks:

1. `super_admin` and `partner` bypass everything.
2. User must belong to `companyId` (via an `Employee` record) — else `403`.
3. Roles `super_admin`, `admin`, `partner` bypass by default.
4. Direct permission from `AssingPermission.permissions` must include the key.
5. Otherwise `403 Forbidden: insufficient permissions`.

`middlewares/requireAuditPermission.js` is the audit-specific variant.

### Multi-tenancy

Almost every query is scoped by `companyId` taken from `req.user`. `utils/companyResolver.js`
and `utils/approvalScope.js` centralize the tenant and approval-scope rules. Cross-company reads
are only possible for global roles.

---

## Environment variables

Grouped by purpose (names only). Defaults are shown where the code defines one.

| Group | Variables |
|---|---|
| Core | `PORT` (5000), `NODE_ENV`, `MONGO_URI`, `JWT_SECRET` |
| Redis | `REDIS_HOST` (localhost), `REDIS_PORT` (6379), `REDIS_PASSWORD`, `REDIS_DB` (0) |
| Auth / OAuth | `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` |
| Admin panel | `ADMIN_PASSWORD` |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Razorpay | `RAZORPAY_API_KEY`, `RAZORPAY_API_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Email / SMTP | `SMTP_USER`, `SMTP_PASS`, `EMAIL_ID`, `EMAIL_SERVICE_ID`, `EMAIL_TEMPLATE_ID`, `EMAIL_USER_ID`, `EMAIL_LESS_SECURE_PASS`, `DISABLE_EMAIL` |
| WhatsApp | `WHATSAPP_API_KEY`, `WHATSAPP_SEND_OTP_URL`, `WHATSAPP_VERIFY_OTP_URL`, `WHATSAPP_TEMPLATE_NAME`, `QUICKHUB_API_KEY`, `DISABLE_WHATSAPP` |
| SMS / Push | `SMS_API_KEY`, `DISABLE_PUSH` |
| Face recognition | `FACE_API_KEY` |
| Email queue | `EMAIL_BATCH_SIZE` (400), `EMAIL_BATCH_INTERVAL` (86400000), `EMAIL_CONCURRENCY` (5), `EMAIL_MAX_RETRY` (5), `EMAIL_BACKOFF` (30000) |
| WhatsApp queue | `WHATSAPP_BATCH_SIZE` (30), `WHATSAPP_BATCH_INTERVAL` (60000), `WHATSAPP_CONCURRENCY` (5), `WHATSAPP_MAX_RETRY` (5), `WHATSAPP_BACKOFF` (30000) |
| Tier limits | `TIER_{CRITICAL,HIGH,NORMAL,LOW,BULK}_CONCURRENCY`, `TIER_*_RATE` |
| Priority / ageing | `NOTIFICATION_DEFAULT_PRIORITY` (2), `AGING_INTERVAL_MINUTES`, `AGING_BOOST_AFTER_MS_LOW`, `AGING_BOOST_AFTER_MS_BULK` |
| Circuit breaker | `CB_CRITICAL_HIGH_DEPTH_OPEN`, `CB_CRITICAL_HIGH_DEPTH_OPEN_ALL`, `CB_RECOVERY_DEPTH` |
| Locks | `LOCK_TTL` (60000), `LOCK_RETRY_DELAY` (100), `LOCK_RETRY_COUNT` (20) |
| Idempotency | `IDEMPOTENCY_TTL` (86400) |
| Dead letter | `DEAD_LETTER_MAX_RETRY` (5) |
| Job retention | `NOTIFICATION_JOB_REMOVE_COMPLETE` (1000), `NOTIFICATION_JOB_REMOVE_FAIL` (5000) |

---

## Response and error conventions

- Handlers return JSON directly; there is no global envelope.
- Errors are usually `{ message: string }`; auth failures use `401`, permission failures `403`,
  validation failures `400`, missing records `404`.
- `middlewares/errorHandler.js` and `middlewares/errorHandler.middleware.js` exist but are only
  wired on some routers (e.g. `/api/face`), so most controllers handle their own errors.
- Long-running exports stream files or return a download path; static exports are served from
  `/exports`, uploads from `/uploads`.

---

## Deployment notes

- `vercel.json` routes all traffic to `server.js`, but cron jobs and BullMQ workers require a
  long-lived process — Vercel serverless is not a supported target for those features.
- `server.timeout` / `keepAliveTimeout` are deliberately large because bulk uploads can take
  minutes.
- Graceful shutdown closes workers and queues before the HTTP server so in-flight jobs are not
  abandoned mid-write.
