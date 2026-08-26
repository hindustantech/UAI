# Audit Log Investigation API

Production-grade audit investigation system for the UAI backend.

Base URL: `/api/audit` (mounted in `server.js`)
Authentication: `Authorization: Bearer <JWT>` (all endpoints)
Authorization: per-endpoint `audit.*` permission keys via `middlewares/requireAuditPermission.js`

---

## Endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/audit/logs` | `audit.read` | Paginated, filterable event list |
| GET | `/api/audit/stats` | `audit.read` | Alias of summary |
| GET | `/api/audit/summary` | `audit.read` | Aggregated org statistics |
| GET | `/api/audit/resource/:resource/:resourceId` | `audit.read` | Full history/timeline of one record |
| GET | `/api/audit/user/:userId` | `audit.read` | "What did this user do?" |
| GET | `/api/audit/:eventId` | `audit.read_detail` | Single event full detail |
| GET | `/api/audit/verify-chain` | `audit.verify` | Hash-chain integrity verification |
| GET | `/api/audit/suspicious` | `audit.read` | Statistical pattern scan |
| GET | `/api/audit/export` | `audit.export` | CSV export (capped, self-audited) |
| POST | `/api/audit/:eventId/deactivate` | `audit.deactivate` | Hide event from normal view (env-gated) |

> Route order note: explicit paths (`/logs`, `/stats`, …) are registered **before** the `/:eventId` catch-all. Previously `GET /api/audit/logs` fell through to the detail handler — this was fixed.

---

## Organization Isolation (enforced server-side)

- `scope=GLOBAL`, `super_admin`, or `partner` users may query any organization by passing `organizationId`.
- All other users are **pinned** to their own company: any `organizationId` query parameter is ignored and replaced by their token's `companyId`. Cross-org access is impossible at the database-query level (`services/audit/queryBuilder.js`), not filtered after fetch.

## Query Parameters (list / export)

AND-combined. Invalid values return HTTP 400; MongoDB errors never leak.

| Param | Example | Notes |
|---|---|---|
| `organizationId` | `69d4de01…` | Global-scope users only |
| `userId` | ObjectId | Actor filter |
| `resource` | `Employee` | Exact match |
| `resourceId` | `6a58a5c6…` | Exact match |
| `action` | `EMPLOYEE.UPDATE` | Exact match |
| `operation` | `UPDATE` | CREATE/UPDATE/DELETE/ACTIVATE/DEACTIVATE/PAYMENT/LOGIN/LOGOUT/APPROVE/REJECT/PROCESS/EXPORT/READ/OTHER |
| `eventType` | `FINANCIAL` | READ/WRITE/SECURITY/FINANCIAL/SYSTEM |
| `category` | `DATA` | Legacy categories still supported |
| `result` | `FAILURE` | SUCCESS/FAILURE/PARTIAL_SUCCESS/NOT_FOUND/NO_CHANGE/ROLLBACK/REJECTED/DENIED |
| `success` | `true` / `false` | Boolean |
| `method` | `PATCH` | Uppercased automatically |
| `requestId` | `req-42` | Exact match |
| `ip` | `127.0.0.1` | Escaped substring regex on `http.ip` |
| `from` | `2026-08-01T00:00:00.000Z` | `timestamp >= from` (UTC) |
| `to` | `2026-08-26T23:59:59.999Z` | `timestamp <= to` (UTC); `from > to` → 400 |
| `search` | `non_sales` | Safe $or across action/resource/resourceId/route/ip/errorCode/eventId (+userId when term looks like an ObjectId) |
| `page` / `limit` | `1` / `50` | Defaults 1/50, max limit 200 |
| `sortBy` / `sortOrder` | `timestamp` / `desc` | Whitelist: timestamp, action, resource, resourceId, userId, success, category, createdAt, eventType, operation |
| `includeHidden` | `true` | Only effective for GLOBAL users |

### Date handling
All dates parsed with `new Date()` and compared as UTC instants against `timestamp`. Invalid dates → **400**. `from > to` → **400** (no silent swap). Supports from-only, to-only, and range.

---

## Examples

```bash
# All activity for a company between Aug 1–26
curl -H "Authorization: Bearer $TOKEN" \
  "$HOST/api/audit/logs?organizationId=69d4de01d19cd0817fa3e6f4&from=2026-08-01T00:00:00.000Z&to=2026-08-26T23:59:59.999Z&page=1&limit=50"

# Every update made to employee X
curl -H "Authorization: Bearer $TOKEN" \
  "$HOST/api/audit/resource/Employee/6a58a5c6ad4df40e1a122ea8?action=EMPLOYEE.UPDATE"

# Everything user X changed today
curl -H "Authorization: Bearer $TOKEN" \
  "$HOST/api/audit/user/69c11d9fef51e3f596428862?from=$(date -u +%Y-%m-%dT00:00:00Z)"

# All salary changes this month
curl -H "Authorization: Bearer $TOKEN" \
  "$HOST/api/audit/logs?resource=Employee&search=salaryStructure&eventType=WRITE&from=2026-08-01T00:00:00.000Z"

# Show all failed operations
curl -H "Authorization: Bearer $TOKEN" "$HOST/api/audit/logs?success=false"

# Verify chain integrity for August
curl -H "Authorization: Bearer $TOKEN" \
  "$HOST/api/audit/verify-chain?organizationId=69d4de01d19cd0817fa3e6f4&from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z"
```

Response envelope:

```json
{
  "success": true,
  "data": [ /* normalized events */ ],
  "pagination": { "totalRecords": 1000, "totalPages": 20, "currentPage": 1, "perPage": 50, "hasNextPage": true, "hasPrevPage": false }
}
```

### Normalized event shape (presenter)

Historical records lacking `operation`/`eventType`/`changes` get them **derived at read time** from `action` + `oldData`/`newData`, so old data stays fully queryable:

```json
{
  "eventId": "bfd68b41-…",
  "timestamp": "2026-08-26T07:57:29.647Z",
  "actor": { "userId": "69c11d9f…", "userRole": "partner", "actorType": "USER" },
  "action": "EMPLOYEE.UPDATE",
  "operation": "UPDATE",
  "eventType": "WRITE",
  "severity": "INFO",
  "resource": "Employee",
  "resourceId": "6a58a5c6…",
  "success": true,
  "changedFields": ["employeeType"],
  "changes": [{ "field": "employeeType", "oldValue": "non_sales", "newValue": "sales" }],
  "http": { "method": "PATCH", "route": "/api/employee/…" },
  "chainInfo": { "chainScope": "69d4de01…", "seq": 27, "previousHash": "…", "currentHash": "…" }
}
```

---

## Change Detection (write time)

- `services/audit/diff.js` produces stable dotted paths (`salaryStructure.basic`, `officeLocation.radius`) plus a `changes[]` array.
- Ignored system fields: `updatedAt`, `createdAt`, `__v`, `_`-prefixed internals.
- CREATE events store the full created doc in `newData`; DELETE stores it in `oldData`; UPDATE stores both snapshots AND the diff.
- Raw snapshots always preserved regardless of diff output.

## Sensitive Data Protection

- Recursive redaction (`[REDACTED]`) for password/token/otp/secret/apiKey/authorization/cookie/cvv/pin etc., nested objects included.
- Financial identifiers (card/account numbers) masked to last-4 in metadata (`maskFinancialMetadata`).
- Circular-reference-safe serialization (WeakSet guard) — no `JSON.stringify(req)` anywhere; Express/Mongoose objects never enter audit records directly.
- Request bodies truncated at `AUDIT_MAX_BODY_SIZE_BYTES`.

## Append-Only & Deactivation

Audit records are append-only: there is **no** PUT/DELETE endpoint. Hiding uses lifecycle fields only:

```bash
POST /api/audit/<eventId>/deactivate   # requires audit.deactivate permission
{ "reason": "Administrative retention policy" }
```

- Gated by env var `AUDIT_LOG_DEACTIVATION_ENABLED=true` (default **off**) — returns 403 otherwise.
- Sets `visibilityStatus=HIDDEN`, `deactivatedAt`, `deactivatedBy`, `deactivationReason`. Original content untouched.
- Writes a companion `AUDIT.EVENT_DEACTIVATED` trail entry describing who hid what and why.
- Hidden events excluded from normal listings; GLOBAL users can inspect with `includeHidden=true`.

## Chain Verification

Each event carries `chainScope` (= organizationId or `__GLOBAL__`), monotonically increasing `seq`, `previousHash`, and `currentHash` = SHA-256 over canonical JSON of core fields + previousHash.

`GET /verify-chain` detects and reports:
`SEQUENCE_GAP`, `DUPLICATE_SEQ`, `CHAIN_BREAK`, `HASH_MISMATCH`, `MISSING_PREDECESSOR` (+ retention-gap notes).

```json
{
  "valid": false,
  "checked": 1000,
  "errors": [
    { "seq": 27, "type": "HASH_MISMATCH", "eventId": "…", "expected": "…", "actual": "…" }
  ]
}
```

Verification is read-only — records are never modified.

## Suspicious Activity

`GET /suspicious` runs conservative aggregation rules over the selected window (default last 7 days): high-volume deletes/updates per user, repeated failures, salary-change spikes, bulk deactivations, permission+financial combinations. Findings use labels `HIGH_VOLUME`, `MULTIPLE_FAILURES`, `SENSITIVE_CHANGE`, `UNUSUAL_ACTIVITY` with WARNING/CRITICAL severity — patterns, never verdicts.

Thresholds tunable via query params: `windowDays`, `deleteThreshold`, `updateThreshold`, `failureThreshold`, `salaryThreshold`, `deactivateThreshold`.

## Indexes

Compound indexes follow the universal access pattern (org prefix → secondary key → timestamp sort):

```
{ organizationId: 1, timestamp: -1 }                          primary listing
{ organizationId: 1, action: 1, timestamp: -1 }
{ organizationId: 1, resource: 1, timestamp: -1 }
{ organizationId: 1, resourceId: 1, timestamp: -1 }           resource timeline
{ organizationId: 1, resource: 1, resourceId: 1, timestamp: -1 }
{ organizationId: 1, userId: 1, timestamp: -1 }               user activity
{ organizationId: 1, success: 1, timestamp: -1 }              failed-op queries
{ organizationId: 1, category: 1, timestamp: -1 }
{ userId: 1, timestamp: -1 }                                  global/cron scope
{ chainScope: 1, seq: 1 } unique                              chain integrity
{ requestId: 1 }, { eventId: 1 }                              lookups
```

`oldData`/`newData` are deliberately never indexed. Mongoose creates these indexes on model startup (`ensureIndexes`).

## Reliability Semantics

- Audit writes are **after-commit, fire-and-forget**: they run outside business transactions, so MongoDB WriteConflict/TransientTransactionError in the audit path can never abort a business operation. Winston file logging is the fallback record.
- Idempotency: when an `x-request-id` header is present, an `idempotencyKey` (`requestId:action:resourceId`) guards against transaction/HTTP retry duplicates via a sparse-unique index. A dropped duplicate leaves a tolerable sequence gap (verifier-aware).

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AUDIT_LOG_ENABLED` | `true` | Master switch |
| `AUDIT_HASH_CHAIN_ENABLED` | `true` | Hash chaining |
| `AUDIT_LOG_RETENTION_DAYS` | `365` | Retention window (verification gap tolerance) |
| `AUDIT_MAX_BODY_SIZE_BYTES` | `16384` | Request-body truncation |
| `AUDIT_MAX_PAGINATION_LIMIT` | `100` | Hard cap |
| `AUDIT_EXPORT_MAX_ROWS` | `10000` | CSV row cap |
| `AUDIT_LOG_DEACTIVATION_ENABLED` | `false` | Enables hide-from-view endpoint |
| `AUDIT_SENSITIVE_FIELDS` | csv list | Extra sensitive keys |

## Tests

```bash
npm run test        # all tests
npm run test:audit  # audit suite only (98 tests)
```

Covers: deep diff (nested/arrays/null transitions/ignored fields), taxonomy derivation incl. legacy actions, sanitizer (redaction, circular refs, financial masking), query builder (org isolation, UTC date validation, sort whitelist, search mapping, hidden visibility), hash canonicalization determinism + tamper sensitivity.
