# UAI Backend — Documentation

Documentation for the **UAI** attendance, payroll, sales, task and subscription backend
(Node.js + Express + MongoDB/Mongoose + Redis + BullMQ).

This folder is the single source of truth for the API surface, data model, scheduled jobs and
Redis usage. Everything that can be derived from code is **generated**; everything else is
hand-written and preserved between regenerations.

---

## Documentation map

| Document | What it answers |
|---|---|
| [00-ARCHITECTURE.md](./00-ARCHITECTURE.md) | How the service boots, request lifecycle, folder layout, env vars |
| [01-API-REFERENCE.md](./01-API-REFERENCE.md) | Every HTTP endpoint (method, path, auth, permission, handler, purpose) |
| [02-MODELS.md](./02-MODELS.md) | Every Mongoose schema and its fields |
| [03-CONTROLLERS.md](./03-CONTROLLERS.md) | Controller inventory: functions, models used, which routes call them |
| [04-CRON-JOBS.md](./04-CRON-JOBS.md) | node-cron schedules, BullMQ queues and workers, notification schedulers |
| [05-REDIS.md](./05-REDIS.md) | Redis connection, every key pattern, locks, idempotency, rate limiting |
| [06-MIDDLEWARES-AUTH.md](./06-MIDDLEWARES-AUTH.md) | Auth, permissions, validation, upload and scoping middleware |

### Existing deep-dive notes

These pre-date the generated docs and are still accurate; they are the authoritative detail for
their domains:

| Note | Domain |
|---|---|
| [AUDIT_API.md](./AUDIT_API.md) | Audit log investigation API (`/api/audit`) |
| [PAYROLL_API.md](./PAYROLL_API.md) | Payroll API |
| [LEAVE_RULES_API.md](./LEAVE_RULES_API.md) | Leave rules API |
| [APPROVAL_SCOPE_API.md](./APPROVAL_SCOPE_API.md) | Request approval scoping |
| [getSessions-api.md](./getSessions-api.md) | Sales session retrieval |

---

## Running the service

```bash
npm install
node server.js        # production entry
npm run dev           # nodemon
```

Required environment: `MONGO_URI`, `JWT_SECRET`, `PORT`, `REDIS_HOST`/`REDIS_PORT`.
See [00-ARCHITECTURE.md](./00-ARCHITECTURE.md#environment-variables) for the full list.

The server **fails hard** if MongoDB cannot be reached (`config/db.js`) or if Redis cannot be
reached (`config/redis.js`). Notification workers are initialized after Redis is up.

---

## Keeping these docs in sync

Two layers guarantee the docs match the code:

1. **Generator** — `scripts/generate-docs.mjs` reads the source and rewrites every
   `<!-- AUTO:START:... -->` block.

   ```bash
   npm run docs         # regenerate
   npm run docs:check   # exit 1 if docs are stale (CI / pre-commit)
   ```

2. **Agent rule** — [`AGENTS.md`](../AGENTS.md) at the repo root instructs any AI agent (and
   humans) to run `npm run docs` and update the relevant hand-written section after touching
   `routes/`, `controllers/`, `models/`, `cron/`, `config/redis.js` or `src/notification/`.

> Do not edit inside `<!-- AUTO:START:* -->` / `<!-- AUTO:END:* -->` markers — your changes will
> be overwritten. Put notes and explanations in the sections above or below the tables.

### What is generated vs. hand-written

| Section | Generated | Hand-written |
|---|---|---|
| `01-API-REFERENCE.md` | endpoint tables | module introductions, deep-dive notes |
| `02-MODELS.md` | field tables, hooks, indexes | model relationships, business rules |
| `03-CONTROLLERS.md` | function/model/route mapping | controller responsibilities |
| `04-CRON-JOBS.md` | schedule and queue tables | job behaviour, failure semantics |
| `05-REDIS.md` | key patterns | key ownership, lifecycle notes |
| `06-MIDDLEWARES-AUTH.md` | middleware inventory | auth/permission semantics |

---

## Conventions used in this documentation

- Paths are **absolute as mounted** (mount prefix from `server.js` + router path).
- `JWT` means `Authorization: Bearer <token>` is required; `Optional JWT` means the route also
  accepts anonymous callers; `—` means no auth middleware was detected.
- Permissions are the string keys passed to `checkPermission(...)`.
- All files paths are relative to the repository root.
- `AUTO` tables are sorted deterministically so diffs stay small.
