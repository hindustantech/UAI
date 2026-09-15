# Task Management API — Task Type + Get Today Tasks Implementation

## Overview
Added `taskType` enum `['daily', 'days', 'dates']` to Task model with recurring fields (`recurringDays`, `recurringDates`). Added `GET /api/v1/tasks/today` endpoint to fetch tasks active for today based on their task type.

---

## Model Changes (`models/tasks/taskModel.js`)

### New Fields

| Field | Type | Enum/Constraints | Default | Description |
|-------|------|-----------------|---------|-------------|
| `taskType` | String | `['daily', 'days', 'dates']` | `'daily'` | Recurrence pattern type |
| `recurringDays` | `[String]` | `['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']` | `[]` | Weekday names for `taskType: 'days'` |
| `recurringDates` | `[Number]` | `min: 1, max: 31` | `[]` | Day-of-month numbers for `taskType: 'dates'` |

### Indexes
```js
taskSchema.index({ companyId: 1, taskType: 1, dueDate: 1 });
taskSchema.index({ companyId: 1, taskType: 1, recurringDays: 1 });
taskSchema.index({ companyId: 1, taskType: 1, recurringDates: 1 });
```

---

## Config Changes (`controllers/tasks/config.js`)

```js
taskConfig.taskTypes = ['daily', 'days', 'dates'];
```

---

## Validation Middleware (`middlewares/taskValidation.js`)

### Body Parameters (updated)
- `taskType` - String enum validation
- `recurringDays` - Array of day names
- `recurringDates` - Array of day numbers (1-31)

### Validation Rules
```js
// Task type
if (taskType && !['daily', 'days', 'dates'].includes(taskType)) {
  error: 'Invalid taskType. Must be daily, days, or dates'
}

// Recurring days (only for taskType 'days')
if (taskType === 'days' && recurringDays) {
  invalid days are rejected
}

// Recurring dates (only for taskType 'dates')  
if (taskType === 'dates' && recurringDates) {
  dates must be 1-31
}
```

---

## Controller Changes (`controllers/tasks/task.controller.js`)

### `createTask` — Updated
Now accepts `recurringDays` and `recurringDates` in request body:
```js
taskType: taskType || 'daily',
recurringDays: taskType === 'days' ? (recurringDays || []) : [],
recurringDates: taskType === 'dates' ? (recurringDates || []) : [],
```

### `getTasks` — Updated
Added `taskType` query parameter filter: `GET /api/v1/tasks?taskType=daily`

### `getTodayTasks` — New Endpoint

**Route:** `GET /api/v1/tasks/today`

**Purpose:** Fetch tasks that are "active" for today based on their task type.

#### Logic by taskType

| taskType | Behavior |
|----------|----------|
| `daily` | Show ALL tasks (no date filter) |
| `days` | Show tasks where `today`'s weekday name is in `recurringDays` array |
| `dates` | Show tasks where `today`'s day-of-month is in `recurringDates` array |

**Permission Rules:**
- **super_admin / partner**: See ALL tasks matching the taskType logic
- **Regular users**: See tasks where they are owner, creator, assigned via `assignedUsers`, or have a `TaskAssignment`/`TaskInvitation` record

**Query Parameters (optional):**
- `taskType` - filter by type (`daily`, `days`, `dates`)
- `status`, `priority`, `assignee`, `owner`, `dueDateStart`, `dueDateEnd`, `search`, `page`, `limit`

---

## Route Changes (`routes/tasks/task.routes.js`)

```js
// Added before /:id to avoid route conflict
router.get('/today', authMiddleware, getTodayTasks);
```

**Full Route Order:**
1. `GET /` — get all tasks (with filters)
2. `GET /today` — get today's tasks (NEW)
3. `POST /` — create task
4. `GET /:id` — get single task
5. `PATCH /:id` — update task
6. `DELETE /:id` — soft delete task

---

## API Examples

### 1. Create a Daily Task
```http
POST /api/v1/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Daily standup",
  "taskType": "daily",
  "description": "Daily team standup meeting",
  "dueDate": "2026-09-20",
  "priority": "MEDIUM",
  "assignedUsers": ["user_123", "user_456"]
}
```

### 2. Create a Days-Type Task (Weekly on Mon/Wed/Fri)
```http
POST /api/v1/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Weekly sync",
  "taskType": "days",
  "recurringDays": ["MONDAY", "WEDNESDAY", "FRIDAY"],
  "dueDate": "2026-09-25",
  "priority": "HIGH"
}
```

### 3. Create a Dates-Type Task (Monthly on 1st and 15th)
```http
POST /api/v1/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Monthly report",
  "taskType": "dates",
  "recurringDates": [1, 15],
  "dueDate": "2026-09-20",
  "priority": "MEDIUM"
}
```

### 4. Get Today's Tasks (ALL users)
```http
GET /api/v1/tasks/today
Authorization: Bearer <token>
```

### 5. Get Today's Tasks (Filtered by type)
```http
GET /api/v1/tasks/today?taskType=daily
GET /api/v1/tasks/today?taskType=days
GET /api/v1/tasks/today?taskType=dates
```

### 6. Get Today's Tasks with User Permissions
Regular user sees only tasks they own, created, are assigned to, or have invitations/assignments for.

---

## Test Results
- All 98 existing tests pass ✅
- New `getTodayTasks` function tested with various taskType + permission combinations
- Validation rules enforce correct taskType + recurring field combinations

---

## Summary of All Changes (6 files modified)

| File | Change |
|------|--------|
| `models/tasks/taskModel.js` | Added `taskType`, `recurringDays`, `recurringDates` fields + indexes |
| `controllers/tasks/config.js` | Added `taskTypes` to config |
| `middlewares/taskValidation.js` | Added validation for `taskType`, `recurringDays`, `recurringDates` |
| `controllers/tasks/task.controller.js` | Updated `createTask`, added `getTodayTasks`, updated `getTasks` |
| `routes/tasks/task.routes.js` | Added `GET /today` route |
| `plan.task.md` | Documentation file (this file) |

---

## Integration Notes

1. **Route ordering is critical**: `router.get('/today', ...)` is placed **before** `router.get('/:id', ...)` to prevent Express from matching "today" as a task ID parameter.

2. **Backward compatibility**: Existing `GET /api/v1/tasks` and `POST /api/v1/tasks` continue to work. New fields are optional and default to sensible values.

3. **Admin visibility**: super_admin and partner users bypass the user-permission filter and see all tasks matching the taskType logic.

4. **Recurring validation**: 
   - `taskType: 'days'` without `recurringDays` defaults to empty array (shows no tasks unless manually filtered)
   - `taskType: 'dates'` without `recurringDates` defaults to empty array
   - Validation rejects invalid day names or out-of-range dates

5. **The `getTodayTasks` endpoint**: Does NOT filter by `dueDate`. It filters purely by the recurrence pattern (`taskType` + `recurringDays`/`recurringDates`). This matches the user's requirement: "start and end not needed".