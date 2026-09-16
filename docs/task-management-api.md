# Task Management API Documentation

## Overview

This document covers the Task Management API including:
- Task CRUD operations
- Task types (one_time, daily, days, dates)
- Task filtering (today, by type, by date)
- Task duplication
- Task submission with completion tracking
- Assignment filtering

---

## Table of Contents

1. [Task Types](#task-types)
2. [API Endpoints](#api-endpoints)
3. [Flow Diagrams](#flow-diagrams)
4. [API Call Sequence](#api-call-sequence)
5. [Examples with Dummy Data](#examples-with-dummy-data)

---

## Task Types

| Type | Description | Fields |
|------|-------------|--------|
| `one_time` | Single occurrence, runs between startDate and dueDate | `startDate`, `dueDate` |
| `daily` | Active every day | None |
| `days` | Active on specific weekdays | `recurringDays: ['MONDAY', 'WEDNESDAY']` |
| `dates` | Active on specific calendar dates | `recurringDates: [1, 15]` |

---

## API Endpoints

### 1. Get Today's Tasks

**Endpoint:** `GET /api/v1/tasks/today`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
      "taskNumber": "TASK-0001",
      "title": "Daily Standup",
      "taskType": "daily",
      "priority": "HIGH",
      "status": "ACTIVE",
      "startDate": "2026-09-15T00:00:00.000Z",
      "dueDate": "2026-09-30T23:59:59.000Z",
      "recurringDays": [],
      "recurringDates": [],
      "createdBy": {
        "_id": "user123",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "ownerId": {
        "_id": "user456",
        "name": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedUsers": [
        {
          "_id": "user789",
          "name": "Bob Wilson",
          "email": "bob@example.com"
        }
      ]
    },
    {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d2",
      "taskNumber": "TASK-0002",
      "title": "Weekly Report",
      "taskType": "days",
      "priority": "MEDIUM",
      "status": "ACTIVE",
      "startDate": "2026-09-01T00:00:00.000Z",
      "dueDate": "2026-09-30T23:59:59.000Z",
      "recurringDays": ["MONDAY", "WEDNESDAY", "FRIDAY"],
      "recurringDates": [],
      "createdBy": {
        "_id": "user123",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "ownerId": {
        "_id": "user456",
        "name": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedUsers": [
        {
          "_id": "user789",
          "name": "Bob Wilson",
          "email": "bob@example.com"
        }
      ]
    },
    {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d3",
      "taskNumber": "TASK-0003",
      "title": "Monthly Invoice",
      "taskType": "dates",
      "priority": "URGENT",
      "status": "ACTIVE",
      "startDate": "2026-01-01T00:00:00.000Z",
      "dueDate": "2026-12-31T23:59:59.000Z",
      "recurringDays": [],
      "recurringDates": [1, 15],
      "createdBy": {
        "_id": "user123",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "ownerId": {
        "_id": "user456",
        "name": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedUsers": [
        {
          "_id": "user789",
          "name": "Bob Wilson",
          "email": "bob@example.com"
        }
      ]
    }
  ]
}
```

---

### 2. Get My Assignments

**Endpoint:** `GET /api/v1/tasks/my-assignments`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | Number | Page number (default: 1) |
| `limit` | Number | Items per page (default: 20, max: 200) |
| `status` | String | Filter by assignment status |
| `taskType` | String | Filter by task type |
| `fromToday` | Boolean | Filter tasks active today |
| `startDateStart` | Date | Filter tasks with startDate >= this |
| `startDateEnd` | Date | Filter tasks with startDate <= this |
| `search` | String | Search by task title or taskNumber |

**Example Request:**
```
GET /api/v1/tasks/my-assignments?fromToday=true&limit=10
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "total": 2,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "assignment123",
      "companyId": "company123",
      "taskId": {
        "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
        "taskNumber": "TASK-0001",
        "title": "Daily Standup",
        "status": "ACTIVE",
        "priority": "HIGH",
        "dueDate": "2026-09-30T23:59:59.000Z",
        "startDate": "2026-09-15T00:00:00.000Z",
        "taskType": "daily",
        "recurringDays": [],
        "recurringDates": []
      },
      "userId": "user789",
      "assignedBy": {
        "_id": "user456",
        "name": "Jane Smith",
        "email": "jane@example.com"
      },
      "status": "ASSIGNED",
      "assignedAt": "2026-09-15T10:30:00.000Z"
    }
  ]
}
```

---

### 3. Create Task

**Endpoint:** `POST /api/v1/tasks`

**Request Body:**
```json
{
  "title": "Daily Standup Meeting",
  "description": "Attend daily standup meeting",
  "taskType": "one_time",
  "priority": "HIGH",
  "startDate": "2026-09-15",
  "dueDate": "2026-09-15",
  "estimatedDurationSeconds": 1800,
  "assignedUsers": ["user789", "user101"]
}
```

**For Recurring Tasks:**
```json
{
  "title": "Weekly Report",
  "description": "Submit weekly progress report",
  "taskType": "days",
  "recurringDays": ["MONDAY", "WEDNESDAY", "FRIDAY"],
  "priority": "MEDIUM",
  "startDate": "2026-09-01",
  "dueDate": "2026-09-30",
  "estimatedDurationSeconds": 3600,
  "assignedUsers": ["user789"]
}
```

**For Dates Recurring:**
```json
{
  "title": "Monthly Invoice",
  "description": "Process monthly invoices",
  "taskType": "dates",
  "recurringDates": [1, 15],
  "priority": "URGENT",
  "startDate": "2026-01-01",
  "dueDate": "2026-12-31",
  "estimatedDurationSeconds": 7200,
  "assignedUsers": ["user789"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
    "taskNumber": "TASK-0001",
    "title": "Daily Standup Meeting",
    "description": "Attend daily standup meeting",
    "taskType": "one_time",
    "priority": "HIGH",
    "status": "DRAFT",
    "startDate": "2026-09-15T00:00:00.000Z",
    "dueDate": "2026-09-15T23:59:59.000Z",
    "estimatedDurationSeconds": 1800,
    "createdBy": "user123",
    "ownerId": "user123",
    "assignedUsers": ["user789", "user101"],
    "createdAt": "2026-09-15T10:30:00.000Z"
  }
}
```

---

### 4. Duplicate Task

**Endpoint:** `POST /api/v1/tasks/:id/duplicate`

**Request Body (Optional):**
```json
{
  "resetStartDate": true,
  "resetDueDate": true,
  "newTitle": "Copy of Daily Standup",
  "newDescription": "Copy with updated description"
}
```

**Example Request:**
```
POST /api/v1/tasks/66f1a2b3c4d5e6f7a8b9c0d1/duplicate
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "66f1a2b3c4d5e6f7a8b9c0d2",
    "taskNumber": "TASK-0002",
    "title": "Copy of Daily Standup",
    "description": "Copy with updated description",
    "taskType": "one_time",
    "priority": "HIGH",
    "status": "DRAFT",
    "startDate": "2026-09-15T00:00:00.000Z",
    "dueDate": "2026-09-15T23:59:59.000Z",
    "estimatedDurationSeconds": 1800,
    "createdBy": "user123",
    "ownerId": "user123",
    "assignedUsers": [],
    "createdAt": "2026-09-15T11:00:00.000Z"
  },
  "message": "Task duplicated successfully"
}
```

**Duplicate Rules:**
- Preserves: title, description, taskType, recurringDays/Dates, priority
- Resets: _id, taskNumber (auto-generated), createdAt
- Clears: assignedUsers (needs re-assignment)
- Optional: startDate, dueDate (if resetStartDate/resetDueDate = true)

---

### 5. Submit Task

**Endpoint:** `POST /api/v1/tasks/:id/submit`

**Request Body:**
```json
{
  "completionComment": "Task completed successfully"
}
```

**Example Request:**
```
POST /api/v1/tasks/66f1a2b3c4d5e6f7a8b9c0d1/submit
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
    "taskNumber": "TASK-0001",
    "title": "Daily Standup Meeting",
    "status": "SUBMITTED",
    "submittedAt": "2026-09-15T15:30:00.000Z",
    "submittedBy": "user789",
    "completedAt": "2026-09-15T15:30:00.000Z",
    "completedBy": "user789",
    "actualDurationSeconds": 1800
  }
}
```

**What Happens on Submit:**
1. Task status changes to `SUBMITTED`
2. `TaskCompletionRecord` is created (tracks per-day completion)
3. For recurring tasks (daily/days/dates):
   - System calculates next occurrence date
   - Checks if duplicate already exists for that date
   - If not, creates new task with same config for next occurrence
4. For one_time tasks:
   - No duplicate is created

---

### 6. Get All Tasks with Filtering

**Endpoint:** `GET /api/v1/tasks`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | String | Filter by task status |
| `priority` | String | Filter by priority |
| `taskType` | String | Filter by task type |
| `assignee` | String | Filter by assigned user ID |
| `owner` | String | Filter by owner user ID |
| `dueDateStart` | Date | Filter tasks with dueDate >= this |
| `dueDateEnd` | Date | Filter tasks with dueDate <= this |
| `search` | String | Search by title or taskNumber |
| `page` | Number | Page number |
| `limit` | Number | Items per page |

**Example Request:**
```
GET /api/v1/tasks?taskType=one_time&status=ACTIVE&limit=10
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "total": 1,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
      "taskNumber": "TASK-0001",
      "title": "Daily Standup Meeting",
      "taskType": "one_time",
      "status": "ACTIVE",
      "priority": "HIGH",
      "startDate": "2026-09-15T00:00:00.000Z",
      "dueDate": "2026-09-15T23:59:59.000Z",
      "createdBy": {
        "_id": "user123",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "ownerId": {
        "_id": "user456",
        "name": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedUsers": [
        {
          "_id": "user789",
          "name": "Bob Wilson",
          "email": "bob@example.com"
        }
      ]
    }
  ]
}
```

---

### 7. Get Single Task

**Endpoint:** `GET /api/v1/tasks/:id`

**Response:**
```json
{
  "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
  "taskNumber": "TASK-0001",
  "title": "Daily Standup Meeting",
  "description": "Attend daily standup meeting",
  "taskType": "one_time",
  "priority": "HIGH",
  "status": "ACTIVE",
  "startDate": "2026-09-15T00:00:00.000Z",
  "dueDate": "2026-09-15T23:59:59.000Z",
  "estimatedDurationSeconds": 1800,
  "actualDurationSeconds": 0,
  "createdBy": {
    "_id": "user123",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "ownerId": {
    "_id": "user456",
    "name": "Jane Smith",
    "email": "jane@example.com"
  },
  "assignedUsers": [
    {
      "_id": "user789",
      "name": "Bob Wilson",
      "email": "bob@example.com"
    }
  ],
  "createdAt": "2026-09-15T10:30:00.000Z",
  "updatedAt": "2026-09-15T10:30:00.000Z"
}
```

---

### 8. Update Task

**Endpoint:** `PATCH /api/v1/tasks/:id`

**Request Body:**
```json
{
  "title": "Updated Task Title",
  "priority": "URGENT",
  "dueDate": "2026-09-20"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
    "taskNumber": "TASK-0001",
    "title": "Updated Task Title",
    "priority": "URGENT",
    "status": "ACTIVE",
    "updatedAt": "2026-09-15T12:00:00.000Z"
  }
}
```

---

### 9. Delete Task (Soft Delete)

**Endpoint:** `DELETE /api/v1/tasks/:id`

**Response:**
```json
{
  "success": true,
  "message": "Task deleted successfully"
}
```

---

### 10. Assign Task to User

**Endpoint:** `POST /api/v1/tasks/:id/assign`

**Request Body:**
```json
{
  "userId": "user789",
  "status": "ASSIGNED"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "assignment123",
    "companyId": "company123",
    "taskId": "66f1a2b3c4d5e6f7a8b9c0d1",
    "userId": "user789",
    "assignedBy": "user123",
    "status": "ASSIGNED",
    "assignedAt": "2026-09-15T10:30:00.000Z"
  }
}
```

---

### 11. Bulk Assign Task

**Endpoint:** `POST /api/v1/tasks/:id/assign-bulk`

**Request Body:**
```json
{
  "userIds": ["user789", "user101", "user102"],
  "status": "ASSIGNED"
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "assignment123",
      "taskId": "66f1a2b3c4d5e6f7a8b9c0d1",
      "userId": "user789",
      "status": "ASSIGNED"
    },
    {
      "_id": "assignment124",
      "taskId": "66f1a2b3c4d5e6f7a8b9c0d1",
      "userId": "user101",
      "status": "ASSIGNED"
    },
    {
      "_id": "assignment125",
      "taskId": "66f1a2b3c4d5e6f7a8b9c0d1",
      "userId": "user102",
      "status": "ASSIGNED"
    }
  ]
}
```

---

### 12. Get Task Assignments

**Endpoint:** `GET /api/v1/tasks/:id/assignments`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | Number | Page number |
| `limit` | Number | Items per page |
| `status` | String | Filter by assignment status |
| `search` | String | Search by user name/email |
| `assignedFrom` | Date | Filter by assignedAt >= this |
| `assignedTo` | Date | Filter by assignedAt <= this |

**Example Request:**
```
GET /api/v1/tasks/66f1a2b3c4d5e6f7a8b9c0d1/assignments?status=ASSIGNED
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "total": 2,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "assignment123",
      "companyId": "company123",
      "taskId": "66f1a2b3c4d5e6f7a8b9c0d1",
      "userId": {
        "_id": "user789",
        "name": "Bob Wilson",
        "email": "bob@example.com"
      },
      "assignedBy": {
        "_id": "user123",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "status": "ASSIGNED",
      "assignedAt": "2026-09-15T10:30:00.000Z"
    },
    {
      "_id": "assignment124",
      "companyId": "company123",
      "taskId": "66f1a2b3c4d5e6f7a8b9c0d1",
      "userId": {
        "_id": "user101",
        "name": "Alice Brown",
        "email": "alice@example.com"
      },
      "assignedBy": {
        "_id": "user123",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "status": "ASSIGNED",
      "assignedAt": "2026-09-15T10:35:00.000Z"
    }
  ]
}
```

---

### 13. Remove Assignee from Task

**Endpoint:** `DELETE /api/v1/tasks/:id/assignees/:userId`

**Response:**
```json
{
  "success": true,
  "message": "Assignee removed successfully"
}
```

---

## Flow Diagrams

### Task Lifecycle Flow

```
┌─────────────┐
│   Create    │
│    Task     │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│   Assign    │────▶│  Invited    │
│    Task     │     │             │
└─────────────┘     └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Accepted   │
                    │             │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Active    │
                    │             │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ In Progress │
                    │             │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Submitted  │
                    │             │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Verified   │
                    │             │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Closed    │
                    │             │
                    └─────────────┘
```

### One-Time Task Flow

```
┌─────────────────────────────────────────────────────────┐
│                    ONE-TIME TASK                         │
├─────────────────────────────────────────────────────────┤
│  Create with startDate & dueDate                        │
│       ↓                                                 │
│  Show in today's tasks if today is between              │
│  startDate and dueDate                                  │
│       ↓                                                 │
│  User works on task                                     │
│       ↓                                                 │
│  Submit task                                            │
│       ↓                                                 │
│  TaskCompletionRecord created                           │
│       ↓                                                 │
│  Status changes to SUBMITTED                            │
│       ↓                                                 │
│  No duplicate created (one-time only)                   │
└─────────────────────────────────────────────────────────┘
```

### Recurring Task Flow

```
┌─────────────────────────────────────────────────────────┐
│                   RECURRING TASK                        │
├─────────────────────────────────────────────────────────┤
│  Create with taskType: 'days' or 'dates'                │
│  + recurringDays or recurringDates                      │
│       ↓                                                 │
│  Task shows up on matching days                         │
│       ↓                                                 │
│  User works on task                                     │
│       ↓                                                 │
│  Submit task                                            │
│       ↓                                                 │
│  TaskCompletionRecord created (per-day tracking)        │
│       ↓                                                 │
│  Status changes to SUBMITTED                            │
│       ↓                                                 │
│  Auto-create duplicate for next occurrence              │
│  (same title, description, config, new dates)           │
│       ↓                                                 │
│  Duplicate appears in tomorrow's/next occurrence tasks  │
└─────────────────────────────────────────────────────────┘
```

### Task Duplication Flow

```
┌─────────────────────────────────────────────────────────┐
│                  TASK DUPLICATION                        │
├─────────────────────────────────────────────────────────┤
│  Call: POST /api/v1/tasks/:id/duplicate                 │
│       ↓                                                 │
│  System finds original task                             │
│       ↓                                                 │
│  Copies all fields except:                              │
│    - _id (new auto-generated)                           │
│    - taskNumber (auto-generated)                        │
│    - createdAt (new timestamp)                          │
│    - assignedUsers (cleared)                            │
│       ↓                                                 │
│  If resetStartDate = true:                              │
│    - startDate = today                                  │
│       ↓                                                 │
│  If resetDueDate = true:                                │
│    - dueDate = today + original duration                │
│       ↓                                                 │
│  New task created with status = 'DRAFT'                 │
│       ↓                                                 │
│  Return new task with new taskNumber                    │
└─────────────────────────────────────────────────────────┘
```

### getTodayTasks Filter Logic

```
┌─────────────────────────────────────────────────────────┐
│              GET TODAY'S TASKS                           │
├─────────────────────────────────────────────────────────┤
│  For each task, check if it should show today:          │
│                                                         │
│  taskType = 'daily'                                     │
│    → Always show                                        │
│                                                         │
│  taskType = 'days'                                      │
│    → Check if today's weekday is in recurringDays       │
│    → Example: recurringDays = ['MONDAY', 'WEDNESDAY']   │
│    → If today is MONDAY → Show                          │
│                                                         │
│  taskType = 'dates'                                     │
│    → Check if today's date is in recurringDates         │
│    → Example: recurringDates = [1, 15]                  │
│    → If today is 15th → Show                            │
│                                                         │
│  taskType = 'one_time'                                  │
│    → Check if today is between startDate and dueDate    │
│    → If startDate <= today <= dueDate → Show            │
│                                                         │
│  Return all matching tasks                              │
└─────────────────────────────────────────────────────────┘
```

### getMyAssignments Filter Logic

```
┌─────────────────────────────────────────────────────────┐
│            GET MY ASSIGNMENTS                           │
├─────────────────────────────────────────────────────────┤
│  Filter parameters:                                     │
│    - status (assignment status)                         │
│    - taskType (daily/days/dates/one_time)               │
│    - fromToday (true/false)                             │
│    - startDateStart / startDateEnd                      │
│    - search (title/taskNumber)                          │
│                                                         │
│  Step 1: Build task filter                              │
│    - If fromToday = true:                               │
│        Apply same logic as getTodayTasks                │
│    - If taskType provided:                              │
│        Filter by specific type                          │
│    - If startDateStart/End provided:                    │
│        Filter by date range                             │
│    - If search provided:                                │
│        Regex search on title/taskNumber                 │
│                                                         │
│  Step 2: Find matching tasks                            │
│    - Query Task collection with filters                 │
│    - Get array of taskIds                               │
│                                                         │
│  Step 3: Find assignments                               │
│    - Query TaskAssignment where:                        │
│      - companyId matches                                │
│      - userId matches current user                      │
│      - taskId is in matching taskIds                    │
│      - status matches (if provided)                     │
│                                                         │
│  Step 4: Return paginated results                       │
│    - With populated taskId and assignedBy               │
└─────────────────────────────────────────────────────────┘
```

---

## API Call Sequence

### Scenario 1: Create and Submit a One-Time Task

```
1. POST /api/v1/tasks
   → Create one-time task

2. POST /api/v1/tasks/:id/assign
   → Assign task to user

3. POST /api/v1/tasks/:id/work-sessions/start
   → User starts working on task

4. POST /api/v1/tasks/:id/work-sessions/stop
   → User stops working

5. POST /api/v1/tasks/:id/submit
   → User submits completed task
   → TaskCompletionRecord created
   → Status changes to SUBMITTED

6. GET /api/v1/tasks/my-assignments
   → Verify task no longer shows in "active" assignments
```

### Scenario 2: Create and Submit a Recurring Task

```
1. POST /api/v1/tasks
   → Create recurring task (taskType: 'days', recurringDays: ['MONDAY', 'WEDNESDAY'])

2. POST /api/v1/tasks/:id/assign
   → Assign task to user

3. GET /api/v1/tasks/today
   → Verify task shows on Monday/Wednesday

4. POST /api/v1/tasks/:id/work-sessions/start
   → User starts working

5. POST /api/v1/tasks/:id/work-sessions/stop
   → User stops working

6. POST /api/v1/tasks/:id/submit
   → User submits task
   → TaskCompletionRecord created
   → Auto-duplicate created for next occurrence (Friday)
   → Status changes to SUBMITTED

7. GET /api/v1/tasks/today (on Friday)
   → Verify duplicate task shows for Friday
```

### Scenario 3: Duplicate a Task

```
1. GET /api/v1/tasks
   → Find existing task to duplicate

2. POST /api/v1/tasks/:id/duplicate
   → Create duplicate with same config

3. GET /api/v1/tasks
   → Verify duplicate appears with new taskNumber

4. POST /api/v1/tasks/:id/assign
   → Assign duplicate to user(s)
```

---

## Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (no permission) |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task not found"
  }
}
```

**Common Error Codes:**
- `TASK_NOT_FOUND` - Task does not exist
- `USER_NOT_ASSIGNED` - User is not assigned to this task
- `INVALID_STATUS_TRANSITION` - Task is not in a valid state for this action
- `TASK_CREATE_ERROR` - Failed to create task
- `TASK_UPDATE_ERROR` - Failed to update task
- `TASK_SUBMIT_ERROR` - Failed to submit task
- `TASK_DUPLICATE_ERROR` - Failed to duplicate task
- `TASK_FETCH_ERROR` - Failed to fetch tasks

---

## Field Reference

### Task Object

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Task ID |
| `taskNumber` | String | Auto-generated (TASK-XXXX) |
| `title` | String | Task title (required) |
| `description` | String | Task description |
| `taskType` | String | one_time/daily/days/dates |
| `recurringDays` | Array | For 'days' type |
| `recurringDates` | Array | For 'dates' type |
| `priority` | String | LOW/MEDIUM/HIGH/URGENT/CRITICAL |
| `status` | String | See Status Codes above |
| `createdBy` | ObjectId | User who created task |
| `ownerId` | ObjectId | Task owner |
| `assignedUsers` | Array | Array of user IDs |
| `startDate` | Date | Task start date |
| `dueDate` | Date | Task due date |
| `estimatedDurationSeconds` | Number | Estimated time |
| `actualDurationSeconds` | Number | Actual time spent |
| `submittedAt` | Date | When task was submitted |
| `completedAt` | Date | When task was completed |
| `closedAt` | Date | When task was closed |

### TaskCompletionRecord Object

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Record ID |
| `companyId` | ObjectId | Company ID |
| `taskId` | ObjectId | Task ID |
| `userId` | ObjectId | User who completed |
| `completionDate` | Date | Date of completion (normalized) |
| `status` | String | SUBMITTED/COMPLETED |
| `durationSeconds` | Number | Work time in seconds |
| `comment` | String | Completion comment |

---

## Notes for Frontend Developer

### 1. One-Time Tasks
- Default task type for new tasks
- Shows in today's tasks if today is between startDate and dueDate
- No auto-duplicate on submit

### 2. Recurring Tasks
- `daily` - Always shows
- `days` - Shows on matching weekdays
- `dates` - Shows on matching dates
- Auto-duplicate on submit (creates next occurrence)

### 3. Filtering
- Use `fromToday=true` to get tasks active today
- Use `taskType` to filter by specific type
- Use `startDateStart` and `startDateEnd` for date range filtering

### 4. Task Numbers
- Auto-generated in format: TASK-XXXX
- Cannot be manually set
- Unique per company

### 5. Assigned Users
- Array of user IDs
- Cleared when duplicating a task
- Need to re-assign after duplication

---

*Last Updated: September 15, 2026*
