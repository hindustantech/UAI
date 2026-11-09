# AGENTS.md — rules for working in this repository

This file is read automatically by AI coding agents (OpenCode and compatible tools). It defines
non-negotiable project conventions.

---

## Documentation must stay in sync

`docs/` is the single source of truth for the API, data model, scheduled jobs and Redis usage.
It is **not optional** documentation — it is a deliverable.

### After ANY change to these paths

| Changed path | Required doc update |
|---|---|
| `routes/**` | `docs/01-API-REFERENCE.md` |
| `server.js` (mounts, boot order, env) | `docs/00-ARCHITECTURE.md`, `docs/01-API-REFERENCE.md` |
| `controllers/**` | `docs/03-CONTROLLERS.md`, `docs/01-API-REFERENCE.md` if a route changed |
| `models/**` | `docs/02-MODELS.md` |
| `cron/**`, `controllers/attandance/crons/**`, `src/notification/scheduler/**` | `docs/04-CRON-JOBS.md` |
| `config/redis.js`, `src/notification/**` (Redis usage), BullMQ queues | `docs/05-REDIS.md`, `docs/04-CRON-JOBS.md` |
| `middlewares/**` | `docs/06-MIDDLEWARES-AUTH.md` |

### Mandatory steps

1. Run the generator:

   ```bash
   npm run docs
   ```

2. Review the diff. The generator refreshes everything between
   `<!-- AUTO:START:* -->` and `<!-- AUTO:END:* -->` markers.

3. If you added, removed or changed **behaviour** (not just signatures), update the
   hand-written section of the same file — new endpoint semantics, new env var, new Redis key,
   new cron job, changed permission requirement, etc.

4. Run the staleness check before finishing:

   ```bash
   npm run docs:check
   ```

   It must exit `0`. If it exits `1`, run `npm run docs` again and re-check.

### Rules

- **Never** edit text inside `<!-- AUTO:START:* -->` / `<!-- AUTO:END:* -->` — it is overwritten.
- **Never** delete a marker block; the generator will report the file as broken.
- Keep table rows valid Markdown: no raw `|` inside a cell (the generator escapes them).
- Do not reorder or rename generated sections — the generator sorts deterministically.
- If you add a new doc file, add it to the map in `docs/README.md` and register its AUTO block
  in `scripts/generate-docs.mjs` (`BLOCK_FILES`).

---

## Code conventions

- ESM only (`"type": "module"`); use `import`, not `require`.
- Routers contain no business logic — controller → service → model.
- Every tenant-scoped query must filter by `companyId` from `req.user`.
- Protect routes with `authMiddleware` (or `optionalAuth` for public-with-context) and a
  `checkPermission('<resource>.<action>')` gate when the action is privileged.
- Long-running work belongs in a service or a BullMQ job, not in the request handler.
- Cron jobs that can run on multiple instances must take a Redis lock
  (`acquireLock` / `withLock` from `src/notification/utils/redisLock.js`).
- Notifications go through `NotificationService` / the notification subsystem — do not send
  email/WhatsApp/push inline.

---

## Commands

```bash
npm run dev          # nodemon
node server.js       # production entry
npm test             # node:test suites
npm run docs         # regenerate docs
npm run docs:check   # fail if docs are stale
```
