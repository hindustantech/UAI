# Sales Session API Documentation

## Table of Contents
1. [Create Session API](#1-create-session-api)
2. [Complete Sales Form API](#2-complete-sales-form-api)
3. [Get Today's Meetings API](#3-get-todays-meetings-api)
4. [Get Today's Meetings Admin API](#4-get-todays-meetings-admin-api)
5. [Get All Sessions with Filters API](#5-get-all-sessions-with-filters-api)
6. [Bulk CSV Upload API](#6-bulk-csv-upload-api)
7. [CSV Template Download](#7-csv-template-download)
8. [Punch In API](#8-punch-in-api)
9. [Punch Out API](#9-punch-out-api)
10. [Get Session Details API](#10-get-session-details-api)
11. [Recurring Visit Logic](#11-recurring-visit-logic)
12. [Schema Changes](#12-schema-changes)
13. [Error Handling](#13-error-handling)

---

## 1. Create Session API

**Endpoint:** `POST /api/sales-sessions/create`
**Access:** Private (Admin, Partner, Agency)
**Description:** Create a single sales session with customer details

### Request Body

```json
{
  "customer_name": "John Doe",                        // REQUIRED - Contact person name
  "phone_number": "9876543210",                       // REQUIRED - Phone number (10 digits starting 6-9)
  "company_name": "ABC Electronics",                  // Optional - Company name (defaults to customer_name)
  "address": "123 Main Street, Mumbai",               // Optional - Address
  "landmark": "Near Central Mall",                    // Optional - Landmark
  "gender": "Male",                                   // Optional - Male/Female/Other (default: "Other")
  "dob": "1990-05-15",                                // Optional - Date of birth YYYY-MM-DD
  "email": "john@abcelectronics.com",                 // Optional - Email address
  "customer_type": "customer",                        // Optional - retail/wholesale/corporate/customer/agent (default: "customer")
  "salesperson_id": "507f1f77bcf86cd799439011",      // Optional - Salesperson MongoDB ObjectId
  "SalesStatus": "open",                              // Optional - open/closed/follow_up (default: "open")
  "visit_type": "recurring",                          // Optional - one_time/recurring (default: "one_time")
  "recurring_type": "days",                           // Optional - days/dates (only when visit_type=recurring)
  "recurring_days": "monday,wednesday,friday",        // Optional - Comma-separated weekdays (for type=days)
  "recurring_dates": "1,15,28",                       // Optional - Comma-separated day-of-month 1-31 (for type=dates)
  "next_meeting_date": "2026-10-01",                  // Optional - Next meeting date YYYY-MM-DD
  "next_meeting_time": "10:30",                       // Optional - Time HH:MM
  "next_meeting_notes": "Follow up on deal"           // Optional - Meeting notes
}
```

### Minimum Required Body

```json
{
  "customer_name": "John Doe",
  "phone_number": "9876543210"
}
```

### Success Response (201)

```json
{
  "success": true,
  "message": "Sales session created successfully",
  "data": {
    "sessionId": "SESS-M1K2N3-P4Q5R6",
    "customerId": "John Doe9876543210",
    "customerName": "John Doe",
    "phoneNumber": "9876543210",
    "status": "not started",
    "SalesStatus": "open",
    "visitType": "recurring",
    "nextMeeting": {
      "decided": true,
      "date": "2026-10-01T00:00:00.000Z",
      "time": "10:30",
      "notes": "Follow up on deal"
    },
    "createdBy": "Admin User"
  }
}
```

### Error Responses

| Status | Response |
|--------|----------|
| 400 | `{"success": false, "message": "customer_name and phone_number are required"}` |
| 404 | `{"success": false, "message": "Uploader user not found"}` |
| 500 | `{"success": false, "message": "Failed to generate unique customer ID: ..."}` |
| 500 | `{"success": false, "message": "Internal server error during sales session creation"}` |

---

## 2. Complete Sales Form API

**Endpoint:** `PUT /api/sales/complete-form/:sessionId`
**Access:** Private (Authenticated)
**Description:** Fill customer and sales details for a session

### Request Body (multipart/form-data)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `customer` | JSON string | **YES** | Customer details object |
| `sales` | JSON string | No | Sales details object |
| `nextMeeting` | JSON string | No | Next meeting details object |
| `evidence` | JSON string | No | Visit evidence object |
| `SalesStatus` | string | No | open/closed/follow_up |
| `shopPhoto` | file[] | **YES** | Shop photos (max 4) |
| `visitPhoto` | file[] | No | Visit evidence photos (max 4) |

### Customer Object Structure

```json
{
  "companyName": "ABC Electronics",                   // REQUIRED
  "contactName": "John Doe",                          // REQUIRED
  "phoneNumber": "9876543210",                        // REQUIRED (10 digits starting 6-9)
  "address": "123 Main Street, Mumbai",               // REQUIRED
  "landmark": "Near Central Mall",                    // Optional
  "gender": "Male",                                   // Optional - Male/Female/Other
  "dob": "1990-05-15",                                // Optional - Cannot be future date
  "email": "john@example.com",                        // Optional
  "type": "customer",                                 // Optional - retail/wholesale/corporate/customer/agent
  "isActive": true,                                   // Optional - boolean
  "location": {                                        // Optional
    "lat": 25.5941,
    "lng": 85.1376
  },
  "visitType": "recurring",                           // Optional - one_time/recurring
  "recurringSchedule": {                              // Optional - only when visitType=recurring
    "type": "days",                                   // days/dates
    "days": ["monday", "wednesday"],                  // weekday names
    "dates": [1, 15],                                 // day-of-month numbers 1-31
    "startDate": "2026-10-01",
    "isActive": true
  }
}
```

### Sales Object Structure

```json
{
  "dealStatus": "Negotiation",                       // Negotiation/Closed Won/Closed Lost/Follow Up
  "amount": 5000,                                     // Number - deal amount
  "paymentCollected": true,                           // Boolean
  "paymentMode": "UPI",                               // Cash/Card/UPI/Bank Transfer
  "note": "Customer interested in premium package"    // Optional text
}
```

### Next Meeting Object Structure

```json
{
  "decided": true,
  "date": "2026-10-15",                               // YYYY-MM-DD
  "time": "14:30",                                    // HH:MM
  "notes": "Discuss pricing"                          // Optional text
}
```

### Evidence Object Structure

```json
{
  "visitNotes": "Customer showed interest in product A",
  "visitPhoto": "file"                                // handled by multer
}
```

### Full cURL Example

```bash
curl -X PUT "http://localhost:3000/api/sales/complete-form/SS-20261001-001" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F 'customer={"companyName":"ABC Electronics","contactName":"John Doe","phoneNumber":"9876543210","address":"123 Main Street","visitType":"recurring","recurringSchedule":{"type":"days","days":["monday"],"isActive":true}}' \
  -F 'sales={"dealStatus":"Negotiation","amount":5000}' \
  -F 'nextMeeting={"decided":true,"date":"2026-10-15","time":"14:30"}' \
  -F 'SalesStatus=open' \
  -F 'shopPhoto=@shop1.jpg' \
  -F 'shopPhoto=@shop2.jpg' \
  -F 'visitPhoto=@visit1.jpg'
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Session processed successfully",
  "data": {
    "sessionId": "SS-20261001-001",
    "status": "in_progress",
    "SalesStatus": "open",
    "formCompleted": true,
    "customer": {
      "companyName": "ABC Electronics",
      "contactName": "John Doe",
      "phoneNumber": "9876543210"
    },
    "visitType": "recurring",
    "recurringSchedule": {
      "type": "days",
      "days": ["monday"],
      "isActive": true
    }
  }
}
```

### Validation Errors (400)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "companyName": "Company name is required",
    "contactName": "Contact name is required",
    "address": "Address is required",
    "phoneNumber": "Phone number is required",
    "phoneNumber": "Invalid phone number format",
    "gender": "Invalid gender. Must be one of: Male, Female, Other",
    "dob": "Invalid date format",
    "dob": "DOB cannot be a future date",
    "type": "Invalid customer type. Must be one of: retail, wholesale, corporate, customer, agent",
    "isActive": "isActive must be a boolean value"
  }
}
```

---

## 3. Get Today's Meetings API

**Endpoint:** `GET /api/sales/getTodayMeetings`
**Access:** Private (Authenticated)
**Description:** Get today's sales sessions - includes nextMeeting today + recurring visits matching today

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |

### Success Response (200)

```json
{
  "success": true,
  "page": 1,
  "limit": 10,
  "total": 25,
  "totalPages": 3,
  "count": 10,
  "data": [
    {
      "_id": "64f...",
      "sessionId": "SS-20261001-001",
      "status": "in_progress",
      "SalesStatus": "open",
      "visitType": "recurring",
      "recurringSchedule": {
        "type": "days",
        "days": ["monday"],
        "isActive": true,
        "startDate": "2026-09-01T00:00:00.000Z"
      },
      "customer": {
        "companyName": "ABC Electronics",
        "contactName": "John Doe",
        "phoneNumber": "9876543210",
        "address": "123 Main Street",
        "landmark": "Near Central Mall"
      },
      "nextMeeting": {
        "decided": true,
        "date": "2026-10-01T00:00:00.000Z",
        "time": "10:30",
        "notes": "Follow up"
      },
      "employeeId": {
        "_id": "507f...",
        "name": "Sales Person",
        "email": "sales@example.com"
      },
      "assignedTo": [
        {
          "_id": "507f...",
          "name": "Sales Person",
          "email": "sales@example.com"
        }
      ],
      "punchInTime": "2026-10-01T09:00:00.000Z",
      "punchOutTime": null,
      "createdAt": "2026-09-30T14:30:00.000Z",
      "updatedAt": "2026-10-01T08:55:00.000Z"
    }
  ]
}
```

### How Today's Visits Are Determined

The API returns sessions matching **ANY** of these 3 conditions:

```
CONDITION 1: nextMeeting scheduled today
  - nextMeeting.decided = true
  - nextMeeting.date = today (00:00:00 to 23:59:59)

CONDITION 2: Recurring by weekday
  - visitType = "recurring"
  - recurringSchedule.type = "days"
  - recurringSchedule.isActive = true
  - recurringSchedule.days INCLUDES today's weekday name
  - recurringSchedule.startDate <= today

CONDITION 3: Recurring by day-of-month
  - visitType = "recurring"
  - recurringSchedule.type = "dates"
  - recurringSchedule.isActive = true
  - recurringSchedule.dates INCLUDES today's day number (1-31)
  - recurringSchedule.startDate <= today
```

### Weekday Names

Lowercase English: `sunday`, `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`

---

## 4. Get Today's Meetings Admin API

**Endpoint:** `GET /api/sales/getTodayMeetingsAdmin`
**Access:** Private (Admin)
**Description:** Admin view of today's meetings across all employees in the company

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `userId` | string | optional | Filter by specific employee/user ObjectId |

### Success Response (200)

Same format as `getTodayMeetings`.

---

## 5. Get All Sessions with Filters API

**Endpoint:** `GET /api/sales/sessions`
**Access:** Private (Authenticated)
**Description:** Get all sales sessions with advanced filtering and pagination

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `salesPersonId` | string | - | Filter by employee ObjectId |
| `status` | string | - | `not started` / `in_progress` / `completed` |
| `SalesStatus` | string | - | `open` / `closed` / `follow_up` |
| `startDate` | string | - | ISO date - range start |
| `endDate` | string | - | ISO date - range end |
| `singleDate` | string | - | Single date YYYY-MM-DD |
| `filterType` | string | - | `today` / `yesterday` / `week` / `month` |
| `dateField` | string | `punchInTime` | `punchInTime` / `createdAt` / `updatedAt` |
| `customerType` | string | - | retail/wholesale/corporate/customer/agent |
| `customerName` | string | - | Search by company name (partial, case-insensitive) |
| `customerPhone` | string | - | Search by phone number (partial) |
| `customerId` | string | - | Exact customer ID match |
| `includeLogs` | string | `true` | Include visit/sales/meeting logs |
| `includeRoute` | string | `false` | Include route path data |
| `sortBy` | string | `punchInTime` | Sort field |
| `sortOrder` | string | `-1` | `1` (asc) or `-1` (desc) |
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page (max 100) |

### Filter Examples

```bash
# Get today's sessions
GET /api/sales/sessions?filterType=today

# Get sessions by status
GET /api/sales/sessions?status=in_progress&SalesStatus=open

# Get sessions by date range
GET /api/sales/sessions?startDate=2026-01-01&endDate=2026-12-31

# Get sessions by customer search
GET /api/sales/sessions?customerName=ABC&customerPhone=98765

# Get sessions by employee
GET /api/sales/sessions?salesPersonId=507f1f77bcf86cd799439011

# Multiple filters combined
GET /api/sales/sessions?status=in_progress&SalesStatus=follow_up&customerType=corporate&page=2&limit=20

# Sort by amount descending
GET /api/sales/sessions?sortBy=totalDistance&sortOrder=-1
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Sessions retrieved successfully",
  "count": 10,
  "data": [
    {
      "id": "SS-20261001-001",
      "status": "in_progress",
      "SalesStatus": "open",
      "formCompleted": true,
      "visitType": "recurring",
      "customer": {
        "customerId": "John Doe9876543210",
        "type": "customer",
        "companyName": "ABC Electronics",
        "contactName": "John Doe",
        "phone": "9876543210",
        "address": "123 Main Street",
        "landmark": "Near Central Mall",
        "location": {
          "latitude": 25.5941,
          "longitude": 85.1376,
          "type": "Point"
        },
        "shopPhoto": [
          {
            "url": "https://res.cloudinary.com/...",
            "fileName": "shop1.jpg",
            "uploadedAt": "01/10/2026, 10:30 AM"
          }
        ]
      },
      "employee": {
        "_id": "507f...",
        "name": "Sales Person",
        "email": "sales@example.com",
        "phone": "9876543211"
      },
      "createdBy": { "_id": "507f...", "name": "Admin" },
      "assignedTo": [{ "_id": "507f...", "name": "Sales Person" }],
      "company": { "_id": "507f...", "name": "My Company" },
      "punch": {
        "inTime": "01/10/2026, 09:00 AM",
        "outTime": "-",
        "inLocation": { "latitude": 25.5941, "longitude": 85.1376 },
        "outLocation": null,
        "outAddress": "",
        "lastPunchAt": "01/10/2026, 09:00 AM"
      },
      "stats": {
        "totalDistance": 1500,
        "duration": 3600,
        "visits": 2,
        "sales": 1,
        "meetings": 1,
        "notes": 1
      },
      "nextMeeting": {
        "decided": true,
        "date": "15/10/2026, 02:30 PM",
        "time": "14:30",
        "notes": "Discuss pricing"
      },
      "evidence": {
        "visitNotes": "Customer interested",
        "visitPhoto": { "url": "...", "fileName": "visit.jpg" }
      },
      "visitLogs": [
        {
          "userId": "507f...",
          "punchInTime": "01/10/2026, 09:00 AM",
          "punchOutTime": "01/10/2026, 09:45 AM",
          "punchInLocation": { "latitude": 25.5941, "longitude": 85.1376 },
          "punchOutLocation": { "latitude": 25.5950, "longitude": 85.1380 }
        }
      ],
      "salesLogs": [
        {
          "userId": "507f...",
          "dealStatus": "Negotiation",
          "amount": 5000,
          "paymentCollected": false,
          "paymentMode": null,
          "note": "Interested in premium",
          "createdAt": "01/10/2026, 10:30 AM"
        }
      ],
      "timestamps": {
        "createdAt": "30/09/2026, 02:30 PM",
        "updatedAt": "01/10/2026, 08:55 AM"
      }
    }
  ],
  "pagination": {
    "total": 250,
    "page": 1,
    "limit": 10,
    "pages": 25,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "filters": {
    "companyId": "507f...",
    "employeeId": null,
    "status": null,
    "SalesStatus": null,
    "filterType": null,
    "singleDate": null,
    "dateRange": { "field": "punchInTime", "start": null, "end": null },
    "customer": { "type": null, "name": null, "phone": null, "id": null }
  }
}
```

---

## 6. Bulk CSV Upload API

**Endpoint:** `POST /api/sales-sessions/bulk-upload`
**Access:** Private (Admin, Partner, Agency)
**Description:** Bulk upload sales sessions from Excel or CSV file

### Request

**Content-Type:** `multipart/form-data`
**Field name:** `file`

### CSV/Excel Columns

#### Required Columns

| # | Column Name | Type | Description |
|---|-------------|------|-------------|
| 1 | `company_name` | string | Customer's company or business name |
| 2 | `contact_name` | string | Contact person's name |
| 3 | `phone_number` | string | Phone number (10-15 digits) |
| 4 | `address` | string | Business or meeting address |

#### Required (at least one salesperson identifier)

| # | Column Name | Type | Description |
|---|-------------|------|-------------|
| 5 | `salesperson_referral_code` | string | Salesperson's referral code |
| 6 | `salesperson_id` | string | Salesperson's UID |
| 7 | `assigned_to` | string | Salesperson's MongoDB ObjectId |

> **Note:** At least ONE of columns 5, 6, or 7 is required. If none provided and uploader is partner/agency, session is self-assigned.

#### Optional Customer Columns

| # | Column Name | Type | Default | Description |
|---|-------------|------|---------|-------------|
| 8 | `customer_id` | string | auto-generated | Unique customer identifier |
| 9 | `landmark` | string | `""` | Nearby landmark |
| 10 | `gender` | string | `Other` | Male/Female/Other |
| 11 | `email` | string | `""` | Email address |
| 12 | `customer_type` | string | `customer` | retail/wholesale/corporate/customer/agent |
| 13 | `dob` | string | `null` | Date of birth YYYY-MM-DD |
| 14 | `notes` | string | `""` | Additional notes |

#### Optional Visit & Schedule Columns

| # | Column Name | Type | Default | Description |
|---|-------------|------|---------|-------------|
| 15 | `visit_type` | string | `one_time` | `one_time` or `recurring` |
| 16 | `recurring_type` | string | - | `days` or `dates` |
| 17 | `recurring_dates` | string | `[]` | Comma-separated: `1,15,28` |
| 18 | `recurring_days` | string | `[]` | Comma-separated: `monday,wednesday` |
| 19 | `next_meeting_date` | string | - | Date YYYY-MM-DD |
| 20 | `next_meeting_time` | string | - | Time HH:MM |
| 21 | `next_meeting_notes` | string | `""` | Meeting notes |

### Valid Recurring Days Values

`sunday`, `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`

### Valid Recurring Dates Values

Numbers 1-31 (day of month), comma separated

### Full CSV Example

```csv
company_name,contact_name,phone_number,address,landmark,salesperson_referral_code,visit_type,recurring_type,recurring_dates,recurring_days,next_meeting_date,next_meeting_time,next_meeting_notes,gender,email,customer_type
ABC Electronics,John Doe,9876543210,123 Main Street Mumbai,Near Central Mall,REF001,one_time,,,,,,"Male",john@example.com,customer
XYZ Traders,Jane Smith,9876543211,456 Park Avenue Delhi,Opposite Metro,REF001,recurring,dates,1,15,28,2026-10-01,10:30,"Monthly review",Female,jane@example.com,wholesale
PQR Industries,Ravi Kumar,9876543212,789 Industrial Area,PQRS Office,REF001,recurring,days,,monday,wednesday,,,"",,9am and 4pm visits",Male,ravi@pqr.com,corporate
LMN Foods,Amit Singh,9876543213,321 Market Road,Near Bus Stand,REF001,one_time,,,,,,,"Other",,amit@lmn.com,retail
```

### Full cURL Example

```bash
curl -X POST "http://localhost:3000/api/sales-sessions/bulk-upload" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@sales_data.xlsx"
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Bulk upload completed successfully",
  "data": {
    "uploadedBy": {
      "userId": "507f1f77bcf86cd799439011",
      "userName": "Admin User",
      "userType": "admin"
    },
    "companyId": "507f1f77bcf86cd799439011",
    "locationUsed": [85.1376, 25.5941],
    "summary": {
      "total": 4,
      "successful": 4,
      "failed": 0
    },
    "successfulRecords": [
      {
        "row": 2,
        "sessionId": "SESS-M1K2N3-P4Q5R6",
        "customerId": "John Doe9876543210",
        "companyName": "ABC Electronics",
        "assignedTo": {
          "id": "507f...",
          "name": "Sales Person",
          "uid": "SP001",
          "referralCode": "REF001"
        },
        "locationUsed": [85.1376, 25.5941]
      }
    ],
    "failedRecords": []
  }
}
```

### Failed Upload Response (200 with errors)

```json
{
  "success": true,
  "message": "Bulk upload completed successfully",
  "data": {
    "summary": {
      "total": 4,
      "successful": 2,
      "failed": 2
    },
    "successfulRecords": [...],
    "failedRecords": [
      {
        "row": 3,
        "error": "Salesperson not found with provided ID/Referral Code",
        "data": { "company_name": "Bad Data Inc", "..." : "..." }
      },
      {
        "row": 4,
        "error": "Failed to generate unique customer ID: Timeout",
        "data": { "company_name": "Timeout Inc", "..." : "..." }
      }
    ]
  }
}
```

### Error Responses

| Status | Message |
|--------|---------|
| 400 | `Please upload a file (Excel or CSV)` |
| 400 | `Missing required columns: company_name, contact_name, phone_number, address` |
| 400 | `At least one of these columns is required: salesperson_referral_code, salesperson_id, assigned_to` |
| 400 | `File size too large. Maximum size is 10MB` |
| 500 | `Internal server error during bulk upload` |

### File Limits

- **Max file size:** 10MB
- **Allowed formats:** `.xlsx`, `.xls`, `.csv`

---

## 7. CSV Template Download

**Endpoint:** `GET /api/sales-sessions/bulk-upload-template`
**Access:** Private (Authenticated)
**Description:** Download Excel template with sample data

### Response

Returns `.xlsx` file as download.

**Template Columns:**

| Column | Sample Value |
|--------|-------------|
| company_name | ABC Electronics |
| contact_name | John Doe |
| phone_number | 9876543210 |
| address | 123 Main Street, Mumbai |
| landmark | Near Central Mall |
| salesperson_referral_code | REF123ABC |
| visit_type | one_time |
| next_meeting_date | |
| next_meeting_notes | |
| visit_type | recurring |
| recurring_type | days |
| recurring_dates | |
| next_meeting_date | 2026-10-01 |
| next_meeting_notes | Follow up meeting |

### cURL Example

```bash
curl -X GET "http://localhost:3000/api/sales-sessions/bulk-upload-template" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  --output template.xlsx
```

---

## 8. Punch In API

**Endpoint:** `POST /api/sales/punch-in`
**Access:** Private (Authenticated)
**Description:** Start a new session or resume existing one

### Request Body

```json
{
  "location": {
    "lat": 25.5941,
    "lng": 85.1376
  },
  "deviceInfo": {
    "deviceId": "device-123",
    "os": "Android",
    "appVersion": "1.0.0"
  },
  "sessionId": "SESS-M1K2N3-P4Q5R6"          // Optional - resume existing session
}
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Punch-in + session created",
  "data": {
    "punchIn": "2026-10-01T09:00:00.000Z",
    "sessionId": "SESS-M1K2N3-P4Q5R6"
  }
}
```

---

## 9. Punch Out API

**Endpoint:** `PUT /api/sales/punch-out`
**Access:** Private (Authenticated)
**Description:** End session

### Request Body

```json
{
  "sessionId": "SESS-M1K2N3-P4Q5R6",
  "location": {
    "lat": 25.5950,
    "lng": 85.1380
  },
  "deviceInfo": {
    "deviceId": "device-123"
  }
}
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Punch-out successful",
  "data": {
    "userId": "507f...",
    "employeeId": "507f...",
    "sessionId": "64f...",
    "durationSeconds": 3600,
    "visitLogsClosed": 0
  }
}
```

---

## 10. Get Session Details API

**Endpoint:** `GET /api/sales/session/:sessionId`
**Access:** Private (Authenticated)
**Description:** Get single session with all details

### Success Response (200)

```json
{
  "success": true,
  "session": {
    "id": "SS-20261001-001",
    "status": "completed",
    "customer": {
      "customerId": "John Doe9876543210",
      "companyName": "ABC Electronics",
      "contactName": "John Doe",
      "phoneNumber": "9876543210",
      "address": "123 Main Street",
      "gender": "Male",
      "email": "john@example.com",
      "location": { "latitude": 25.5941, "longitude": 85.1376 }
    },
    "employee": { "name": "Sales Person", "email": "sales@example.com" },
    "createdBy": { "name": "Admin", "email": "admin@example.com" },
    "assignedTo": [{ "name": "Sales Person" }],
    "company": { "name": "My Company", "address": "HQ Address" },
    "punch": {
      "inTime": "2026-10-01T09:00:00.000Z",
      "outTime": "2026-10-01T10:00:00.000Z",
      "inLocation": { "latitude": 25.5941, "longitude": 85.1376 },
      "outLocation": { "latitude": 25.5950, "longitude": 85.1380 },
      "outAddress": "123 Main Street"
    },
    "logs": {
      "visits": [...],
      "sales": [...],
      "meetings": [...],
      "notes": [...]
    },
    "evidence": { "visitNotes": "...", "visitPhoto": { "url": "..." } },
    "nextMeeting": { "date": "...", "time": "14:30", "notes": "..." },
    "route": {
      "totalDistance": { "meters": 1500, "km": "1.50" },
      "totalPoints": 25,
      "coordinates": [...]
    },
    "timestamps": { "createdAt": "...", "updatedAt": "..." }
  },
  "stats": {
    "duration": 3600,
    "formattedDuration": "1h 0m",
    "distance": 1500,
    "routePoints": 25,
    "totalVisits": 2,
    "totalSales": 1
  }
}
```

---

## 11. Recurring Visit Logic

### How It Works

When a session is created with `visitType: "recurring"`, the system stores a recurring schedule pattern. The `getTodayMeetings` and `getTodayMeetingsAdmin` APIs automatically include sessions whose pattern matches today.

### Recurring by Days (Weekday Pattern)

```json
{
  "visitType": "recurring",
  "recurringSchedule": {
    "type": "days",
    "days": ["monday", "wednesday", "friday"],
    "isActive": true,
    "startDate": "2026-09-01T00:00:00.000Z"
  }
}
```

**Result:** Session appears in today's list every Monday, Wednesday, and Friday (after startDate).

### Recurring by Dates (Day-of-Month Pattern)

```json
{
  "visitType": "recurring",
  "recurringSchedule": {
    "type": "dates",
    "dates": [1, 15],
    "isActive": true,
    "startDate": "2026-09-01T00:00:00.000Z"
  }
}
```

**Result:** Session appears in today's list on the 1st and 15th of every month (after startDate).

### Decision Flow

```
Session Created
      |
      v
visitType = "one_time"  -----> Only appears in today's list if nextMeeting.date = today
      |
visitType = "recurring"
      |
      +-- recurringSchedule.type = "days"
      |       |
      |       v
      |   recurringSchedule.days includes today's weekday? --> YES --> Show in today's list
      |       |
      |       NO --> Skip
      |
      +-- recurringSchedule.type = "dates"
              |
              v
          recurringSchedule.dates includes today's day number? --> YES --> Show in today's list
              |
              NO --> Skip
```

---

## 12. Schema Changes

### New Fields Added to SalesSession

**File:** `models/Attandance/Salses/Salses.js`

```javascript
// NEW FIELD: visitType
visitType: {
    type: String,
    enum: ["one_time", "recurring"],
    default: "one_time"
}

// NEW FIELD: recurringSchedule (nested object)
recurringSchedule: {
    type: {
        type: String,
        enum: ["days", "dates"]
    },
    days: { type: [String], default: [] },          // ["monday", "wednesday"]
    dates: { type: [Number], default: [] },          // [1, 15, 28]
    startDate: { type: Date, default: null },
    isActive: { type: Boolean, default: false }
}
```

### Existing Fields (unchanged)

| Field | Type | Default |
|-------|------|---------|
| `status` | String | `"not started"` |
| `SalesStatus` | String | `"open"` |
| `nextMeeting.decided` | Boolean | `false` |
| `nextMeeting.date` | Date | - |
| `nextMeeting.time` | String | - |
| `nextMeeting.notes` | String | - |
| `formCompleted` | Boolean | `false` |

---

## 13. Error Handling

### All APIs Return Consistent Format

```json
{
  "success": false,
  "message": "Human readable error",
  "error": "Technical error (dev only)",
  "stack": "Stack trace (dev only)"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - validation failed |
| 401 | Unauthorized - not logged in |
| 403 | Forbidden - access denied |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## Frontend Integration Notes

### State Variables Needed

```javascript
// Session creation form
const [formData, setFormData] = useState({
  customer_name: '',
  phone_number: '',
  company_name: '',
  address: '',
  landmark: '',
  gender: 'Other',
  dob: '',
  email: '',
  customer_type: 'customer',
  salesperson_id: '',
  SalesStatus: 'open',
  visit_type: 'one_time',
  recurring_type: '',
  recurring_days: [],
  recurring_dates: [],
  next_meeting_date: '',
  next_meeting_time: '',
  next_meeting_notes: ''
});

// Conditional rendering based on visit_type
const showRecurring = formData.visit_type === 'recurring';
const showRecurringDays = showRecurring && formData.recurring_type === 'days';
const showRecurringDates = showRecurring && formData.recurring_type === 'dates';
```

### Conditional Form Sections

```
visit_type = "one_time"
  -> Hide recurring fields
  -> Show: next_meeting_date, next_meeting_time, next_meeting_notes

visit_type = "recurring"
  -> Show: recurring_type selector
    -> recurring_type = "days"
      -> Show: weekday checkboxes (monday-sunday)
    -> recurring_type = "dates"
      -> Show: day-of-month multi-select (1-31)
  -> Show: next_meeting_date (start date), next_meeting_time, next_meeting_notes
```

### Today's Visit API Response Handling

```javascript
// Each session in the response can be a:
// 1. One-time session with nextMeeting today
// 2. Recurring by days session matching today's weekday
// 3. Recurring by dates session matching today's day number

// To determine type:
const getVisitType = (session) => {
  if (session.visitType === 'recurring') {
    if (session.recurringSchedule?.type === 'days') return 'Recurring (Weekly)';
    if (session.recurringSchedule?.type === 'dates') return 'Recurring (Monthly)';
  }
  if (session.nextMeeting?.decided) return 'Scheduled Meeting';
  return 'One-time Visit';
};
```

### CSV Upload Flow

```javascript
// 1. Download template first
const downloadTemplate = async () => {
  const response = await fetch('/api/sales-sessions/bulk-upload-template', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const blob = await response.blob();
  // trigger download
};

// 2. Upload CSV
const uploadCSV = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/sales-sessions/bulk-upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  
  const result = await response.json();
  // result.data.summary.successful
  // result.data.summary.failed
  // result.data.failedRecords (for error display)
};
```

---

## API Quick Reference

| # | Method | Endpoint | Purpose |
|---|--------|----------|---------|
| 1 | POST | `/api/sales-sessions/create` | Create single session |
| 2 | PUT | `/api/sales/complete-form/:sessionId` | Fill customer + sales details |
| 3 | GET | `/api/sales/getTodayMeetings` | Today's meetings (incl. recurring) |
| 4 | GET | `/api/sales/getTodayMeetingsAdmin` | Admin: today's meetings |
| 5 | GET | `/api/sales/sessions` | All sessions with filters |
| 6 | POST | `/api/sales-sessions/bulk-upload` | Bulk CSV upload |
| 7 | GET | `/api/sales-sessions/bulk-upload-template` | Download CSV template |
| 8 | POST | `/api/sales/punch-in` | Punch in |
| 9 | PUT | `/api/sales/punch-out` | Punch out |
| 10 | GET | `/api/sales/session/:sessionId` | Session details |
| 11 | GET | `/api/sales/open-sessions` | Open sessions |
| 12 | GET | `/api/sales/getCompanyLeads` | Company leads |
| 13 | GET | `/api/sales/getMyAssignedSessions` | My assigned sessions |
| 14 | POST | `/api/sales/assignToOther/:sessionId` | Assign session to other |
| 15 | GET | `/api/sales/reports/employee-monthly` | Monthly report |
| 16 | GET | `/api/sales/reports/customer-type-breakdown` | Customer breakdown |
| 17 | GET | `/api/sales/reports/new-vs-repeat-customers` | New vs repeat |
| 18 | GET | `/api/sales/reports/payment-revenue` | Payment revenue |
