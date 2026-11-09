# UAI Backend

Node.js + Express + MongoDB backend for the UAI HR platform (attendance, payroll, sales,
tasks, subscriptions, audit, notifications).

## Quick start

```bash
npm install
npm run dev      # nodemon
node server.js   # production entry
```

Requires MongoDB (`MONGO_URI`), Redis (`REDIS_HOST`/`REDIS_PORT`) and `JWT_SECRET`.
The process exits if MongoDB or Redis is unreachable at boot.

## Documentation

Full documentation lives in [`docs/`](./docs/README.md):

| Document | Contents |
|---|---|
| [docs/README.md](./docs/README.md) | Index and how to keep docs current |
| [docs/00-ARCHITECTURE.md](./docs/00-ARCHITECTURE.md) | Boot order, request lifecycle, env vars |
| [docs/01-API-REFERENCE.md](./docs/01-API-REFERENCE.md) | All HTTP endpoints |
| [docs/02-MODELS.md](./docs/02-MODELS.md) | Mongoose schemas |
| [docs/03-CONTROLLERS.md](./docs/03-CONTROLLERS.md) | Controller → route mapping |
| [docs/04-CRON-JOBS.md](./docs/04-CRON-JOBS.md) | node-cron + BullMQ |
| [docs/05-REDIS.md](./docs/05-REDIS.md) | Redis keys, locks, rate limits |
| [docs/06-MIDDLEWARES-AUTH.md](./docs/06-MIDDLEWARES-AUTH.md) | Auth, permissions, uploads |

## Keeping docs in sync

```bash
npm run docs         # regenerate AUTO blocks from code
npm run docs:check   # fails if docs are stale
```

`AGENTS.md` requires any change under `routes/`, `controllers/`, `models/`, `cron/`,
`config/redis.js`, `src/notification/` or `middlewares/` to be followed by `npm run docs`
and a hand-written note update.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Nodemon dev server |
| `npm start` | `node server.js` |
| `npm test` | Node test runner (`tests/**/*.test.js`) |
| `npm run test:audit` | Audit tests only |
| `npm run docs` | Regenerate documentation |
| `npm run docs:check` | Documentation staleness check |
