# Scheduled Jobs

The backend has two scheduling systems:

1. **node-cron** — in-process cron expressions, started either at import time or explicitly from
   `server.js`.
2. **BullMQ** — Redis-backed queues consumed by tiered workers, plus delayed jobs used for
   reminders and reports.

All times are **server local time** (node-cron does not force a timezone unless a `timezone`
option is passed; the jobs below do not pass one).

---

## Where jobs are started

| Job | Started by | File |
|---|---|---|
| Attendance auto-close | `startAttendanceCron()` in the `listen` callback | `controllers/attandance/attendanceAutoClose.job.js` |
| Task schedulers (3 crons) | `startTaskSchedulers()` in the `listen` callback | `cron/taskScheduler.cron.js` |
| Leave monthly accrual | `LeaveMonthlyAccrualCron.initializeCron()` | `controllers/attandance/crons/leaveMonthlyAccrual.cron.js` |
| Leave yearly allocation | `LeaveYearlyAllocationCron.initializeCron()` | `controllers/attandance/crons/leaveYearlyAllocation.cron.js` |
| Leave earned accrual | `LeaveEarnedAccrualCron.initializeCron()` | `controllers/attandance/crons/leaveEarnedAccrual.cron.js` |
| Subscription billing | **side-effect import** in `server.js` | `cron/subscription.js` |
| Mark absent | side-effect import | `cron/markAbsent.cron.js` |
| Mark punch-out | side-effect import | `cron/markpunchout.cron.js` |
| Sales session punch-out | side-effect import | `cron/markSalesSessionPunchOut.cron.js` |
| Comp-off expiry | side-effect import | `cron/compOffExpiry.cron.js` |
| Holiday auto-mark | side-effect import | `models/Attandance/Holiydaycron.js` |
| Subscription reminders | `initializeSchedulers()` | `src/notification/scheduler/subscriptionReminder.js` |
| Attendance punch automation | **not imported by `server.js`** — see note | `controllers/attandance/crons/punchAutomationCron.js` |
| Sales session auto punch-out | **not imported by `server.js`** — see note | `controllers/attandance/crons/salesSessionAutoPunchOutCron.js` |

> ⚠️ `punchAutomationCron.js` and `salesSessionAutoPunchOutCron.js` define crons but are not
> imported anywhere in the boot path. They only run if something imports them. Treat them as
> dormant until wired up.
>
> `cron/fixInvalidPunch.js` is a one-off maintenance script, not registered at boot.

---

<!-- AUTO:START:cron -->
### node-cron schedules

| Schedule | Frequency (human) | Job | File |
|---|---|---|---|
| `0 2 0 * * *` | 6-field cron: 02:00:00 daily (node-cron seconds syntax) | attendanceAutoClose.job | `controllers/attandance/attendanceAutoClose.job.js` |
| `0 2 * * *` | daily at 02:00 | Runs daily to credit earned leave from qualifying attendance | `controllers/attandance/crons/leaveEarnedAccrual.cron.js` |
| `10 0 1 * *` | monthly, 1st at 00:10 | Monthly credit runs on the 1st of each month at 00:10 | `controllers/attandance/crons/leaveMonthlyAccrual.cron.js` |
| `0 1 * * *` | daily at 01:00 | Runs daily; the service is idempotent and allocates once per financial year | `controllers/attandance/crons/leaveYearlyAllocation.cron.js` |
| `*/5 * * * *` | every 5 minutes | punchAutomationCron | `controllers/attandance/crons/punchAutomationCron.js` |
| `*/5 * * * *` | every 5 minutes | salesSessionAutoPunchOutCron | `controllers/attandance/crons/salesSessionAutoPunchOutCron.js` |
| `0 2 * * *` | daily at 02:00 | compOffExpiry.cron | `cron/compOffExpiry.cron.js` |
| `* * * * *` | every minute | Run every hour (you can adjust) | `cron/fixInvalidPunch.js` |
| `0 0,4,8,12,16,20 * * *` | every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00) | markAbsent.cron | `cron/markAbsent.cron.js` |
| `*/5 * * * *` | every 5 minutes | markpunchout.cron | `cron/markpunchout.cron.js` |
| `58 23 * * *` | daily at 23:58 | subscription | `cron/subscription.js` |
| `*/5 * * * *` | every 5 minutes | Auto-stop forgotten sessions - every 5 minutes | `cron/taskScheduler.cron.js` |
| `0 * * * *` | hourly, on the hour | Send due soon notifications - every hour | `cron/taskScheduler.cron.js` |
| `0 */2 * * *` | every 2 hours | Send overdue notifications - every 2 hours | `cron/taskScheduler.cron.js` |
| `5 0 * * *` | daily at 00:05 | Run daily at 12:05 AM | `models/Attandance/Holiydaycron.js` |
| `0 8 * * *` | daily at 08:00 | subscriptionReminder | `src/notification/scheduler/subscriptionReminder.js` |

### BullMQ queues

| Queue | Purpose |
|---|---|
| `notificationQueue` | system queue |
| `reportQueue` | system queue |
| `schedulerQueue` | system queue |
| `retryQueue` | system queue |
| `deadLetterQueue` | system queue |
| `email_critical` | priority tier queue |
| `email_high` | priority tier queue |
| `email_normal` | priority tier queue |
| `email_low` | priority tier queue |
| `email_bulk` | priority tier queue |
| `whatsapp_critical` | priority tier queue |
| `whatsapp_high` | priority tier queue |
| `whatsapp_normal` | priority tier queue |
| `whatsapp_low` | priority tier queue |
| `whatsapp_bulk` | priority tier queue |
| `push_critical` | priority tier queue |
| `push_high` | priority tier queue |
| `push_normal` | priority tier queue |
| `push_low` | priority tier queue |
| `push_bulk` | priority tier queue |

### BullMQ workers

| Worker | Queue | File |
|---|---|---|
| `deadLetterWorker` | `deadLetterQueue` | `src/notification/workers/deadLetterWorker.js` |
| `emailTierWorker` | `email_<tier>` | `src/notification/workers/emailTierWorker.js` |
| `pushTierWorker` | `push_<tier>` | `src/notification/workers/pushTierWorker.js` |
| `retryWorker` | `retryQueue` | `src/notification/workers/retryWorker.js` |
| `schedulerWorker` | `schedulerQueue` | `src/notification/workers/schedulerWorker.js` |
| `whatsappTierWorker` | `whatsapp_<tier>` | `src/notification/workers/whatsappTierWorker.js` |
<!-- AUTO:END:cron -->

---

## Job behaviour notes

### Attendance auto-close
Runs at 02:00 daily (6-field expression `0 2 0 * * *`). Closes attendance records that were
never punched out. There is a commented-out every-minute variant used for testing.

### Mark absent
Runs six times a day (`0 0,4,8,12,16,20 * * *`) so late timezones and delayed check-ins are
caught. Creates absent records for employees with no attendance on a working day.

### Subscription billing
Runs at 23:58 daily. Acquires a Redis lock (`src/notification/utils/redisLock.js`) so only one
instance processes expiries/billing, then expires or renews subscriptions.

### Leave accrual
- Monthly: 1st of month at 00:10.
- Yearly allocation: daily at 01:00 (allocates the new year's entitlement when it becomes due).
- Earned accrual: daily at 02:00.

Each runs per company and is expected to be idempotent; ledger entries are appended rather than
mutated.

### Task schedulers
- Every 5 minutes: auto-stop work sessions that were forgotten.
- Hourly: due-soon notifications.
- Every 2 hours: overdue task notifications.

### Comp-off expiry
Daily at 02:00, expires comp-off credits past their validity window.

### Notifications
Subscription reminders are added to BullMQ `scheduler` with a delay and a Redis dedup key, not
run by node-cron directly (the cron only performs the daily scan).

---

## Operational notes

- BullMQ workers are only started if `connectRedis()` succeeded.
- If a job throws, the error is logged through `notificationLogger` / Winston; node-cron will
  run the job again on the next tick (no retry within the tick).
- Redis locks protect the jobs that must not double-run across instances.
- Stale jobs and queue stats are exposed via `/api/admin/notifications` (see the API reference).

> Put notes **outside** the AUTO markers above.
