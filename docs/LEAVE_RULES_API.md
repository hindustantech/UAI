# Leave Rules API — Frontend Integration Guide

Base URL: `/api`

All endpoints return JSON. Authenticate with either:

```
Authorization: Bearer <JWT_TOKEN>
```

or the `token` cookie.

> **Company scoping:** the backend derives `companyId` from the logged-in user.
> For `partner` users the user `_id` is used as the company id; everyone else uses
> `req.user.companyId`. You never send `companyId` on leave-type/policy endpoints.

---

## 1. Permission keys

| Permission | Used by |
|---|---|
| `leave.create` | Create leave type |
| `leave.read` | List leave types |
| `leave.update` | Update leave type |
| `leave.delete` | Deactivate leave type |
| `policy.create` | Create leave policy |
| `policy.read` | List / resolve policies |
| `policy.update` | Update policy |
| `policy.delete` | Deactivate policy |
| `policy.assign` | Assign policy to employees |
| `balance.adjust` | Manual credit/debit |

`super_admin` and `partner` users bypass permission checks. All other users need
the key present in their `AssingPermission.permissions` array, or an employee
role listed in the route's `allowRoles` (default `super_admin`, `admin`).

`GET /api/leave/balances/me` requires authentication only — no extra permission.

---

## 2. Enums and shared shapes

### Leave category (`LeaveType.category`)

| Value | Meaning |
|---|---|
| `yearly_fixed` | Fixed quota per financial year |
| `monthly` | Credited every month |
| `earned` | Accrued from attendance |

### Leave request status

`pending` | `approved` | `rejected` | `cancelled`

### Leave request type

`leave` | `punch_in_out` | `punch_in` | `punch_in_and_out` | `overtime` | `comp_off`

### LeaveBalance object

```json
{
  "_id": "674f...",
  "companyId": "674f...",
  "employeeId": "674f...",
  "leaveTypeId": {
    "_id": "674f...",
    "name": "Casual Leave",
    "code": "CL",
    "category": "monthly",
    "paid": true
  },
  "policyId": "674f...",
  "year": 2026,
  "allocated": 12,
  "carriedForward": 0,
  "used": 2,
  "pending": 1,
  "expired": 0,
  "adjusted": 0,
  "balance": 9,
  "monthly": [
    { "month": 1, "credited": 1, "used": 0, "carriedForward": 0, "expired": 0 }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-10-30T00:00:00.000Z"
}
```

Balance accounting:

- `balance` — available days the employee can currently use.
- `pending` — days held by pending leave requests (not yet approved).
- `used` — days consumed by approved leave.
- `allocated` — days credited (yearly/monthly/earned).
- `adjusted` — manual admin adjustments (signed).
- Creating a leave request: `pending += days`, `balance -= days`.
- Approving: `pending -= days`, `used += days`.
- Rejecting / cancelling: `pending -= days`, `balance += days`.

### LeavePolicy `leaveRules[]` item

```json
{
  "leaveTypeId": "674f...",
  "accrual": {
    "yearlyQuota": 15,
    "eligibility": { "afterMonths": 0, "afterDays": 0 },
    "allocationMode": "lumpsum",
    "prorateOnJoining": false,
    "creditPerMonth": 1,
    "creditOnDay": 1,
    "prorateFirstMonth": false,
    "workingDaysPerCredit": 20,
    "creditDays": 1,
    "countStatuses": ["present", "half_day"],
    "halfDayCredit": 0.5,
    "countFrom": "joining"
  },
  "limits": {
    "maxPerMonth": null,
    "maxPerYear": null,
    "maxPerRequest": null
  },
  "lifecycle": {
    "unusedAction": "lapse",
    "carryTo": "month",
    "maxCarryDays": null,
    "carryExpiryMonths": null
  },
  "requestRules": {
    "minNoticeDays": 0,
    "allowBackdated": false,
    "allowHalfDay": false,
    "requiresAttachment": false
  }
}
```

Field reference:

| Field | Type | Default | Notes |
|---|---|---|---|
| `yearlyQuota` | number | 15 | Used for `yearly_fixed` |
| `eligibility.afterMonths` | number | 0 | Waiting period after joining |
| `eligibility.afterDays` | number | 0 | Extra waiting days |
| `allocationMode` | `lumpsum` \| `monthly_prorated` | `lumpsum` | Yearly allocation style |
| `prorateOnJoining` | boolean | false | Prorate first year |
| `creditPerMonth` | number | 1 | Monthly credit amount |
| `creditOnDay` | number | 1 | Day of month to credit |
| `prorateFirstMonth` | boolean | false | Prorate joining month |
| `workingDaysPerCredit` | number | 20 | Earned leave: attendance days per credit |
| `creditDays` | number | 1 | Days credited per block |
| `countStatuses` | string[] | `["present","half_day"]` | Attendance statuses counted |
| `halfDayCredit` | number | 0.5 | Value of a half-day record |
| `countFrom` | `joining` \| `last_credit` \| `year_start` | `joining` | Earned accrual start |
| `maxPerMonth` | number \| null | null | Monthly cap |
| `maxPerYear` | number \| null | null | Yearly cap |
| `maxPerRequest` | number \| null | null | Per-request cap |
| `unusedAction` | `lapse` \| `carry_forward` | `lapse` | Year-end handling |
| `carryTo` | `month` \| `year` \| `both` | `month` | Carry-forward target |
| `maxCarryDays` | number \| null | null | Carry-forward cap |
| `carryExpiryMonths` | number \| null | null | Carry-forward expiry |
| `minNoticeDays` | number | 0 | Advance notice required |
| `allowBackdated` | boolean | false | Backdated requests allowed |
| `allowHalfDay` | boolean | false | Half-day leave allowed |
| `requiresAttachment` | boolean | false | Document required |

> The rule's `category` is **not** stored on the policy. It is taken from the
> referenced `LeaveType.category`. Always create the leave type before the policy.

---

## 3. Leave Types

### 3.1 Create leave type

`POST /api/leave` — permission `leave.create`

Request:

```json
{
  "name": "Casual Leave",
  "code": "CL",
  "category": "monthly",
  "paid": true,
  "allowHalfDay": true
}
```

- `name`, `code`, `category` are required.
- `code` must be unique per company.

Response `201`:

```json
{
  "success": true,
  "data": {
    "_id": "674f...",
    "companyId": "674f...",
    "name": "Casual Leave",
    "code": "CL",
    "category": "monthly",
    "paid": true,
    "allowHalfDay": true,
    "isActive": true,
    "createdAt": "2026-10-30T00:00:00.000Z",
    "updatedAt": "2026-10-30T00:00:00.000Z"
  }
}
```

Errors: `400` missing fields / duplicate code, `403` permission, `500`.

### 3.2 List leave types

`GET /api/leave` — permission `leave.read`

Response `200`:

```json
{
  "success": true,
  "data": [
    { "_id": "674f...", "name": "Casual Leave", "code": "CL", "category": "monthly", "paid": true, "allowHalfDay": true, "isActive": true }
  ]
}
```

Only active types are returned.

### 3.3 Update leave type

`PUT /api/leave/:id` — permission `leave.update`

Request (any subset of fields):

```json
{ "name": "Casual Leave (Updated)", "paid": false, "allowHalfDay": true }
```

Response `200`:

```json
{ "success": true, "data": { "_id": "674f...", "name": "Casual Leave (Updated)", "...": "..." } }
```

Errors: `400` invalid id, `404` not found.

### 3.4 Deactivate leave type

`DELETE /api/leave/:id` — permission `leave.delete`

Soft delete (`isActive = false`).

Response `200`:

```json
{ "success": true, "message": "Leave type deactivated" }
```

---

## 4. Leave Policies

### 4.1 Create policy

`POST /api/leave/policies` — permission `policy.create`

Request:

```json
{
  "name": "Standard 2026",
  "description": "Default policy for full-time employees",
  "financialYearStartMonth": 1,
  "isDefault": false,
  "leaveRules": [
    {
      "leaveTypeId": "674f...",
      "accrual": {
        "yearlyQuota": 15,
        "eligibility": { "afterMonths": 0, "afterDays": 0 },
        "allocationMode": "lumpsum"
      },
      "limits": { "maxPerYear": 15, "maxPerRequest": 5 },
      "lifecycle": { "unusedAction": "carry_forward", "carryTo": "year", "maxCarryDays": 5 },
      "requestRules": { "minNoticeDays": 1, "allowBackdated": false, "allowHalfDay": true, "requiresAttachment": false }
    }
  ]
}
```

- `name` required.
- `financialYearStartMonth` 1–12 (default `1` = January).
- Every `leaveTypeId` must reference an existing leave type.

Response `201`:

```json
{ "success": true, "data": { "_id": "674f...", "name": "Standard 2026", "financialYearStartMonth": 1, "leaveRules": [ "..." ], "isActive": true } }
```

### 4.2 List policies

`GET /api/leave/policies` — permission `policy.read`

`leaveRules.leaveTypeId` is populated:

```json
{
  "success": true,
  "data": [
    {
      "_id": "674f...",
      "name": "Standard 2026",
      "financialYearStartMonth": 1,
      "leaveRules": [
        {
          "leaveTypeId": { "_id": "674f...", "name": "Casual Leave", "code": "CL", "category": "monthly", "paid": true },
          "accrual": { "..." : "..." }
        }
      ]
    }
  ]
}
```

### 4.3 Resolve a policy

`GET /api/leave/policies/:id/resolved` — permission `policy.read`

Returns the policy with populated leave types (name, code, category, paid,
allowHalfDay). Use this when rendering the policy editor.

```json
{ "success": true, "data": { "_id": "674f...", "leaveRules": [ { "leaveTypeId": { "name": "Casual Leave", "category": "monthly" } } ] } }
```

### 4.4 Update policy

`PUT /api/leave/policies/:id` — permission `policy.update`

Send any subset of policy fields (same shape as create). Replacing `leaveRules`
replaces the whole array.

```json
{ "name": "Standard 2026 v2", "leaveRules": [ "..." ] }
```

Response `200`: `{ "success": true, "data": { "...": "..." } }`

### 4.5 Deactivate policy

`DELETE /api/leave/policies/:id` — permission `policy.delete`

```json
{ "success": true, "message": "Policy deactivated" }
```

### 4.6 Assign policy to employees

`POST /api/leave/policies/:id/assign` — permission `policy.assign`

Request:

```json
{ "employeeIds": ["674f...", "674f..."] }
```

This sets `employee.leavePolicy.policyId` and clears previous per-employee
overrides.

Response `200`:

```json
{ "success": true, "message": "Policy assigned to employees", "modified": 2 }
```

---

## 5. Balances

### 5.1 My balances

`GET /api/leave/balances/me?year=2026` — authentication only

Query:

| Param | Type | Default | Notes |
|---|---|---|---|
| `year` | number | current year | Balance year |

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "_id": "674f...",
      "employeeId": "674f...",
      "leaveTypeId": { "_id": "674f...", "name": "Casual Leave", "code": "CL", "category": "monthly", "paid": true },
      "year": 2026,
      "allocated": 12,
      "used": 2,
      "pending": 1,
      "balance": 9,
      "monthly": [ "..." ]
    }
  ],
  "balance": 9
}
```

`balance` at the root is the sum of all leave types.

Errors: `404` employee record not found.

### 5.2 Manual adjustment (admin)

`POST /api/leave/balances/:employeeId/adjust` — permission `balance.adjust`

Request:

```json
{
  "leaveTypeId": "674f...",
  "days": 2.5,
  "reason": "Compensation for weekend work",
  "year": 2026
}
```

- `days > 0` credits leave (`allocated`, `balance` increase; `adjusted` increases by the amount).
- `days < 0` debits leave (`used` increases; `adjusted` and `balance` change by the negative amount).
- `year` optional (defaults to current year).

Response `200`:

```json
{ "success": true, "balance": 11.5, "data": { "_id": "674f...", "balance": 11.5, "...": "..." } }
```

Errors: `400` invalid ids / zero days, `404` employee not found.

---

## 6. Leave requests (attendance request API)

Base path: `/api/attendance/requests`

These routes use `optionalAuth`, but send the bearer token for user-scoped data.

### 6.1 Create a leave request

`POST /api/attendance/requests`

Request:

```json
{
  "requestType": "leave",
  "reason": "Family function",
  "leaveTypeId": "674f...",
  "leaveDetails": {
    "startDate": "2026-11-02",
    "endDate": "2026-11-03"
  }
}
```

Notes:

- `leaveTypeId` is required for leave requests (top-level or inside `leaveDetails`).
- `leaveDays` is calculated by the server (weekly offs, half-day offs and
  company holidays are excluded). Do not send it.
- If the employee has a policy, eligibility and balance are validated. The days
  are reserved (`pending`) immediately.
- If the employee has no policy assigned, no balance check is performed.
- Overlapping pending/approved leave requests are rejected.
- Admins can create on behalf of an employee with `?userId=<userId>`.

Response `201`:

```json
{
  "success": true,
  "message": "Request created successfully",
  "data": {
    "_id": "674f...",
    "companyId": "674f...",
    "employeeId": {
      "_id": "674f...",
      "userId": { "_id": "674f...", "name": "Jane Doe", "email": "jane@x.com", "profileImage": "..." }
    },
    "requestType": "leave",
    "reason": "Family function",
    "leaveDetails": { "startDate": "2026-11-02T00:00:00.000Z", "endDate": "2026-11-03T00:00:00.000Z" },
    "leaveTypeId": "674f...",
    "leaveDays": 2,
    "isPaid": true,
    "balanceBefore": 11,
    "balanceAfter": 9,
    "policyId": "674f...",
    "status": "pending",
    "createdAt": "2026-10-30T00:00:00.000Z",
    "updatedAt": "2026-10-30T00:00:00.000Z"
  }
}
```

Errors:

| Status | Message examples |
|---|---|
| `400` | `startDate and endDate are required`, `leaveTypeId is required for leave requests`, `Leave request overlaps existing request`, `Leave not eligible before <date>`, `No chargeable working days in the requested range`, `Insufficient leave balance (available: X, required: Y)` |
| `404` | `Employee not found` |
| `500` | server error |

### 6.2 List requests

`GET /api/attendance/requests`

Query:

| Param | Type | Notes |
|---|---|---|
| `status` | string | `pending`, `approved`, `rejected`, `cancelled` |
| `requestType` | string | `leave`, `punch_in_out`, ... |
| `startDate` | date | Filter by `createdAt >= startDate` |
| `endDate` | date | Filter by `createdAt <= endDate` |
| `department` | string | Approver scope filter |
| `page` | number | default `1` |
| `limit` | number | default `10` |
| `companyId` | string | defaults to user's company |
| `userId` | string | used to resolve the employee record |

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "_id": "674f...",
      "requestType": "leave",
      "status": "pending",
      "leaveDetails": { "startDate": "...", "endDate": "..." },
      "leaveTypeId": "674f...",
      "leaveDays": 2,
      "balanceBefore": 11,
      "balanceAfter": 9,
      "employeeId": { "_id": "674f...", "userId": { "name": "Jane Doe" } },
      "approvedBy": null,
      "canApprove": true,
      "canApproveReason": null,
      "createdAt": "..."
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1 }
}
```

Use `canApprove` / `canApproveReason` to enable/disable action buttons.

### 6.3 Get single request

`GET /api/attendance/requests/:requestId`

Response `200`:

```json
{ "success": true, "data": { "_id": "674f...", "canApprove": true, "canApproveReason": null, "...": "..." } }
```

Errors: `400` invalid id, `403` not owner/approver, `404` not found.

### 6.4 Update a pending leave request

`PUT /api/attendance/requests/:requestId/update/:companyId`

Request:

```json
{
  "reason": "Updated reason",
  "leaveDetails": { "startDate": "2026-11-02", "endDate": "2026-11-04" }
}
```

Only pending requests can be updated. If the dates change, the server recomputes
`leaveDays` and adjusts the reservation (reserves or releases the difference).

Response `200`:

```json
{ "success": true, "message": "Request updated successfully", "data": { "...": "..." } }
```

Errors: `400` invalid dates / insufficient balance / not pending, `404` not found.

### 6.5 Cancel a pending request (employee)

`PUT /api/attendance/requests/:requestId/cancel/:companyId`

No body required. Reserved leave is released back to the employee.

Response `200`:

```json
{ "success": true, "message": "Request cancelled successfully", "data": { "status": "cancelled", "...": "..." } }
```

Errors: `400` not pending / older than 7 days, `404` not found.

### 6.6 Approve a request (admin/approver)

`PUT /api/attendance/requests/:requestId/approve`

No body required. Reserved leave is consumed (`pending` → `used`).

Response `200`:

```json
{ "success": true, "message": "Request approved successfully", "data": { "status": "approved", "approvedBy": "674f...", "approvedAt": "...", "balanceAfter": 9 } }
```

Errors: `403` not allowed to approve, `500` not found / already processed.

### 6.7 Reject a request (admin/approver)

`PUT /api/attendance/requests/:requestId/reject`

Request:

```json
{ "reason": "Insufficient notice" }
```

`reason` is required. Reserved leave is released back to the employee.

Response `200`:

```json
{ "success": true, "message": "Request rejected successfully", "data": { "status": "rejected", "rejectionReason": "Insufficient notice", "...": "..." } }
```

### 6.8 Bulk approve

`POST /api/attendance/requests/bulk-approve`

Request:

```json
{ "requestIds": ["674f...", "674f..."] }
```

Response `200`:

```json
{
  "success": true,
  "message": "Bulk approval completed. 2 approved, 0 failed",
  "data": {
    "approved": ["674f...", "674f..."],
    "failed": []
  }
}
```

### 6.9 Request statistics

`GET /api/attendance/requests/statistics`

Response `200`:

```json
{
  "success": true,
  "data": {
    "byStatus": [{ "_id": "pending", "count": 4 }],
    "byType": [{ "_id": "leave", "count": 3 }],
    "byMonth": [{ "_id": { "year": 2026, "month": 10 }, "count": 7 }],
    "pending": 4,
    "total": 7
  }
}
```

---

## 7. Recommended frontend flow

1. **Admin — setup**
   1. `POST /api/leave` to create leave types (CL, SL, EL, ...).
   2. `POST /api/leave/policies` referencing those leave type ids.
   3. `POST /api/leave/policies/:id/assign` with employee ids.
2. **Employee — apply**
   1. `GET /api/leave/balances/me?year=YYYY` to show available days.
   2. `POST /api/attendance/requests` with `requestType: "leave"`, `leaveTypeId`
      and `leaveDetails`.
   3. Show `leaveDays`, `balanceBefore`, `balanceAfter` from the response.
3. **Approver — process**
   1. `GET /api/attendance/requests?status=pending&requestType=leave`.
   2. Use `canApprove` to render action buttons.
   3. `PUT .../:requestId/approve` or `PUT .../:requestId/reject`.
4. **Employee — cancel**
   - `PUT /api/attendance/requests/:requestId/cancel/:companyId` for pending
     requests (releases the reserved balance).

---

## 8. Example fetch calls

```js
const API = "/api";
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

// 1. Create leave type
await fetch(`${API}/leave`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: "Sick Leave", code: "SL", category: "yearly_fixed", paid: true }),
});

// 2. Create policy
await fetch(`${API}/leave/policies`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "Standard 2026",
    financialYearStartMonth: 1,
    leaveRules: [
      {
        leaveTypeId: sickLeaveId,
        accrual: { yearlyQuota: 12, eligibility: { afterMonths: 0, afterDays: 0 } },
        limits: { maxPerYear: 12 },
        requestRules: { minNoticeDays: 0, allowHalfDay: true },
      },
    ],
  }),
});

// 3. Assign policy
await fetch(`${API}/leave/policies/${policyId}/assign`, {
  method: "POST",
  headers,
  body: JSON.stringify({ employeeIds: [empId1, empId2] }),
});

// 4. My balances
const balances = await fetch(`${API}/leave/balances/me?year=2026`, { headers }).then(r => r.json());

// 5. Apply for leave
const created = await fetch(`${API}/attendance/requests`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    requestType: "leave",
    reason: "Medical appointment",
    leaveTypeId: sickLeaveId,
    leaveDetails: { startDate: "2026-11-02", endDate: "2026-11-03" },
  }),
}).then(r => r.json());

// 6. Approve
await fetch(`${API}/attendance/requests/${requestId}/approve`, {
  method: "PUT",
  headers,
});

// 7. Reject
await fetch(`${API}/attendance/requests/${requestId}/reject`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ reason: "Insufficient notice" }),
});
```

---

## 9. Common error envelope

```json
{ "success": false, "message": "Human readable error" }
```

| Status | Meaning |
|---|---|
| `400` | Validation error (bad payload, insufficient balance, ineligible) |
| `401` | Missing/invalid token |
| `403` | Permission denied / not allowed to approve |
| `404` | Resource not found |
| `500` | Server error |

---

## 10. Automatic accrual (no frontend action)

Background cron jobs credit balances automatically:

| Job | Schedule | Behaviour |
|---|---|---|
| Monthly accrual | 1st of every month, 00:10 | Credits `creditPerMonth` for `monthly` leave types |
| Yearly allocation | Daily, 01:00 | Allocates `yearlyQuota` once per financial year |
| Earned accrual | Daily, 02:00 | Credits earned leave from qualifying attendance |

They are idempotent, so re-running does not double-credit.
