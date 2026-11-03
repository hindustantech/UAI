# Payroll API & Calculation Rules

Base path: `/api/v1/payrollroutes`

All routes require a bearer token (`Authorization: Bearer <token>`). The company
is always resolved from the token — do not send `companyId` for payroll
operations.

Downloads additionally require an active paid subscription.

---

## 1. Calculation rules (locked)

These rules are the single source of truth used by `services/salaryCalculator.js`
and `services/payroll/attendanceLedger.service.js`.

### 1.1 Day-count basis

The pay month uses **actual calendar days**:

| Month | Days |
|---|---|
| January, March, May, July, August, October, December | 31 |
| April, June, September, November | 30 |
| February (non-leap) | 28 |
| February (leap) | 29 |

Per-day rate = `monthly gross components ÷ calendar days of the month`.

Pro-rata factor and LOP are also based on the same calendar-day denominator.

### 1.2 Day-by-day attendance precedence

For each day of the employee's employment window
(`jobInfo.joiningDate` … `deactivatedAt`):

1. `present` / `half_day` / `comp_off` attendance record
2. approved leave (paid or unpaid, from `LeaveType.paid`)
3. company holiday
4. weekly off / half-day weekly off
5. missing record on a working day → **absent (LOP)**

### 1.3 Loss of Pay (LOP)

```
LOP days = absent days
         + unpaid leave days
         + 0.5 × unpaid half-days
```

- Paid leave, holidays and weekly offs are **paid** and never become LOP.
- A working `half_day` record pays 0.5 day. The other 0.5 is LOP unless an
  approved **paid** half-day leave covers it.
- Half-day leave covered by a paid leave type pays 0.5 and does not create LOP.
- Employees joining mid-month or exiting mid-month are prorated automatically;
  days outside the employment window are not marked absent.

### 1.4 Late / half-day salary rules

- Late-arrival cuts from `SalaryRule.late` are applied as `cutDays × per-day rate`.
- Half-day rule cuts are **not** applied on top of LOP, because the unpaid half
  of a half-day is already counted as 0.5 LOP.

### 1.5 Statutory deductions

| Item | Rule |
|---|---|
| PF | `PayrollRule.deductions.pf` on **earned basic** |
| ESI | `PayrollRule.deductions.esi`, applied **only when gross ≤ ₹21,000** |
| Gratuity | `PayrollRule.deductions.gratuity` — **employer contribution only**, never deducted from net |

`netSalary` is clamped at `0`; it can never be negative.

### 1.6 Pay types and approaches

| `salaryStructure` | Behaviour |
|---|---|
| `perHour > 0` | Hourly: payable hours × `perHour` + overtime |
| `perDay > 0` | Per-day: `perDay` × payable days + overtime |
| `basic` set, `salaryApproach: "full_minus_lop"` (default) | Full monthly gross − LOP/proration − rule cuts |
| `basic` set, `salaryApproach: "pro_rata"` | Monthly components × (`payable days ÷ calendar days`) |

Overtime is always `overtime hours × overtimeRate`.

---

## 2. Attendance ledger output

Every payroll response contains an `attendance` block built by the ledger:

```json
{
  "standardDays": 30,
  "employmentCalendarDays": 30,
  "workingDays": 22,
  "weeklyOffDays": 4,
  "weeklyOffHalfDays": 0,
  "holidays": 2,
  "leaveDays": 3,
  "paidLeaveDays": 2,
  "unpaidLeaveDays": 1,
  "unpaidHalfDays": 0.5,
  "absentDays": 1,
  "lateDays": 2,
  "halfDays": 1,
  "presentDays": 20.5,
  "compOffDaysUsed": 0,
  "totalPayableMinutes": 9840,
  "totalMinutes": 10800,
  "overtimeMinutes": 120,
  "lopDays": 2.5,
  "payableDays": 24.5,
  "leaveBreakdown": [
    {
      "leaveTypeId": "674f...",
      "leaveTypeName": "Casual Leave",
      "leaveTypeCode": "CL",
      "paid": true,
      "days": 2
    }
  ]
}
```

### Loss of pay block

```json
{
  "lopDays": 2.5,
  "lopAmount": 2083.33,
  "absentDays": 1,
  "unpaidLeaveDays": 1,
  "unpaidHalfDays": 0.5,
  "prorationDays": 0,
  "prorationAmount": 0,
  "totalDeductedDays": 2.5,
  "totalDeductedAmount": 2083.33,
  "deducted": true,
  "mode": "full_minus_lop"
}
```

`deducted: false` for `pro_rata`, per-day and hourly modes — those modes already
pay only for payable time, so LOP is reported for transparency but not deducted
again.

### Employer contributions

```json
{
  "statutoryDeductions": { "pf": 1800, "esi": 0, "gratuity": 721.5 },
  "employerContributions": { "gratuity": 721.5 }
}
```

Gratuity is **not** part of `totalDeductions` and does not reduce `netSalary`.

---

## 3. Endpoints

### 3.1 Generate payroll (single employee)

`POST /generate`

Body:

```json
{
  "employeeId": "674f...",
  "month": 11,
  "year": 2026,
  "payDate": "2026-11-30",
  "force": false,
  "overrideAttendance": null
}
```

- `force: true` regenerates an existing **draft** payroll.
- `overrideAttendance` is optional and intended for tests/integrations; when
  omitted the ledger is always used.
- Returns `409` when a payroll already exists and `force` is not `true`.
- Returns `400` when the employee was not employed in the pay period or has no
  salary structure.

Response `201`:

```json
{
  "success": true,
  "message": "Payroll generated successfully.",
  "data": { "_id": "674f...", "netSalary": 42000, "...": "..." }
}
```

### 3.2 Generate payroll (bulk)

`POST /generate-bulk`

Body:

```json
{ "month": 11, "year": 2026, "payDate": "2026-11-30" }
```

- Creates payroll for every active employee that does not already have one for
  the period.
- Employees not employed in the period are skipped.
- Response includes `created`, `skipped` and `failed` arrays.

### 3.3 Preview payroll (no save)

`POST /preview`

Body:

```json
{ "employeeId": "674f...", "month": 11, "year": 2026 }
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "attendance": { "...": "ledger output" },
    "payroll": { "...": "full calculated payroll, not persisted" }
  }
}
```

Use this to show a live payslip while the user adjusts month/year.

### 3.4 Recalculate a draft payroll

`POST /:payrollId/recalculate`

- Rebuilds the ledger and salary for the payroll's own `payPeriod`.
- Only `draft` payroll can be recalculated; other statuses return `400`.
- Appends an `editLogs` entry with old/new net salary and LOP.

Response `200`:

```json
{
  "success": true,
  "message": "Payroll recalculated successfully.",
  "data": { "payroll": { "...": "..." }, "attendance": { "...": "..." } }
}
```

### 3.5 Read

| Method | Path | Notes |
|---|---|---|
| `GET` | `/company?month=&year=&department=&status=&page=&limit=` | Company payroll for a month |
| `GET` | `/employee/:employeeId?month=&year=&page=&limit=` | Employee payroll history or one month |
| `GET` | `/getAllPayrollByCompany/:companyId` | Legacy lookup |
| `GET` | `/getPayrollByEmployeeAndCompany/:companyId/employee/:employeeId` | Legacy lookup |

### 3.6 Status

`PATCH /:payrollId/status`

Body:

```json
{ "status": "approved", "remarks": "Reviewed" }
```

Allowed transitions: `draft` → `approved` → `paid`, or → `cancelled`.

### 3.7 Downloads

| Method | Path | Notes |
|---|---|---|
| `GET` | `/download/excel?month=&year=` | Company payroll register (3 sheets) |
| `GET` | `/download/pdf/:payrollId` | Individual payslip |

The Excel register includes paid/unpaid leave split, unpaid half-days, LOP days
and amount, proration days, and employer gratuity (shown separately, not part of
total deductions).

### 3.8 Delete

| Method | Path |
|---|---|
| `DELETE` | `/:payrollId` |
| `DELETE` | `/company/:companyId` |
| `DELETE` | `/company/:companyId/employee/:employeeId` |

Delete routes require an active paid subscription.

---

## 4. Payroll document (key fields)

```json
{
  "companyId": "674f...",
  "employeeId": "674f...",
  "payPeriod": {
    "month": 11,
    "year": 2026,
    "label": "November 2026",
    "startDate": "2026-11-01T00:00:00.000Z",
    "endDate": "2026-11-30T00:00:00.000Z"
  },
  "payDate": "2026-11-30T00:00:00.000Z",
  "status": "draft",
  "payType": "monthly",
  "salaryApproach": "full_minus_lop",
  "attendance": { "...": "ledger output" },
  "payableDays": 24.5,
  "earnings": {
    "basic": 20000,
    "hra": 8000,
    "da": 0,
    "bonus": 0,
    "overtime": 500,
    "otherAllowances": [{ "name": "Transport", "amount": 2000 }]
  },
  "grossSalary": 30500,
  "statutoryDeductions": { "pf": 1800, "esi": 0, "gratuity": 721.5 },
  "employerContributions": { "gratuity": 721.5 },
  "otherDeductions": {
    "incomeTax": 0,
    "professionalTax": 200,
    "additionalLines": []
  },
  "lossOfPay": { "...": "see above" },
  "totalDeductions": 4083.33,
  "netSalary": 26416.67,
  "ratesUsed": {
    "perDayRate": 1000,
    "perHourRate": 0,
    "perDay": 0,
    "perHour": 0,
    "overtimeRate": 250
  }
}
```

---

## 5. Error responses

| Status | Meaning |
|---|---|
| `400` | Invalid month/year, no salary structure, employee not employed in period, payroll not in draft |
| `404` | Employee or payroll not found |
| `409` | Payroll already exists for the period (use `force` or recalculate) |
| `500` | Unhandled server error |

All errors use:

```json
{ "success": false, "message": "..." }
```
