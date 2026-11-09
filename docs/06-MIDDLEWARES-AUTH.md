# Middleware, Auth & Permissions

Everything that runs between the router and a controller. The inventory table is generated;
the semantics below are hand-written and are the important part.

---

## Authentication flow

```
Authorization: Bearer <jwt>   (or cookie: token)
   │
   ├─ authMiddleware      → 401 if missing/invalid, loads req.user (JWT claims + DB user)
   └─ optionalAuth        → sets req.user = null when no token, never rejects
```

Token payload must contain `id`. The user document is fetched with `-password -otp -__v` and
merged over the claims, so **JWT values win** when keys collide.

`checkuser.js` exports an older `authMiddleware1` that is not used by the mounted routers.

## Authorization flow

```
checkPermission(permissionKey, { allowRoles })
   │
   ├─ req.user missing                → 401 Unauthorized
   ├─ user.type ∈ {super_admin, partner} → next()
   ├─ user.companyId missing          → 400 CompanyId required
   ├─ no Employee row for company     → 403 not part of company
   ├─ employee.role ∈ allowRoles      → next()      (default: super_admin, admin, partner)
   ├─ AssingPermission.permissions contains key → next()
   └─ otherwise                       → 403 Forbidden
```

`requireAuditPermission` is a thin wrapper that maps `audit.*` keys onto the same
`AssingPermission` store.

## Subscription and feature gating

| Middleware | Behaviour |
|---|---|
| `checkSubscription.js` | Resolves the company's active subscription and attaches it (used before feature checks) |
| `subscription.js` → `requireActiveSubscription` | 403 `No active subscription` when the company has none |
| `checkFeature.js` → `checkFeature(key)` | 403 when `hasFeatureAccess(req.subscription, key)` is false |
| `subscriptionMiddleware.js` → `updateEmployeeCountAfterCreate` | Wraps `res.json` to increment the subscription's employee count after a successful create |

## Ownership and tenant scoping

- `rolebasedownership.js` attaches `req.ownership` (`createdBy` or owner id) based on the user's
  type; `agency`, `super_admin` and `admin` own what they create.
- `utils/companyResolver.js` and `utils/approvalScope.js` are used inside controllers to resolve
  which company/approval chain a request belongs to. They are not Express middleware.

## Validation

- `taskValidation.js` → `validateTask` validates task payloads (title, dates, duration,
  priority, recurrence) and returns `400` with `{ code: 'VALIDATION_ERROR' }`.
- `couponValidation.js` → `validateCouponMiddleware` validates `couponCode` against a plan and
  amount.
- `express-validator` chains live next to their controllers (e.g.
  `controllers/attandance/attendanceValidation.js`) and end with `handleValidationErrors`.

## Uploads

| Middleware | Storage | Notes |
|---|---|---|
| `multer.js` | memory | `chunkUpload` (10 MB chunks), `singleFileUpload` |
| `upload.js` | disk `uploads/` | Generic uploads |
| `uploadMiddleware.js` | disk `uploads/links/` | Link attachments, timestamped names |
| `profileUploadMiddleware.js` | disk `Uploads/ProfileImages` | Profile images |
| `src/notification/middleware/upload.middleware.js` | memory | Face images only (`jpeg/jpg/png/webp`, 10 MB default) |

Static serving: `/uploads` → `uploads/` (`server.js`), `/exports` → `exports/`.

## Body parsing special case

`rawBody.js` captures the raw UTF-8 body for the Razorpay webhook
(`/api/wallet/webhook/razorpay`) so the signature can be verified. It must run before
`express.json()` for that route.

## Error handling

- `errorHandler.js` handles `AppError` and unknown errors, logs the stack, returns a JSON error.
- `errorHandler.middleware.js` is the face-API variant (default export, `{ success, message,
  details }`) and is mounted **last** inside `routes/face/index.js`.

> There is no global `app.use(errorHandler)` in `server.js`; most routers do their own
> `try/catch`. If you add a global handler, mount it after all routes.

---

<!-- AUTO:START:middleware -->
| Middleware file | Exports |
|---|---|
| `middlewares/authMiddleware.js` | `default (authMiddleware)` |
| `middlewares/checkFeature.js` | `checkFeature` |
| `middlewares/checkLimt/checklimit.js` | `checkLimit` |
| `middlewares/checkPermission.js` | `checkPermission` |
| `middlewares/checkSubscription.js` | `checkFreeSubscription`, `checkSubscription` |
| `middlewares/checkuser.js` | `authMiddleware1`, `isSuperAdmin` |
| `middlewares/couponValidation.js` | `validateCouponMiddleware` |
| `middlewares/errorHandler.js` | `errorHandler` |
| `middlewares/errorHandler.middleware.js` | `default (function)` |
| `middlewares/multer.js` | `chunkUpload`, `singleFileUpload` |
| `middlewares/optionalAuth.js` | `default (optionalAuth)` |
| `middlewares/profileUploadMiddleware.js` | `default (profileUploadMiddleware)` |
| `middlewares/rawBody.js` | `rawBodyMiddleware` |
| `middlewares/requireAuditPermission.js` | `default (requireAuditPermission)`, `requireAuditPermission` |
| `middlewares/rolebasedownership.js` | `roleBasedOwnership` |
| `middlewares/subscription.js` | `requireActiveSubscription`, `requirePaidPlan` |
| `middlewares/subscriptionMiddleware.js` | `decrementEmployeeCount`, `incrementEmployeeCount`, `updateEmployeeCountAfterCreate` |
| `middlewares/taskValidation.js` | `validateTask` |
| `middlewares/upload.js` | `upload`, `uploadSingle` |
| `middlewares/upload.middleware.js` | `uploadBatch`, `uploadSingle` |
| `middlewares/uploadMiddleware.js` | `default (upload)` |
| `src/notification/middleware/adminAuth.js` | `requireAdmin` |
<!-- AUTO:END:middleware -->

---

## Notes

Document permission keys and role matrices here as they evolve.

> Put notes **outside** the AUTO markers above.
