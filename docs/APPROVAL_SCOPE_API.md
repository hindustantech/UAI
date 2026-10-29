# Approval Scope API

Frontend integration guide for assigning `request.update` with a configurable approval scope.

Base URL: `/api` (mounted in `server.js`)
Authentication: `Authorization: Bearer <JWT>` on every endpoint
Permission required to assign/remove: `permission.assign`

---

## Endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| POST | `/api/permissionRoutes/assign` | `permission.assign` | Assign a permission and optionally set its approval scope |
| POST | `/api/permissionRoutes/remove` | `permission.assign` | Remove a permission from a user |
| GET | `/api/permissionRoutes/getUserPermissions` | authenticated | Read a user's assignment, including scope |

> The permission that controls attendance/leave approvals is `request.update`.

---

## Assign API

### `POST /api/permissionRoutes/assign`

#### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | ObjectId | Yes | User receiving the permission |
| `permissionKey` | string | Yes | Permission key, e.g. `request.update` |
| `companyId` | ObjectId | No | Defaults to the caller's `companyId` |
| `scope` | object \| string | No | Approval scope. Alias: `approvalScope` |
| `scope.type` | string | No | `department` (default), `departments`, or `company` |
| `scope.departments` | string[] | No | Departments used when `type` is `departments` |

`scope` may also be sent as a plain string: `"department"`, `"departments"`, or `"company"`.

#### Scope types

| Type | Meaning | `departments` |
|---|---|---|
| `department` | Approver can only act on requests from their own `jobInfo.department` | Ignored |
| `departments` | Approver can act on requests from the listed departments | Required; case/space-insensitive matching |
| `company` | Approver can act on any request in the company (own requests still blocked) | Ignored |

If `type` is `departments` but the list is empty, the backend falls back to `department`.
If no `scope` is sent, the stored/default scope is `department`.

#### Example: selected departments

```http
POST /api/permissionRoutes/assign
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "userId": "66f1c2a4e1b2c3d4e5f6a7b8",
  "permissionKey": "request.update",
  "companyId": "66f1c2a4e1b2c3d4e5f6a7b9",
  "scope": {
    "type": "departments",
    "departments": ["Sales", "Human Resources"]
  }
}
```

#### Example: company-wide

```json
{
  "userId": "66f1c2a4e1b2c3d4e5f6a7b8",
  "permissionKey": "request.update",
  "scope": "company"
}
```

#### Example: own department (default)

```json
{
  "userId": "66f1c2a4e1b2c3d4e5f6a7b8",
  "permissionKey": "request.update"
}
```

#### Success response

```json
{
  "success": true,
  "message": "Permission assigned",
  "assignment": {
    "_id": "66f1c2a4e1b2c3d4e5f6a800",
    "companyId": "66f1c2a4e1b2c3d4e5f6a7b9",
    "userId": "66f1c2a4e1b2c3d4e5f6a7b8",
    "permissions": ["request.update"],
    "approvalScope": {
      "type": "departments",
      "departments": ["Sales", "Human Resources"]
    },
    "assignedBy": {
      "_id": "66f1c2a4e1b2c3d4e5f6a801",
      "name": "Admin",
      "email": "admin@example.com"
    },
    "createdAt": "2026-10-29T10:00:00.000Z",
    "updatedAt": "2026-10-29T10:00:00.000Z"
  }
}
```

#### Error responses

| Status | When |
|---|---|
| 400 | Missing `companyId`, invalid `scope.type`, or malformed `scope` |
| 404 | Permission or user not found |
| 403 | Caller lacks `permission.assign` |
| 500 | Unexpected server error |

---

## Read / Remove APIs

### `GET /api/permissionRoutes/getUserPermissions?userId=<id>&companyId=<id>`

Returns the assignment, including `approvalScope`.

```json
{
  "success": true,
  "permissions": ["request.update"],
  "assignment": {
    "approvalScope": { "type": "departments", "departments": ["Sales"] }
  }
}
```

### `POST /api/permissionRoutes/remove`

```json
{
  "userId": "66f1c2a4e1b2c3d4e5f6a7b8",
  "permissionKey": "request.update",
  "companyId": "66f1c2a4e1b2c3d4e5f6a7b9"
}
```

Removing `request.update` removes approval eligibility for that user (unless they have a bypassing role).

---

## How scope is enforced

The backend resolves the approver's effective scope in `utils/approvalScope.js`:

1. `super_admin` / `partner` user types → company-wide.
2. Employee role `admin`, `super_admin`, or `manager` → company-wide.
3. Explicit `request.update` assignment → the configured `approvalScope`.
4. Missing scope → own department.

Every approval still enforces:

- The request belongs to the same company.
- The approver is not approving their own request.
- The requester's department is inside the approver's scope.

### Affected attendance endpoints

| Endpoint | Scope behavior |
|---|---|
| `GET /api/attendance/requests` | Approvers only receive requests inside their scope; non-approvers receive their own requests. Each item includes `canApprove` and `canApproveReason`. |
| `GET /api/attendance/requests/statistics` | Aggregates are limited to the approver's scope. |
| `PUT /api/attendance/requests/:requestId/approve` | Returns `403` when the request is outside scope. |
| `PUT /api/attendance/requests/:requestId/reject` | Returns `403` when the request is outside scope. |
| `POST /api/attendance/requests/bulk-approve` | Each request is checked individually; out-of-scope items appear in `failed`. |

`GET /api/attendance/requests/:requestId` remains visible to the owner, global users, and eligible approvers.

#### List item approval flags

```json
{
  "_id": "66f1c2a4e1b2c3d4e5f6a900",
  "status": "pending",
  "canApprove": true,
  "canApproveReason": null
}
```

When the request cannot be approved:

```json
{
  "canApprove": false,
  "canApproveReason": "You can only approve leave requests from the departments assigned to you"
}
```

Use these flags to disable Approve/Reject buttons in the UI.

---

## Frontend checklist

- Add a scope selector to the permission-assign form for `request.update`:
  - Own department (default)
  - Selected departments (multi-select)
  - Entire company
- Send the selection as `scope` in `POST /api/permissionRoutes/assign`.
- Display `assignment.approvalScope` when editing an existing assignment.
- Re-assigning the same `permissionKey` updates the scope without duplicating the assignment.
- Existing assignments without `approvalScope` behave as `department`; no migration is required.
