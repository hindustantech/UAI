# GET /api/v1/SalesRoute/sessions

> Retrieves all sales sessions with filtering, pagination, sorting, and date-based queries.

---

## Base URL

```
GET /api/v1/SalesRoute/sessions
```

**Auth:** Bearer token (JWT) required via `authMiddleware`

---

## Query Parameters

### Employee / Company

| Param | Type | Default | Description |
|---|---|---|---|
| `companyId` | `ObjectId` | `req.user.companyId` | Company ID. Falls back to authenticated user's company. |
| `salesPersonId` | `ObjectId` | `null` | Filter by employee who owns the session. |

### Status Filters

| Param | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `status` | `String` | `null` | `not started`, `in_progress`, `completed` | Session status. Ignored if invalid. |
| `SalesStatus` | `String` | `null` | `open`, `closed`, `follow_up` | Sales/deal status. Ignored if invalid. |
| `formCompleted` | `Boolean` | `null` | `true`, `false` | Whether the sales form was submitted. |

### Customer Filters

| Param | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `customerType` | `String` | `null` | `retail`, `wholesale`, `corporate`, `customer`, `agent` | Filter by customer type. |
| `salesType` | `String` | `null` | `retail`, `wholesale`, `corporate`, `customer`, `agent` | Alias for `customerType`. If both are sent, `customerType` takes priority. |
| `customerName` | `String` | `null` | any string | Case-insensitive partial match on `customer.companyName`. |
| `customerPhone` | `String` | `null` | any string | Case-insensitive partial match on `customer.phoneNumber`. |
| `customerId` | `String` | `null` | any string | Exact match on `customer.customerId`. |

### Date Filters

| Param | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `filterType` | `String` | `null` | `today`, `yesterday`, `week`, `month`, `recurringToday` | Pre-built date range filter. See [Filter Types](#filter-types). |
| `singleDate` | `String` | `null` | `YYYY-MM-DD` | Exact single-day filter (00:00:00 - 23:59:59). |
| `startDate` | `String` | `null` | `YYYY-MM-DD` | Custom range start. |
| `endDate` | `String` | `null` | `YYYY-MM-DD` | Custom range end. |
| `dateField` | `String` | `punchInTime` | `punchInTime`, `createdAt`, `updatedAt`, `nextMeetingDate` | Which date field the range filters apply to. `nextMeetingDate` maps to `nextMeeting.date`. |

### Next Meeting / Recurring Filters

| Param | Type | Default | Description |
|---|---|---|---|
| `nextMeetingToday` | `String` | `null` | Set to `"true"` to return only sessions where `nextMeeting.decided = true` AND `nextMeeting.date` falls within today (IST). |

> **Note:** `filterType=recurringToday` combines three conditions via `$or`:
> 1. `nextMeeting.decided = true` AND `nextMeeting.date` is today
> 2. `visitType = "recurring"` AND `recurringSchedule.type = "days"` AND `recurringSchedule.days` includes today's day name
> 3. `visitType = "recurring"` AND `recurringSchedule.type = "dates"` AND `recurringSchedule.dates` includes today's date number

### Pagination

| Param | Type | Default | Min | Max | Description |
|---|---|---|---|---|---|
| `page` | `Number` | `1` | `1` | - | Page number. |
| `limit` | `Number` | `10` | `1` | `100` | Results per page. |

### Sorting

| Param | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `sortBy` | `String` | `punchInTime` | `punchInTime`, `createdAt`, `updatedAt`, `totalDistance`, `duration`, `status`, `customer.companyName`, `customer.phoneNumber`, `nextMeetingDate` | Sort field. Invalid values fall back to `punchInTime`. |
| `sortOrder` | `String` | `-1` | `1` (ASC), `-1` (DESC) | Sort direction. |

### Options

| Param | Type | Default | Description |
|---|---|---|---|
| `includeLogs` | `String` | `"true"` | Set to `"false"` to exclude visit, sales, meeting, and note logs. |
| `includeRoute` | `String` | `"false"` | Set to `"true"` to include GPS route tracking data. |

---

## Filter Types

| `filterType` | Range (IST) | Description |
|---|---|---|
| `today` | Start of today 00:00:00 - 23:59:59 | Sessions punched in today. |
| `yesterday` | Start of yesterday 00:00:00 - 23:59:59 | Sessions punched in yesterday. |
| `week` | Monday of current week 00:00:00 - now | Sessions punched in this week (Monday start). |
| `month` | 1st of current month 00:00:00 - now | Sessions punched in this month. |
| `recurringToday` | `nextMeeting.date` today OR `recurringSchedule.days` matches today OR `recurringSchedule.dates` matches today | Combines next meeting + recurring schedule matching. Uses `$or`. |

> **Timezone:** All date calculations use `Asia/Kolkata` (IST, UTC+5:30).

---

## Response

### Success (200)

```json
{
  "success": true,
  "message": "Sessions retrieved successfully",
  "count": 5,
  "data": [ /* ...formatted sessions... */ ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "pages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "filters": {
    "companyId": "64f1234567890abcdef12345",
    "employeeId": null,
    "status": null,
    "SalesStatus": null,
    "filterType": "recurringToday",
    "singleDate": null,
    "nextMeetingToday": "true",
    "salesType": "retail",
    "dateField": "punchInTime",
    "dateRange": {
      "field": "punchInTime",
      "start": "2025-09-17T00:00:00.000Z",
      "end": "2025-09-17T23:59:59.999Z"
    },
    "customer": {
      "type": "retail",
      "name": null,
      "phone": null,
      "id": null
    }
  }
}
```

### Session Object Structure

```json
{
  "id": "SLS-ABC123DEF4",
  "status": "in_progress",
  "SalesStatus": "open",
  "formCompleted": false,

  "customer": {
    "customerId": "CUST-001",
    "type": "retail",
    "companyName": "Acme Store",
    "contactName": "John Doe",
    "phone": "+919876543210",
    "address": "123 Market Road, Pune",
    "landmark": "Near Central Mall",
    "location": {
      "latitude": 18.5204,
      "longitude": 73.8567,
      "type": "Point"
    },
    "shopPhoto": [
      {
        "url": "https://cdn.example.com/photos/shop.jpg",
        "fileName": "shop.jpg",
        "uploadedAt": "17/09/2025, 10:30 am"
      }
    ]
  },

  "employee": {
    "_id": "64f1234567890abcdef12345",
    "name": "Rahul Sharma",
    "email": "rahul@uai.com",
    "phone": "+919876543211"
  },
  "createdBy": {
    "_id": "64f1234567890abcdef12346",
    "name": "Admin",
    "email": "admin@uai.com"
  },
  "assignedTo": [
    {
      "_id": "64f1234567890abcdef12347",
      "name": "Priya Patil",
      "email": "priya@uai.com"
    }
  ],
  "company": "64f1234567890abcdef12345",

  "punch": {
    "inTime": "17/09/2025, 09:00 am",
    "outTime": "17/09/2025, 05:30 pm",
    "inLocation": { "latitude": 18.5204, "longitude": 73.8567, "type": "Point" },
    "outLocation": { "latitude": 18.5304, "longitude": 73.8667, "type": "Point" },
    "outAddress": "123 Market Road, Pune",
    "lastPunchAt": "17/09/2025, 05:30 pm"
  },

  "stats": {
    "totalDistance": 12.5,
    "duration": 32400,
    "visits": 3,
    "sales": 2,
    "meetings": 1,
    "notes": 4
  },

  "nextMeeting": {
    "decided": true,
    "date": "18/09/2025, 11:00 am",
    "time": "11:00",
    "notes": "Discuss quarterly pricing"
  },

  "visitType": "recurring",
  "recurringSchedule": {
    "type": "days",
    "days": ["Monday", "Wednesday", "Friday"],
    "dates": [],
    "startDate": "01/01/2025, 12:00 am",
    "isActive": true
  },

  "evidence": {
    "visitNotes": "Met the store manager",
    "visitPhoto": {
      "url": "https://cdn.example.com/photos/visit.jpg",
      "fileName": "visit.jpg",
      "uploadedAt": "17/09/2025, 02:15 pm"
    }
  },

  "timestamps": {
    "createdAt": "17/09/2025, 08:45 am",
    "updatedAt": "17/09/2025, 05:32 pm"
  },

  "visitLogs": [
    {
      "userId": "64f1234567890abcdef12345",
      "punchInTime": "17/09/2025, 09:05 am",
      "punchOutTime": "17/09/2025, 10:30 am",
      "punchInLocation": { "latitude": 18.5204, "longitude": 73.8567, "type": "Point" },
      "punchOutLocation": { "latitude": 18.5214, "longitude": 73.8577, "type": "Point" }
    }
  ],
  "salesLogs": [
    {
      "userId": "64f1234567890abcdef12345",
      "dealStatus": "closed",
      "amount": 15000,
      "paymentCollected": 15000,
      "paymentMode": "cash",
      "note": "Full payment received",
      "createdAt": "17/09/2025, 10:35 am"
    }
  ],
  "meetingLogs": [
    {
      "userId": "64f1234567890abcdef12345",
      "date": "17/09/2025, 11:00 am",
      "time": "11:00",
      "notes": "Discussed new product line",
      "createdAt": "17/09/2025, 11:05 am"
    }
  ],
  "visitNotes": [
    {
      "userId": "64f1234567890abcdef12345",
      "note": "Customer interested in bulk order",
      "photo": [
        {
          "url": "https://cdn.example.com/photos/note1.jpg",
          "fileName": "note1.jpg",
          "uploadedAt": "17/09/2025, 10:40 am"
        }
      ],
      "createdAt": "17/09/2025, 10:40 am"
    }
  ]
}
```

> **Note:** `visitLogs`, `salesLogs`, `meetingLogs`, `visitNotes` are only included when `includeLogs=true`.  
> `routePath` is only included when `includeRoute=true`.

---

## Error Responses

### 401 - Unauthorized

```json
{
  "success": false,
  "message": "Unauthorized: Company ID not found"
}
```

### 400 - Invalid Date

```json
{
  "success": false,
  "message": "Invalid singleDate format. Use YYYY-MM-DD"
}
```

### 500 - Server Error

```json
{
  "success": false,
  "message": "Failed to fetch sessions",
  "error": "Error message",
  "stack": "..."  // Only in development
}
```

---

## Filtering Behavior & Fallbacks

| Scenario | Behavior |
|---|---|
| `salesPersonId` is invalid `ObjectId` | Employee filter is **silently ignored** |
| `status` is invalid value | Status filter is **silently ignored** |
| `SalesStatus` is invalid value | Sales status filter is **silently ignored** |
| `customerType` is invalid | Customer type filter is **silently ignored** |
| `customerName` is sent | Case-insensitive regex match on `customer.companyName` |
| `customerPhone` is sent | Case-insensitive regex match on `customer.phoneNumber` |
| `customerId` is sent | Exact string match on `customer.customerId` |
| `singleDate` is invalid format | Returns **400 error** |
| `startDate`/`endDate` is invalid format | Returns **400 error** |
| `sortBy` is invalid field | Falls back to `punchInTime` |
| `sortOrder` is invalid | Falls back to `-1` (descending) |
| `dateField` is invalid | Falls back to `punchInTime` |
| `nextMeetingDate` used as `dateField` | Mapped to `nextMeeting.date` for query and sorting |
| `filterType=recurringToday` | Uses `$or` query combining nextMeeting today + recurring schedule days + recurring schedule dates |
| `nextMeetingToday=true` + `dateField=nextMeetingDate` | Both set `nextMeeting.date` range (same IST range, no conflict) |
| `companyId` is missing | Falls back to `req.user.companyId`, then returns 401 |
| `includeLogs=false` | Omits all log arrays (visitLogs, salesLogs, meetingLogs, visitNotes) |
| `includeRoute=true` | Includes `routePath` array with GPS tracking points |

---

## Date Field Mapping (`dateField`)

When `dateField=nextMeetingDate`, the internal query uses `nextMeeting.date`:

```
dateField param        MongoDB field
─────────────────      ──────────────
punchInTime        →   punchInTime
createdAt          →   createdAt
updatedAt          →   updatedAt
nextMeetingDate    →   nextMeeting.date
```

---

## Recurring Schedule Structure

```json
{
  "visitType": "recurring",
  "recurringSchedule": {
    "type": "days",           // "days" or "dates"
    "days": ["Monday", "Wednesday", "Friday"],  // When type="days"
    "dates": [1, 15],         // When type="dates" (day-of-month numbers)
    "startDate": "2025-01-01T00:00:00.000Z",
    "isActive": true
  }
}
```

| `type` | Match Logic | Example |
|---|---|---|
| `"days"` | `recurringSchedule.days` includes today's IST day name | `"Monday"` matches if today is Monday |
| `"dates"` | `recurringSchedule.dates` includes today's IST date number | `17` matches if today is the 17th |

---

## Example Requests

### Get today's sessions

```
GET /api/v1/SalesRoute/sessions?filterType=today
```

### Get sessions with next meeting today

```
GET /api/v1/SalesRoute/sessions?nextMeetingToday=true
```

### Get today's recurring sessions (next meeting OR recurring schedule matches today)

```
GET /api/v1/SalesRoute/sessions?filterType=recurringToday
```

### Get retail sessions with next meeting today

```
GET /api/v1/SalesRoute/sessions?nextMeetingToday=true&salesType=retail
```

### Get all open sessions for an employee

```
GET /api/v1/SalesRoute/sessions?salesPersonId=64f123...&SalesStatus=open
```

### Search by customer name with pagination

```
GET /api/v1/SalesRoute/sessions?customerName=acme&page=2&limit=20
```

### Sort by next meeting date ascending

```
GET /api/v1/SalesRoute/sessions?sortBy=nextMeetingDate&sortOrder=1
```

### Get next week's sessions by next meeting date

```
GET /api/v1/SalesRoute/sessions?dateField=nextMeetingDate&startDate=2025-09-22&endDate=2025-09-28
```

### Full filter combo

```
GET /api/v1/SalesRoute/sessions?filterType=recurringToday&salesType=wholesale&SalesStatus=open&sortBy=nextMeetingDate&sortOrder=1&limit=50
```

---

## MongoDB Query Construction

```
companyId (always required)
  + employeeId          (if salesPersonId provided)
  + status              (if status provided)
  + SalesStatus         (if SalesStatus provided)
  + customer.type       (if customerType or salesType provided)
  + customer.companyName = /name/i  (if customerName provided)
  + customer.phoneNumber = /phone/i (if customerPhone provided)
  + customer.customerId = id         (if customerId provided)
  + nextMeeting.decided + nextMeeting.date  (if nextMeetingToday=true)
  + $or: [nextMeeting, recurring days, recurring dates]  (if filterType=recurringToday)
  + dateField $gte/$lte  (if singleDate / startDate / endDate / filterType=today|yesterday|week|month)
```
