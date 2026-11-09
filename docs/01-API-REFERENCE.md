# API Reference

All HTTP endpoints exposed by `server.js`, grouped by mount point. The table below is generated
from the routers themselves, so it always matches the code.

**Reading the table**

| Column | Meaning |
|---|---|
| Method | HTTP verb |
| Path | Fully mounted path (`server.js` prefix + router path) |
| Auth | `JWT` = bearer token required, `Optional JWT` = token used if present, `—` = none detected |
| Permission | Key(s) passed to `checkPermission(...)`; `—` when no permission gate is used |
| Middleware | Middleware executed before the handler (auth is listed here too) |
| Handler | Controller function name |
| Purpose | Leading line of the route's JSDoc, or the handler name humanised |

> Route ordering matters in Express. Where two routes could match the same URL, the earlier
> registration wins — the generated table is sorted alphabetically for reading, **not** in
> registration order.

## Mount points

These are the prefixes registered in `server.js`:

| Prefix | Router file | Domain |
|---|---|---|
| `/api/auth` | `routes/authRoutes.js` | Login, OTP, registration, Google OAuth |
| `/api/usermanagement` | `routes/userManagementRoutes.js` | User CRUD / admin management |
| `/api/employee` | `routes/Attandance/Employee.route.js` | Employee records |
| `/api/attendance` | `routes/Attandance/Attandance.js` | Punch in/out, monthly/daily attendance, exports |
| `/api/attendance/requests` | `routes/Attandance/Request.js` | Leave / attendance requests and approvals |
| `/api/attendance/report` | `routes/Attandance/attendanceReportRoutes.js` | Attendance reporting |
| `/api/today/pi` | `routes/Attandance/todayAttendanceRoutes.js` | Today's punch status |
| `/api/ExportRoutes` | `routes/Attandance/Export/attendanceRoutes.js` | Attendance export jobs |
| `/api/leave` | `routes/Attandance/LeaveRule.routes.js` | Leave policies, balances, ledger |
| `/api/holiday` | `routes/Attandance/Holiday.js` | Holiday calendar |
| `/api/shift` | `routes/Attandance/Shift.js` | Shift definitions |
| `/api/break` | `routes/Attandance/BreakRoute.js` | Break / lunch tracking |
| `/api/v1/payrollroutes` | `routes/Attandance/payrollRoutes.js` | Payroll runs and payslips |
| `/api/v1/payrollrule`, `/api/v1/salaryrules` | `routes/PayrollRule.js`, `routes/salaryRuleRoutes.js` | Payroll / salary rules |
| `/api/v1/SalesRoute` | `routes/Attandance/Sales/Sales.routes.js` | Sales sessions |
| `/api/v1/sales/reports`, `/api/v1/sales-any`, `/api/salesR` | `routes/Attandance/Sales/*` | Sales reporting |
| `/api/v1/bulk/upload/SalesRoute` | `routes/Attandance/bulkUploadSalesSessions.js` | Bulk sales session upload |
| `/api/v1/tasks` | `routes/tasks/index.js` | Tasks, assignments, comments, workflow, work sessions |
| `/api/plan`, `/api/payment`, `/api/subscriptionsdata`, `/api/billedDate` | see table | Subscription lifecycle |
| `/api/face`, `/api/face-attendance` | `routes/face/index.js`, `routes/faceAttendance.routes.js` | Face training / recognition / attendance |
| `/api/audit` | `routes/Audit/audit.routes.js` | Audit investigation (see `AUDIT_API.md`) |
| `/api/admin/company`, `/api/admin/bulk` | `routes/Admin/*` | Company admin and bulk creation |
| `/api/admin-dashboard`, `/api/dashboard` | `routes/AdminDashboard/*`, `routes/Dasboard/dashboard.js` | Dashboards |
| `/api/admin/notifications` | `src/notification/routes/adminNotificationRoutes.js` | Notification admin |
| `/api/v1/blogPost`, `/api/v1/categoryblog` | `routes/Blog/*` | Blog and categories |
| `/api/v1/slab` | `routes/pricingRules.js` | Slab pricing |
| `/api/v1/customorder` | `routes/orderRoutes.js` | Custom orders |
| `/api/onboarding`, `/api/patnerProfile` | `routes/onboarding.routes.js`, `routes/PatnerProfile.js` | Partner onboarding |
| `/api/appsetting` | `routes/appsetting.js` | App settings |
| `/api/permissionRoutes` | `routes/permissionRoutes.js` | Permissions |
| `/api/v1/invitations` | `routes/invitation.list.routes.js` | Invitation listing |
| `/api/v1` | `routes/tasks/userList.routes.js` | Assigned / invited user lists |

### `GET /api/today/pi/today/export`

One-day attendance export returned as an XLSX attachment. It covers **all active employees**
(no attendance record ⇒ `Absent`) with optional department filtering, and produces two sheets:
`Today Attendance` (one row per employee) and `Summary` (counts plus a department breakdown).

| Query param | Required | Meaning |
|---|---|---|
| `department` | no | Exact `jobInfo.department`; omit to include every department |
| `date` | no | `YYYY-MM-DD`; defaults to today in IST |
| `employeeType` | no | `non_sales`, `sales` or `pro_sales` |
| `companyId` | no | Honored only for `super_admin` / `partner`; every other user is locked to their JWT `companyId` |

Requires the `attendance.export` permission (bypassed by employee roles `super_admin`, `admin`
and `partner`). Response filename: `attendance_today[_<department>]_<YYYY-MM-DD>.xlsx`.

---

<!-- AUTO:START:api -->
**Total endpoints: 405** — generated from `server.js` mounts and `routes/**/*.js`.

### `/api/admin`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/admin/bulk/bulk-create` | — | `employees.bulk_create` | checkPermission, upload | `createEmployeesFromCSV` | Create Employees From CSV |
| GET | `/api/admin/company/all-partners` | JWT | — | authMiddleware | `getAllPartners` | Get All Partners |
| GET | `/api/admin/company/attendance-dashboard` | JWT | — | authMiddleware | `getCompanyAttendanceDashboard` | Get Company Attendance Dashboard |
| GET | `/api/admin/company/employees` | JWT | — | authMiddleware | `getCompanyEmployees` | Get Company Employees |
| GET | `/api/admin/company/report` | JWT | — | authMiddleware, isSuperAdmin | `getCompaniesReport` | Get Companies Report |
| GET | `/api/admin/company/report/export/csv` | JWT | — | authMiddleware, isSuperAdmin | `exportCompaniesReportCSV` | Export Companies Report CSV |
| GET | `/api/admin/company/report/export/excel` | JWT | — | authMiddleware, isSuperAdmin | `exportCompaniesReportExcel` | Export Companies Report Excel |
| GET | `/api/admin/company/today-attendance` | JWT | — | authMiddleware | `getTodayAllCompaniesAttendance` | Get Today All Companies Attendance |
| GET | `/api/admin/notifications/channels` | — | — | requireAdmin | `<inline handler>` | Channels |
| POST | `/api/admin/notifications/channels/:channel/:action` | — | — | requireAdmin | `<inline handler>` | :action |
| GET | `/api/admin/notifications/circuit-breaker` | — | — | requireAdmin | `<inline handler>` | Circuit breaker |
| GET | `/api/admin/notifications/dead` | — | — | requireAdmin | `<inline handler>` | Dead |
| GET | `/api/admin/notifications/failed` | — | — | requireAdmin | `<inline handler>` | Failed |
| GET | `/api/admin/notifications/priority` | — | — | requireAdmin | `<inline handler>` | Priority |
| GET | `/api/admin/notifications/queue/:queueName` | — | — | requireAdmin | `<inline handler>` | :queue Name |
| POST | `/api/admin/notifications/retry/:deadLetterId` | — | — | requireAdmin | `<inline handler>` | :dead Letter Id |
| GET | `/api/admin/notifications/stats` | — | — | requireAdmin | `<inline handler>` | Stats |

### `/api/admin-dashboard`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/admin-dashboard/stats` | JWT | — | authMiddleware | `getAdminDashboardStats` | Get Admin Dashboard Stats |

### `/api/advertisements`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/advertisements` | JWT | — | authMiddleware | `getAllAdvertisements` | Get All Advertisements |
| POST | `/api/advertisements` | JWT | `notice.create` | authMiddleware, upload, checkPermission | `createAdvertisement` | Create Advertisement |
| DELETE | `/api/advertisements/:id` | JWT | `notice.delete` | authMiddleware, checkPermission | `deleteAdvertisement` | Delete Advertisement |
| GET | `/api/advertisements/:id` | — | — | — | `getAdvertisementById` | Get Advertisement By Id |
| PUT | `/api/advertisements/:id` | JWT | `notice.update` | authMiddleware, upload, checkPermission | `updateAdvertisement` | Update Advertisement |
| PATCH | `/api/advertisements/:id/toggle-status` | JWT | `notice.update` | authMiddleware, checkPermission | `toggleAdvertisementStatus` | Toggle Advertisement Status |
| GET | `/api/advertisements/active` | — | — | — | `getActiveAdvertisements` | Get Active Advertisements |
| DELETE | `/api/advertisements/bulk/delete` | JWT | `notice.delete` | authMiddleware, checkPermission | `bulkDeleteAdvertisements` | Bulk Delete Advertisements |
| PATCH | `/api/advertisements/bulk/status` | JWT | `notice.update` | authMiddleware, checkPermission | `bulkUpdateStatus` | Bulk Update Status |
| GET | `/api/advertisements/category/:categoryId` | — | — | — | `getAdvertisementsByCategory` | Get Advertisements By Category |
| POST | `/api/advertisements/createAdvertisementAdmin` | JWT | — | authMiddleware, upload | `createAdvertisementAdmin` | Create Advertisement Admin |
| GET | `/api/advertisements/getAllAdminAdvertisements` | — | — | — | `getAllAdminAdvertisements` | Get All Admin Advertisements |
| GET | `/api/advertisements/getWithEmpAdvertisementsByCategory/:categoryId` | — | — | — | `getWithEmpAdvertisementsByCategory` | Get With Emp Advertisements By Category |
| PUT | `/api/advertisements/updateAdvertisementadmin/:id` | JWT | — | authMiddleware, upload | `updateAdvertisementadmin` | Update Advertisementadmin |

### `/api/appsetting`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/appsetting/create` | — | — | — | `createAppSettings` | Create App Settings |
| DELETE | `/api/appsetting/delete` | — | — | — | `deleteAppSettings` | Delete App Settings |
| GET | `/api/appsetting/get` | — | — | — | `getAppSettings` | Get App Settings |
| PUT | `/api/appsetting/update` | — | — | — | `updateAppSettings` | Update App Settings |

### `/api/attendance`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/attendance/company-today` | JWT | `attendance_today.read` | authMiddleware, checkPermission | `getCompanyTodayAttendance` | Get Company Today Attendance |
| GET | `/api/attendance/daily` | JWT | — | authMiddleware | `getDailyAttendance` | Get Daily Attendance |
| GET | `/api/attendance/debugAttendanceData` | JWT | — | authMiddleware | `debugAttendanceData` | Debug Attendance Data |
| GET | `/api/attendance/employee-monthly-cards` | JWT | `employee.list` | authMiddleware, checkPermission | `getEmployeeSimpleMonthlySummary` | Get Employee Simple Monthly Summary |
| GET | `/api/attendance/employee-summary` | JWT | — | authMiddleware | `getEmployeeAttendanceSummary` | Get Employee Attendance Summary |
| GET | `/api/attendance/export` | JWT | — | authMiddleware | `exportAttendanceCSV` | Export Attendance CSV |
| GET | `/api/attendance/exportAttendanceAsCSV` | JWT | — | authMiddleware | `exportAttendanceAsCSV` | Export Attendance As CSV |
| GET | `/api/attendance/exportAttendanceAsExcel` | JWT | — | authMiddleware | `exportAttendanceAsExcel` | Export Attendance As Excel |
| GET | `/api/attendance/exportCompanyAttendanceToExcel` | JWT | — | authMiddleware | `exportCompanyAttendanceToExcel` | Export Company Attendance To Excel |
| GET | `/api/attendance/getAttendanceExport` | JWT | — | authMiddleware | `getAttendanceExport` | Get Attendance Export |
| GET | `/api/attendance/getAttendanceSummary/:companyId` | JWT | `attendance_summary.read` | authMiddleware, checkPermission | `getAttendanceSummary` | Get Attendance Summary |
| GET | `/api/attendance/getTodayPunchStatus` | JWT | — | authMiddleware | `getTodayPunchStatus` | Get Today Punch Status |
| GET | `/api/attendance/getTodaySummary` | JWT | — | authMiddleware | `getTodaySummary` | Get Today Summary |
| POST | `/api/attendance/mark` | JWT | — | authMiddleware | `markAttendance` | Mark Attendance |
| GET | `/api/attendance/monthly` | JWT | — | authMiddleware | `getAttendance` | Get Attendance |
| GET | `/api/attendance/range` | JWT | — | authMiddleware | `getRangeSummary` | Get Range Summary |
| GET | `/api/attendance/report/chart` | JWT | — | authMiddleware | `AttendanceReportController.getDashboardChart` | Attendance Report Controller.get Dashboard Chart |
| GET | `/api/attendance/report/daily-breakdown` | JWT | — | authMiddleware | `AttendanceReportController.getDailyBreakdown` | Attendance Report Controller.get Daily Breakdown |
| GET | `/api/attendance/report/export` | JWT | — | authMiddleware | `AttendanceReportController.exportReport` | Attendance Report Controller.export Report |
| GET | `/api/attendance/report/monthly` | JWT | — | authMiddleware | `AttendanceReportController.getMonthlyReport` | Attendance Report Controller.get Monthly Report |
| GET | `/api/attendance/report/trend` | JWT | — | authMiddleware | `AttendanceReportController.getMonthlyTrend` | Attendance Report Controller.get Monthly Trend |
| GET | `/api/attendance/requests` | Optional JWT | — | optionalAuth | `getAttendanceRequests` | Get Attendance Requests |
| POST | `/api/attendance/requests` | Optional JWT | — | optionalAuth | `createAttendanceRequest` | Create Attendance Request |
| GET | `/api/attendance/requests/:requestId` | Optional JWT | — | optionalAuth | `getAttendanceRequestById` | Get Attendance Request By Id |
| PUT | `/api/attendance/requests/:requestId/approve` | Optional JWT | `request.update` | optionalAuth, checkPermission | `approveAttendanceRequest` | Approve Attendance Request |
| PUT | `/api/attendance/requests/:requestId/cancel/:companyId` | Optional JWT | — | optionalAuth | `cancelAttendanceRequest` | Cancel Attendance Request |
| PUT | `/api/attendance/requests/:requestId/reject` | Optional JWT | `request.update` | optionalAuth, checkPermission | `rejectAttendanceRequest` | Reject Attendance Request |
| PUT | `/api/attendance/requests/:requestId/update/:companyId` | Optional JWT | — | optionalAuth | `updateAttendanceRequest` | Update Attendance Request |
| POST | `/api/attendance/requests/bulk-approve` | Optional JWT | `request.update` | optionalAuth, checkPermission | `bulkApproveRequests` | Bulk Approve Requests |
| GET | `/api/attendance/requests/statistics` | Optional JWT | — | optionalAuth | `getRequestStatistics` | Get Request Statistics |
| GET | `/api/attendance/summary` | JWT | — | authMiddleware | `getMonthlySummary` | Get Monthly Summary |
| GET | `/api/attendance/today` | JWT | — | authMiddleware | `getTodayAttendance` | Get Today Attendance |

### `/api/audit`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/audit` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getAllAuditLogs` | Get All Audit Logs |
| GET | `/api/audit/:eventId` | JWT | `audit.read_detail` | authMiddleware, requireAuditPermission | `getAuditLogByEventId` | Get Audit Log By Event Id |
| POST | `/api/audit/:eventId/deactivate` | JWT | `audit.deactivate` | authMiddleware, requireAuditPermission | `deactivateAuditEvent` | Deactivate Audit Event |
| GET | `/api/audit/dashboard` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getAuditDashboard` | Get Audit Dashboard |
| GET | `/api/audit/export` | JWT | `audit.export` | authMiddleware, requireAuditPermission | `exportAuditLogs` | Export Audit Logs |
| GET | `/api/audit/logs` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getAllAuditLogs` | Get All Audit Logs |
| GET | `/api/audit/resource/:resource/:resourceId` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getResourceHistory` | Get Resource History |
| GET | `/api/audit/stats` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getAuditLogStats` | Get Audit Log Stats |
| GET | `/api/audit/summary` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getAuditLogStats` | Get Audit Log Stats |
| GET | `/api/audit/suspicious` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getSuspiciousActivity` | Get Suspicious Activity |
| GET | `/api/audit/user/:userId` | JWT | `audit.read` | authMiddleware, requireAuditPermission | `getUserActivity` | Get User Activity |
| GET | `/api/audit/verify-chain` | JWT | `audit.verify` | authMiddleware, requireAuditPermission | `verifyChain` | Verify Chain |

### `/api/auth`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/auth/completeAdminOtp` | — | — | — | `completeAdminOtp` | Complete Admin Otp |
| POST | `/api/auth/completeProfile` | JWT | — | authMiddleware, upload | `completeProfile` | Complete Profile |
| POST | `/api/auth/completOtp` | — | — | — | `completOtp` | Complet Otp |
| DELETE | `/api/auth/deleteUser` | JWT | — | authMiddleware | `deleteUser` | Delete User |
| DELETE | `/api/auth/device-token` | JWT | — | authMiddleware | `removeDeviceToken` | Remove Device Token |
| POST | `/api/auth/device-token` | JWT | — | authMiddleware | `syncDeviceToken` | Sync Device Token |
| GET | `/api/auth/exportUsersByLocation` | — | — | — | `exportUsersByLocation` | Export Users By Location |
| POST | `/api/auth/find-by-phone` | — | — | — | `findUserByPhone` | Find User By Phone |
| GET | `/api/auth/findUserByReferralOwner/:code` | JWT | — | authMiddleware | `findUserByReferralOwner` | Find User By Referral Owner |
| GET | `/api/auth/generateTheQRCode` | JWT | — | authMiddleware | `generateTheQRCode` | Generate The QRCode |
| GET | `/api/auth/getAllUsersSuperadmin` | JWT | — | authMiddleware | `getAllUsersSuperadmin` | Get All Users Superadmin |
| GET | `/api/auth/getDeletionStatus` | JWT | — | authMiddleware | `getDeletionStatus` | Get Deletion Status |
| GET | `/api/auth/getOwner/:ownerId` | JWT | — | authMiddleware | `getOwner` | Get Owner |
| GET | `/api/auth/getProfile` | JWT | — | authMiddleware | `getProfile` | Get Profile |
| GET | `/api/auth/getuserbyreferal` | — | — | — | `getUserIdsAndNamesByReferralCodesController` | Get User Ids And Names By Referral Codes Controller |
| GET | `/api/auth/getUserProfile` | JWT | — | authMiddleware | `getUserProfile` | Get User Profile |
| POST | `/api/auth/loginUserSuperadmin` | JWT | — | authMiddleware | `loginUserSuperadmin` | Login User Superadmin |
| POST | `/api/auth/manul/createOrUpdateEmployee` | JWT | — | authMiddleware, checkLimit | `createOrUpdateEmployee` | Create Or Update Employee |
| GET | `/api/auth/manul/getAllEmployees` | JWT | — | authMiddleware | `getAllEmployees` | Get All Employees |
| GET | `/api/auth/manul/getEmployeeById/:employeeId` | JWT | — | authMiddleware | `getEmployeeById` | Get Employee By Id |
| POST | `/api/auth/oauthAuthController` | JWT | — | — | `oauthAuthController` | Oauth Auth Controller |
| GET | `/api/auth/profile-data` | JWT | — | authMiddleware | `getProfileData` | Get Profile Data |
| GET | `/api/auth/profile-image-url` | JWT | — | authMiddleware, profileUploadMiddleware | `getProfileImageUrl` | Get Profile Image Url |
| POST | `/api/auth/requestAccountDeletion` | JWT | — | authMiddleware | `requestAccountDeletion` | Request Account Deletion |
| POST | `/api/auth/resendOtp` | — | — | — | `resendOtp` | Resend Otp |
| POST | `/api/auth/restoreAccount` | JWT | — | authMiddleware | `restoreAccount` | Restore Account |
| POST | `/api/auth/signout` | — | — | — | `signout` | Signout |
| POST | `/api/auth/startAdminAuth` | JWT | — | — | `startAdminAuth` | Start Admin Auth |
| POST | `/api/auth/startAuth` | JWT | — | — | `startAuth` | Start Auth |
| POST | `/api/auth/test-push` | JWT | — | authMiddleware | `sendTestPushNotification` | Send Test Push Notification |
| PUT | `/api/auth/update-profile` | JWT | — | authMiddleware | `updateProfile` | Update Profile |
| POST | `/api/auth/UpdateManualAddress` | JWT | — | authMiddleware | `UpdateManualAddress` | Update Manual Address |
| POST | `/api/auth/UpdatePhone` | JWT | — | authMiddleware | `UpdatePhone` | Update Phone |
| GET | `/api/auth/updateProfileImage` | JWT | — | authMiddleware, upload | `updateProfileImage` | Update Profile Image |
| POST | `/api/auth/updateUserLocation` | JWT | — | authMiddleware | `updateUserLocation` | Update User Location |
| POST | `/api/auth/upload-profile-image` | JWT | — | authMiddleware, profileUploadMiddleware | `uploadProfileImage` | Upload Profile Image |

### `/api/billedDate`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/billedDate/bills` | JWT | — | authMiddleware | `getAllBillsWithReminderStatus` | Get All Bills With Reminder Status |
| GET | `/api/billedDate/download/:billId` | JWT | — | authMiddleware | `downloadBill` | Download Bill |
| POST | `/api/billedDate/generate-bill` | JWT | — | authMiddleware | `generateBill` | Generate Bill |
| POST | `/api/billedDate/reminders` | JWT | — | authMiddleware, <inline handler> | `sendBulkReminder` | Send Bulk Reminder |
| POST | `/api/billedDate/upload` | JWT | — | authMiddleware, upload | `uploadCSVFile` | Upload CSVFile |

### `/api/break`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/break/end` | JWT | — | authMiddleware | `endBreakController` | End Break Controller |
| POST | `/api/break/face_end` | JWT | — | authMiddleware, upload | `endFaceBreakController` | End Face Break Controller |
| POST | `/api/break/face_identify_end` | JWT | — | authMiddleware, upload | `endFaceBreakIdentifyController` | End Face Break Identify Controller |
| POST | `/api/break/face_identify_start` | JWT | — | authMiddleware, upload | `startFaceBreakIdentifyController` | Start Face Break Identify Controller |
| POST | `/api/break/face_start` | JWT | — | authMiddleware, upload | `startFaceBreakController` | Start Face Break Controller |
| GET | `/api/break/list` | JWT | — | authMiddleware | `getCompanyBreakListController` | Get Company Break List Controller |
| POST | `/api/break/start` | JWT | — | authMiddleware | `startBreakController` | Start Break Controller |

### `/api/categoryAdvertisment`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/categoryAdvertisment` | — | — | — | `getAllCategories` | Get All Categories |
| POST | `/api/categoryAdvertisment` | JWT | — | authMiddleware | `createCategory` | Create Category |
| DELETE | `/api/categoryAdvertisment/:id` | JWT | — | authMiddleware | `deleteCategory` | Delete Category |
| GET | `/api/categoryAdvertisment/:id` | — | — | — | `getCategoryById` | Get Category By Id |
| PUT | `/api/categoryAdvertisment/:id` | JWT | — | authMiddleware | `updateCategory` | Update Category |
| PATCH | `/api/categoryAdvertisment/:id/toggle-status` | JWT | — | authMiddleware | `toggleCategoryStatus` | Toggle Category Status |
| GET | `/api/categoryAdvertisment/active` | — | — | — | `getActiveCategories` | Get Active Categories |

### `/api/dashboard`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/dashboard/getDashboardCompanyMonthlyAttendance` | JWT | `attendance_summary.read` | authMiddleware, checkPermission | `getDashboardCompanyMonthlyAttendance` | Get Dashboard Company Monthly Attendance |

### `/api/employee`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/employee` | JWT | — | authMiddleware | `getAllEmployees` | Get All Employees |
| GET | `/api/employee` | JWT | `employee.list` | authMiddleware, checkPermission | `getAllEmployees` | Get All Employees |
| POST | `/api/employee` | JWT | `employee.create` | authMiddleware, checkSubscription, checkFeature, checkPermission | `createEmployee` | Create Employee |
| GET | `/api/employee/:empId` | JWT | — | authMiddleware | `getEmpDetails` | Get Emp Details |
| PUT | `/api/employee/activateEmployee/:empId` | JWT | — | authMiddleware | `activateEmployee` | Activate Employee |
| POST | `/api/employee/changeEmployeeRole/:empId` | JWT | — | authMiddleware | `changeEmployeeRole` | Change Employee Role |
| GET | `/api/employee/checkEmpButton` | JWT | — | authMiddleware | `checkEmpButton` | Check Emp Button |
| DELETE | `/api/employee/delteEmployee/:empId` | JWT | `employee.delete` | authMiddleware, checkPermission | `deactivateEmployee` | Deactivate Employee |
| GET | `/api/employee/download-deduction-template` | JWT | — | authMiddleware | `downloadDeductionTemplate` | Download Deduction Template |
| POST | `/api/employee/find-by-phone-employee` | JWT | — | authMiddleware | `findbyPhone` | Findby Phone |
| POST | `/api/employee/find-by-Referral-Code` | JWT | — | authMiddleware | `findbyReferralCode` | Findby Referral Code |
| GET | `/api/employee/getCompanyByUser/:userType` | JWT | — | authMiddleware | `getCompanyByUser` | Get Company By User |
| GET | `/api/employee/getEmployees` | JWT | — | authMiddleware | `getEmployees` | Get Employees |
| GET | `/api/employee/getPayslipAllDownloadStatus` | JWT | — | authMiddleware | `getPayslipAllDownloadStatus` | Get Payslip All Download Status |
| GET | `/api/employee/getPayslipDownloadStatus` | JWT | — | authMiddleware | `getPayslipDownloadStatus` | Get Payslip Download Status |
| GET | `/api/employee/latest-subscription` | JWT | — | authMiddleware | `getLatestSubscription` | Get Latest Subscription |
| GET | `/api/employee/me/profile` | JWT | — | authMiddleware | `getEmpByUserId` | Get Emp By User Id |
| GET | `/api/employee/sales/paginated` | JWT | — | authMiddleware | `getSalesEmployeesByCompanyPaginated` | Get Sales Employees By Company Paginated |
| PATCH | `/api/employee/togglePayslipDownloadForCompany` | JWT | — | authMiddleware | `togglePayslipDownloadForCompany` | Toggle Payslip Download For Company |
| PATCH | `/api/employee/updateEmployee/:employeeId` | JWT | `employee.update` | authMiddleware, checkPermission | `updateEmployee` | Update Employee |
| POST | `/api/employee/upload-deductions` | JWT | — | authMiddleware, upload | `uploadEmployeeDeductions` | Upload Employee Deductions |

### `/api/ExportRoutes`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/ExportRoutes/attendance/export/csv` | JWT | `attendance.export` | authMiddleware, checkPermission | `generateAttendanceCSV` | Generate Attendance CSV |
| GET | `/api/ExportRoutes/attendance/export/matrix-csv` | JWT | `attendance_matrix.export` | authMiddleware, checkPermission | `generateAttendanceMatrixCSV` | Generate Attendance Matrix CSV |
| GET | `/api/ExportRoutes/generateAttendanceSummaryCSV` | JWT | `attendance_summary.export` | authMiddleware, checkPermission | `generateAttendanceSummaryCSV` | Generate Attendance Summary CSV |
| GET | `/api/ExportRoutes/requests/export/request-report` | JWT | `request.export` | authMiddleware, checkPermission | `exportRequestReport` | Export Request Report |

### `/api/face`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/face/face/detect` | — | — | errorHandler, <inline handler> | `faceDetectionController.detectFaces` | Face Detection Controller.detect Faces |
| POST | `/api/face/face/detect/batch` | — | — | errorHandler, <inline handler> | `faceDetectionController.batchDetect` | Face Detection Controller.batch Detect |
| POST | `/api/face/face/detect/company` | — | — | errorHandler, <inline handler> | `faceDetectionController.detectForCompany` | Face Detection Controller.detect For Company |
| POST | `/api/face/face/detect/employee` | — | — | errorHandler, <inline handler> | `faceDetectionController.detectForEmployee` | Face Detection Controller.detect For Employee |
| GET | `/api/face/face/detect/health` | — | — | errorHandler | `faceDetectionController.health` | Face Detection Controller.health |
| POST | `/api/face/face/detect/validate-enrollment` | — | — | errorHandler, <inline handler> | `faceDetectionController.validateEnrollment` | Face Detection Controller.validate Enrollment |
| GET | `/api/face/face/docs` | — | — | errorHandler | `getDocs` | Get Docs |
| GET | `/api/face/face/health` | — | — | errorHandler | `faceRecognitionController.health` | Face Recognition Controller.health |
| GET | `/api/face/face/health` | — | — | errorHandler | `getHealthStatus` | Get Health Status |
| POST | `/api/face/face/identify` | — | — | errorHandler, uploadSingle | `faceRecognitionController.identify` | Face Recognition Controller.identify |
| POST | `/api/face/face/search` | — | — | errorHandler, uploadSingle | `faceRecognitionController.search` | Face Recognition Controller.search |
| DELETE | `/api/face/face/train/all` | — | — | errorHandler | `faceTrainingController.deleteAll` | Face Training Controller.delete All |
| POST | `/api/face/face/train/batch` | — | — | errorHandler, uploadBatch | `faceTrainingController.trainBatch` | Face Training Controller.train Batch |
| DELETE | `/api/face/face/train/deleteImage` | — | — | errorHandler | `faceTrainingController.deleteImage` | Face Training Controller.delete Image |
| POST | `/api/face/face/train/single` | — | — | errorHandler, uploadSingle | `faceTrainingController.trainSingle` | Face Training Controller.train Single |
| GET | `/api/face/face/train/status/:employeeId` | — | — | errorHandler | `faceTrainingController.getStatus` | Face Training Controller.get Status |
| POST | `/api/face/face/verify` | — | — | errorHandler, uploadSingle | `faceRecognitionController.verify` | Face Recognition Controller.verify |
| POST | `/api/face/face/verify-employee` | — | — | errorHandler, uploadSingle | `faceRecognitionController.verifyEmployee` | Face Recognition Controller.verify Employee |

### `/api/face-attendance`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/face-attendance/attendance/face/identify` | JWT | — | authmiddleware, upload | `markAttendanceWithFaceIdentify` | Mark Attendance With Face Identify |
| POST | `/api/face-attendance/attendance/face/verify` | JWT | — | authmiddleware, upload | `markAttendanceWithFaceVerify` | Mark Attendance With Face Verify |

### `/api/holiday`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/holiday` | JWT | — | authMiddleware | `getAllHolidays` | Get All Holidays |
| POST | `/api/holiday` | JWT | `holiday.create` | authMiddleware, checkPermission | `createHoliday` | Create Holiday |
| DELETE | `/api/holiday/:id` | JWT | `holiday.delete` | authMiddleware, checkPermission | `deleteHoliday` | Delete Holiday |
| PUT | `/api/holiday/:id` | JWT | `holiday.update` | authMiddleware, checkPermission | `updateHoliday` | Update Holiday |
| GET | `/api/holiday/getAllEmpHolidays` | JWT | — | authMiddleware | `getAllEmpHolidays` | Get All Emp Holidays |
| GET | `/api/holiday/getHolidayById/:id` | JWT | — | authMiddleware | `getHolidayById` | Get Holiday By Id |

### `/api/leave`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/leave` | JWT | — | authMiddleware | `getLeaveTypes` | Get Leave Types |
| POST | `/api/leave` | JWT | — | authMiddleware | `createLeaveType` | Create Leave Type |
| DELETE | `/api/leave/:id` | JWT | — | authMiddleware | `deleteLeaveType` | Delete Leave Type |
| PUT | `/api/leave/:id` | JWT | — | authMiddleware | `updateLeaveType` | Update Leave Type |
| POST | `/api/leave/balances/:employeeId/adjust` | JWT | `balance.adjust` | authMiddleware, checkPermission | `<inline handler>` | Adjust |
| GET | `/api/leave/balances/me` | JWT | — | authMiddleware | `<inline handler>` | Me |
| GET | `/api/leave/policies` | JWT | — | authMiddleware | `getLeavePolicies` | Get Leave Policies |
| POST | `/api/leave/policies` | JWT | `policy.create` | authMiddleware, checkPermission | `createLeavePolicy` | Create Leave Policy |
| DELETE | `/api/leave/policies/:id` | JWT | `policy.delete` | authMiddleware, checkPermission | `deleteLeavePolicy` | Delete Leave Policy |
| PUT | `/api/leave/policies/:id` | JWT | `policy.update` | authMiddleware, checkPermission | `updateLeavePolicy` | Update Leave Policy |
| POST | `/api/leave/policies/:id/assign` | JWT | `policy.assign` | authMiddleware, checkPermission | `assignPolicyToEmployee` | Assign Policy To Employee |
| GET | `/api/leave/policies/:id/resolved` | JWT | `policy.read` | authMiddleware, checkPermission | `getLeavePolicyResolved` | Get Leave Policy Resolved |

### `/api/onboarding`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/onboarding/create` | — | — | — | `createOnboarding` | Create Onboarding |
| POST | `/api/onboarding/createLead` | — | — | — | `createLead` | Create Lead |
| GET | `/api/onboarding/getByPhone/:phone` | — | — | — | `getOnboardingdatabyPhone` | Get Onboardingdataby Phone |

### `/api/patnerProfile`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/patnerProfile` | JWT | — | upload, authMiddleware | `createOrUpdateProfile` | Create Or Update Profile |
| GET | `/api/patnerProfile/:userId` | — | — | — | `getProfile` | Get Profile |
| PUT | `/api/patnerProfile/media` | JWT | — | authMiddleware, upload | `updateProfileMedia` | Update Profile Media |

### `/api/payment`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/payment/active` | JWT | — | authMiddleware | `getActiveSubscription` | Get Active Subscription |
| GET | `/api/payment/admin/all` | JWT | — | authMiddleware | `getPaymentHistory` | Get Payment History |
| POST | `/api/payment/cancel` | JWT | — | authMiddleware | `cancelSubscription` | Cancel Subscription |
| POST | `/api/payment/create-order` | JWT | `payment.create` | authMiddleware, checkPermission | `createOrder` | Create Order |
| POST | `/api/payment/create-upgrade-order` | JWT | `payment.update` | authMiddleware, checkPermission | `createUpgradeOrder` | Create Upgrade Order |
| POST | `/api/payment/createSubscriptionManual` | JWT | — | authMiddleware | `createSubscriptionManual` | Create Subscription Manual |
| GET | `/api/payment/history` | JWT | — | authMiddleware | `getPaymentHistory` | Get Payment History |
| POST | `/api/payment/initialize-free` | JWT | — | authMiddleware | `initializeFreePlan` | Initialize Free Plan |
| GET | `/api/payment/upgrade-history` | JWT | — | authMiddleware | `getUpgradeHistory` | Get Upgrade History |
| POST | `/api/payment/verify` | JWT | — | authMiddleware | `verifyPayment` | Verify Payment |
| POST | `/api/payment/verify-upgrade` | JWT | — | authMiddleware, verifyUpgradePayment | `—` | Verify upgrade |

### `/api/permissionRoutes`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/permissionRoutes` | JWT | `permission.read` | authMiddleware, checkPermission | `getAllPermissions` | Get All Permissions |
| POST | `/api/permissionRoutes` | JWT | `permission.create` | authMiddleware, checkPermission | `createPermission` | Create Permission |
| DELETE | `/api/permissionRoutes/:id` | JWT | `permission.delete` | authMiddleware, checkPermission | `deletePermission` | Delete Permission |
| PUT | `/api/permissionRoutes/:id` | JWT | `permission.update` | authMiddleware, checkPermission | `updatePermission` | Update Permission |
| POST | `/api/permissionRoutes/assign` | JWT | `permission.assign` | authMiddleware, checkPermission | `assignPermission` | Assign Permission |
| GET | `/api/permissionRoutes/getUserPermissions` | JWT | — | authMiddleware | `getUserPermissions` | Get User Permissions |
| POST | `/api/permissionRoutes/remove` | JWT | `permission.assign` | authMiddleware, checkPermission | `removePermission` | Remove Permission |

### `/api/plan`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/plan` | — | — | — | `getAllPlans` | Get All Plans |
| POST | `/api/plan` | JWT | `plans.create` | authMiddleware, checkPermission | `createPlan` | Create Plan |
| DELETE | `/api/plan/:id` | JWT | `plans.delete` | authMiddleware, checkPermission | `deletePlan` | Delete Plan |
| GET | `/api/plan/:id` | — | — | — | `getPlanById` | Get Plan By Id |
| PUT | `/api/plan/:id` | JWT | `plans.update` | authMiddleware, checkPermission | `updatePlan` | Update Plan |
| PATCH | `/api/plan/auto-checkout/:planId` | JWT | `plans.update` | authMiddleware, checkPermission | `toggleAutoCheckout` | Toggle Auto Checkout |
| GET | `/api/plan/getAlladminPlans` | — | — | — | `getAlladminPlans` | Get Alladmin Plans |
| PATCH | `/api/plan/toggle/:id` | JWT | `plans.update` | authMiddleware, checkPermission | `togglePlanStatus` | Toggle Plan Status |

### `/api/salesR`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/salesR/BulkAssignSales` | JWT | — | authMiddleware | `BulkAssignSales` | Bulk Assign Sales |
| GET | `/api/salesR/company/:companyId/records` | JWT | — | authMiddleware | `getCompanySalesRecords` | Get Company Sales Records |
| GET | `/api/salesR/company/:companyId/salesperson/:salesPersonId` | JWT | — | authMiddleware | `getSalesBySalesPerson` | Get Sales By Sales Person |
| GET | `/api/salesR/company/:companyId/summary` | JWT | — | authMiddleware | `getCompanySalesSummary` | Get Company Sales Summary |

### `/api/shift`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/shift` | JWT | `shift.read` | authMiddleware, checkPermission | `getAllShifts` | Get All Shifts |
| POST | `/api/shift` | JWT | `shift.create` | authMiddleware, checkPermission | `createShift` | Create Shift |
| DELETE | `/api/shift/:id` | JWT | `shift.delete` | authMiddleware, checkPermission | `deleteShift` | Delete Shift |
| PATCH | `/api/shift/:id/toggle-night` | JWT | `shift.update` | authMiddleware, checkPermission | `toggleNightShift` | Toggle Night Shift |
| PATCH | `/api/shift/:id/toggle-overtime` | JWT | `shift.update` | authMiddleware, checkPermission | `toggleOvertime` | Toggle Overtime |
| PATCH | `/api/shift/:id/toggle-weekly-off` | JWT | — | authMiddleware | `toggleWeeklyOff` | Toggle Weekly Off |
| PUT | `/api/shift/updateShift/:id` | JWT | `shift.update` | authMiddleware, checkPermission | `updateShift` | Update Shift |

### `/api/subscriptionsdata`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/subscriptionsdata/admin/getCurrentActiveSubscription` | JWT | — | authMiddleware | `getCurrentActiveSubscription` | Get Current Active Subscription |
| GET | `/api/subscriptionsdata/admin/getSubscriptionHistory` | JWT | — | authMiddleware | `getSubscriptionHistory` | Get Subscription History |
| GET | `/api/subscriptionsdata/admin/subscriptions` | JWT | — | authMiddleware | `getAllSubscriptions` | Get All Subscriptions |
| GET | `/api/subscriptionsdata/admin/subscriptions/export` | JWT | — | authMiddleware | `exportSubscriptions` | Export Subscriptions |

### `/api/today`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/today/pi/date-range/dashboard` | JWT | — | authMiddleware | `TodayAttendanceController.getDateRangeDashboard` | Today Attendance Controller.get Date Range Dashboard |
| GET | `/api/today/pi/today/by-department` | JWT | — | authMiddleware | `TodayAttendanceController.getAttendanceByDepartment` | Today Attendance Controller.get Attendance By Department |
| GET | `/api/today/pi/today/dashboard` | JWT | — | authMiddleware | `TodayAttendanceController.getTodayDashboard` | Today Attendance Controller.get Today Dashboard |
| GET | `/api/today/pi/today/departments` | JWT | — | authMiddleware | `TodayAttendanceController.getDepartmentList` | Today Attendance Controller.get Department List |
| GET | `/api/today/pi/today/employee/:employeeId` | JWT | — | authMiddleware | `TodayAttendanceController.getEmployeeTodayAttendance` | Today Attendance Controller.get Employee Today Attendance |
| GET | `/api/today/pi/today/export` | JWT | `attendance.export` | authMiddleware, checkPermission | `TodayAttendanceController.exportTodayAttendance` | Today Attendance Controller.export Today Attendance |

### `/api/usermanagement`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/usermanagement` | — | — | — | `getAllUsers` | Get All Users |
| POST | `/api/usermanagement` | — | — | — | `createUser` | Create User |
| GET | `/api/usermanagement/:id` | — | — | — | `getUserProfile` | Get User Profile |
| PUT | `/api/usermanagement/:id/block` | JWT | `user.update` | authMiddleware, checkPermission | `toggleUserBlock` | Toggle User Block |
| PUT | `/api/usermanagement/:id/face/disable` | JWT | `user.update` | authMiddleware, checkPermission | `disableFace` | Disable Face |
| PUT | `/api/usermanagement/:id/face/enable` | JWT | `user.update` | authMiddleware, checkPermission | `enableFace` | Enable Face |
| PUT | `/api/usermanagement/:id/qr/disable` | JWT | `user.update` | authMiddleware, checkPermission | `disableQr` | Disable Qr |
| PUT | `/api/usermanagement/:id/qr/enable` | JWT | `user.update` | authMiddleware, checkPermission | `enableQr` | Enable Qr |
| PUT | `/api/usermanagement/:id/role` | JWT | `user.update` | authMiddleware, checkPermission | `changeUserRole` | Change User Role |
| GET | `/api/usermanagement/analytics` | — | — | — | `getUserAnalytics` | Get User Analytics |
| GET | `/api/usermanagement/export` | JWT | `user.export` | authMiddleware, checkPermission | `exportUsers` | Export Users |
| GET | `/api/usermanagement/getFeatureStatus/:id` | JWT | — | authMiddleware | `getFeatureStatus` | Get Feature Status |
| GET | `/api/usermanagement/getme` | JWT | — | authMiddleware | `getme` | Getme |

### `/api/v1/blogPost`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/blogPost` | — | — | — | `getAllBlogs` | Get All Blogs |
| POST | `/api/v1/blogPost` | JWT | — | authMiddleware, blogUploadFields | `createBlog` | Create Blog |
| DELETE | `/api/v1/blogPost/:id` | JWT | — | authMiddleware | `deleteBlog` | Delete Blog |
| GET | `/api/v1/blogPost/:id` | — | — | — | `getBlogById` | Get Blog By Id |
| PUT | `/api/v1/blogPost/:id` | JWT | — | authMiddleware, blogUploadFields | `updateBlog` | Update Blog |
| POST | `/api/v1/blogPost/:id/bookmark` | JWT | — | authMiddleware | `toggleBookmark` | Toggle Bookmark |
| POST | `/api/v1/blogPost/:id/comment` | JWT | — | authMiddleware | `addComment` | Add Comment |
| POST | `/api/v1/blogPost/:id/like` | JWT | — | authMiddleware | `toggleLike` | Toggle Like |
| POST | `/api/v1/blogPost/:id/rate` | JWT | — | authMiddleware | `rateBlog` | Rate Blog |
| GET | `/api/v1/blogPost/slug/:slug` | — | — | — | `getBlogBySlug` | Get Blog By Slug |
| GET | `/api/v1/blogPost/stats` | — | — | — | `getBlogStats` | Get Blog Stats |

### `/api/v1/bulk`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/v1/bulk/upload/SalesRoute/bulk-upload` | JWT | — | authMiddleware, upload, handleMulterError | `bulkUploadSalesSessions` | Bulk Upload Sales Sessions |
| GET | `/api/v1/bulk/upload/SalesRoute/bulk-upload-template` | JWT | — | authMiddleware | `getBulkUploadTemplate` | Get Bulk Upload Template |
| POST | `/api/v1/bulk/upload/SalesRoute/create` | JWT | — | authMiddleware | `createSalesSession` | Create Sales Session |
| GET | `/api/v1/bulk/upload/SalesRoute/uploader-info` | JWT | — | authMiddleware | `getUploaderInfo` | Get Uploader Info |

### `/api/v1/categoryblog`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/categoryblog` | — | — | — | `getAllCategories` | Get All Categories |
| POST | `/api/v1/categoryblog` | JWT | — | authMiddleware, upload | `createCategory` | Create Category |
| DELETE | `/api/v1/categoryblog/:id` | JWT | — | authMiddleware | `deleteCategory` | Delete Category |
| GET | `/api/v1/categoryblog/:id` | — | — | — | `getCategoryById` | Get Category By Id |
| PUT | `/api/v1/categoryblog/:id` | JWT | — | authMiddleware, upload | `updateCategory` | Update Category |
| GET | `/api/v1/categoryblog/:id/blogs` | — | — | — | `getBlogsByCategory` | Get Blogs By Category |
| POST | `/api/v1/categoryblog/:id/subcategories` | JWT | — | authMiddleware | `addSubCategory` | Add Sub Category |
| GET | `/api/v1/categoryblog/slug/:slug` | — | — | — | `getCategoryBySlug` | Get Category By Slug |

### `/api/v1/customorder`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/v1/customorder/create-custom-plan` | JWT | — | authMiddleware | `createCustomPlanOrder` | Create Custom Plan Order |
| POST | `/api/v1/customorder/preview-custom-plan` | — | — | — | `previewCustomPlan` | Preview Custom Plan |
| POST | `/api/v1/customorder/verify-payment` | JWT | — | authMiddleware | `verifyPayment` | Verify Payment |

### `/api/v1/invitations`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/invitations` | JWT | — | authMiddleware | `getInvitations` | Get Invitations |

### `/api/v1/payrollroutes`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| DELETE | `/api/v1/payrollroutes/:payrollId` | JWT | — | authMiddleware, requireActiveSubscription, requirePaidPlan | `deletePayroll` | Delete Payroll |
| POST | `/api/v1/payrollroutes/:payrollId/recalculate` | JWT | — | authMiddleware | `recalculatePayroll` | Recalculate Payroll |
| PATCH | `/api/v1/payrollroutes/:payrollId/status` | JWT | — | authMiddleware | `updatePayrollStatus` | Update Payroll Status |
| GET | `/api/v1/payrollroutes/company` | JWT | — | authMiddleware | `getCompanyPayroll` | Get Company Payroll |
| DELETE | `/api/v1/payrollroutes/company/:companyId` | JWT | — | authMiddleware, requireActiveSubscription, requirePaidPlan | `deleteAllPayrollByCompany` | Delete All Payroll By Company |
| DELETE | `/api/v1/payrollroutes/company/:companyId/employee/:employeeId` | JWT | — | authMiddleware, requireActiveSubscription, requirePaidPlan | `deleteEmployeePayroll` | Delete Employee Payroll |
| GET | `/api/v1/payrollroutes/download/excel` | JWT | — | authMiddleware, requireActiveSubscription, requirePaidPlan | `downloadCompanyExcel` | Download Company Excel |
| GET | `/api/v1/payrollroutes/download/pdf/:payrollId` | JWT | — | authMiddleware, requireActiveSubscription, requirePaidPlan | `downloadSalarySlipPDF` | Download Salary Slip PDF |
| GET | `/api/v1/payrollroutes/employee/:employeeId` | JWT | — | authMiddleware | `getEmployeePayroll` | Get Employee Payroll |
| POST | `/api/v1/payrollroutes/generate` | JWT | — | authMiddleware | `generatePayroll` | Generate Payroll |
| POST | `/api/v1/payrollroutes/generate-bulk` | JWT | — | authMiddleware | `generateBulkPayroll` | Generate Bulk Payroll |
| GET | `/api/v1/payrollroutes/getAllPayrollByCompany/:companyId` | JWT | — | authMiddleware | `getAllPayrollByCompany` | Get All Payroll By Company |
| GET | `/api/v1/payrollroutes/getPayrollByEmployeeAndCompany/:companyId/employee/:employeeId` | JWT | — | authMiddleware | `getPayrollByEmployeeAndCompany` | Get Payroll By Employee And Company |
| POST | `/api/v1/payrollroutes/preview` | JWT | — | authMiddleware | `previewPayroll` | Preview Payroll |

### `/api/v1/payrollrule`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/payrollrule` | — | — | — | `getAllPayrollRules` | Get All Payroll Rules |
| POST | `/api/v1/payrollrule` | — | — | — | `createPayrollRule` | Create Payroll Rule |
| DELETE | `/api/v1/payrollrule/:id` | — | — | — | `deletePayrollRule` | Delete Payroll Rule |
| GET | `/api/v1/payrollrule/:id` | — | — | — | `getPayrollRuleById` | Get Payroll Rule By Id |
| PUT | `/api/v1/payrollrule/:id` | — | — | — | `updatePayrollRule` | Update Payroll Rule |
| PATCH | `/api/v1/payrollrule/:id/toggle-status` | — | — | — | `togglePayrollRuleStatus` | Toggle Payroll Rule Status |
| GET | `/api/v1/payrollrule/company/:companyId` | — | — | — | `getPayrollRuleByCompany` | Get Payroll Rule By Company |

### `/api/v1/salaryrules`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/salaryrules` | JWT | — | authMiddleware | `getAllSalaryRules` | Get All Salary Rules |
| POST | `/api/v1/salaryrules` | JWT | — | authMiddleware | `createSalaryRule` | Create Salary Rule |
| DELETE | `/api/v1/salaryrules/:id` | JWT | — | authMiddleware | `deleteSalaryRule` | Delete Salary Rule |
| GET | `/api/v1/salaryrules/:id` | JWT | — | authMiddleware | `getSalaryRuleById` | Get Salary Rule By Id |
| PUT | `/api/v1/salaryrules/:id` | JWT | — | authMiddleware | `updateSalaryRule` | Update Salary Rule |
| GET | `/api/v1/salaryrules/getCompanySalaryRule` | JWT | — | authMiddleware | `getCompanySalaryRule` | Get Company Salary Rule |

### `/api/v1/sales`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/sales/reports/crm` | JWT | — | authMiddleware | `exportCrmReport` | Export Crm Report |
| GET | `/api/v1/sales/reports/export` | JWT | — | authMiddleware | `exportSalesReport` | Export Sales Report |
| GET | `/api/v1/sales/reports/exportDataSalesCSV` | JWT | — | authMiddleware | `exportDataSalesCSV` | Export Data Sales CSV |
| GET | `/api/v1/sales/reports/exportSalesPersonReport` | JWT | — | authMiddleware | `exportSalesPersonReport` | Export Sales Person Report |
| GET | `/api/v1/sales/reports/sales-analytics/export` | JWT | — | authMiddleware | `exportSalesAnalyticsExcel` | Export Sales Analytics Excel |
| GET | `/api/v1/sales/reports/sales-person-exit` | JWT | — | authMiddleware | `exportSalesPersonExitReport` | Export Sales Person Exit Report |

### `/api/v1/sales-any`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/sales-any/reports/appointments-next-month` | — | — | — | `exportAppointmentsNextMonthReport` | Export Appointments Next Month Report |
| GET | `/api/v1/sales-any/reports/attendance-field-time` | — | — | — | `exportAttendanceFieldTimeReport` | Export Attendance Field Time Report |
| GET | `/api/v1/sales-any/reports/customer-type-breakdown` | — | — | — | `exportCustomerTypeBreakdownReport` | Export Customer Type Breakdown Report |
| GET | `/api/v1/sales-any/reports/employee-monthly` | — | — | — | `exportEmployeeMonthlyReport` | Export Employee Monthly Report |
| GET | `/api/v1/sales-any/reports/new-vs-repeat-customers` | — | — | — | `exportNewVsRepeatCustomerReport` | Export New Vs Repeat Customer Report |
| GET | `/api/v1/sales-any/reports/payment-revenue` | — | — | — | `exportPaymentRevenueReport` | Export Payment Revenue Report |

### `/api/v1/SalesRoute`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| POST | `/api/v1/SalesRoute/assignToOther/:sessionId` | JWT | — | authMiddleware | `assignToOther` | Assign To Other |
| PUT | `/api/v1/SalesRoute/complete-form/:sessionId` | JWT | — | authMiddleware, upload | `completeSalesForm` | Complete Sales Form |
| GET | `/api/v1/SalesRoute/getActiveSessionAgg` | JWT | — | authMiddleware | `getActiveSessionAgg` | Get Active Session Agg |
| GET | `/api/v1/SalesRoute/getCompanyLeads` | JWT | — | authMiddleware | `getCompanyLeads` | Get Company Leads |
| GET | `/api/v1/SalesRoute/getMyAssignedSessions` | JWT | — | authMiddleware | `getMyAssignedSessions` | Get My Assigned Sessions |
| GET | `/api/v1/SalesRoute/getNearbyFilteredSessions/:sessionId` | JWT | — | authMiddleware | `getNearbyFilteredSessions` | Get Nearby Filtered Sessions |
| GET | `/api/v1/SalesRoute/getNearbyOpenSalesAdminOptimized/:sessionId` | JWT | — | authMiddleware | `getNearbyOpenSalesAdminOptimized` | Get Nearby Open Sales Admin Optimized |
| GET | `/api/v1/SalesRoute/getNearbySalesByLocation` | JWT | — | authMiddleware | `getNearbySalesByLocation` | Get Nearby Sales By Location |
| GET | `/api/v1/SalesRoute/getSessionRoutes/route` | JWT | — | authMiddleware | `getSessionRoutes` | Get Session Routes |
| GET | `/api/v1/SalesRoute/getTodayMeetings` | JWT | — | authMiddleware | `getTodayMeetings` | Get Today Meetings |
| GET | `/api/v1/SalesRoute/getTodayMeetingsAdmin` | JWT | — | authMiddleware | `getTodayMeetingsAdmin` | Get Today Meetings Admin |
| GET | `/api/v1/SalesRoute/getTodaySessionsAll` | JWT | — | authMiddleware | `getTodaySessionsAll` | Get Today Sessions All |
| GET | `/api/v1/SalesRoute/open-sessions` | JWT | — | authMiddleware | `getOpenSessions` | Get Open Sessions |
| POST | `/api/v1/SalesRoute/open-sessions/filter` | JWT | — | authMiddleware | `getFilteredOpenSessions` | Get Filtered Open Sessions |
| GET | `/api/v1/SalesRoute/open-sessions/nearest` | JWT | — | authMiddleware | `getNearestOpenSessions` | Get Nearest Open Sessions |
| GET | `/api/v1/SalesRoute/open-sessions/stats` | JWT | — | authMiddleware | `getOpenSessionsStats` | Get Open Sessions Stats |
| GET | `/api/v1/SalesRoute/open-sessions/today` | JWT | — | authMiddleware | `getTodayOpenSessions` | Get Today Open Sessions |
| POST | `/api/v1/SalesRoute/punch-in` | JWT | — | authMiddleware, upload | `punchIn` | Punch In |
| PUT | `/api/v1/SalesRoute/punch-out` | JWT | — | authMiddleware, upload | `punchOut` | Punch Out |
| GET | `/api/v1/SalesRoute/session/:sessionId` | JWT | — | authMiddleware | `getSessionDetails` | Get Session Details |
| GET | `/api/v1/SalesRoute/session/:sessionId/route` | JWT | — | authMiddleware | `getSessionRoute` | Get Session Route |
| GET | `/api/v1/SalesRoute/sessions` | JWT | — | authMiddleware | `getSessions` | Get Sessions |
| GET | `/api/v1/SalesRoute/today` | JWT | — | authMiddleware | `getTodaySessions` | Get Today Sessions |

### `/api/v1/slab`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/slab` | — | — | — | `getAllPricingRules` | Get All Pricing Rules |
| POST | `/api/v1/slab` | — | — | — | `createPricingRule` | Create Pricing Rule |
| DELETE | `/api/v1/slab/:id` | — | — | — | `deletePricingRule` | Delete Pricing Rule |
| GET | `/api/v1/slab/:id` | — | — | — | `getPricingRuleById` | Get Pricing Rule By Id |
| PUT | `/api/v1/slab/:id` | — | — | — | `updatePricingRule` | Update Pricing Rule |
| GET | `/api/v1/slab/module/:moduleName` | — | — | — | `getPricingByModule` | Get Pricing By Module |

### `/api/v1/tasks`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/tasks` | JWT | — | authMiddleware | `getTasks` | Get Tasks |
| POST | `/api/v1/tasks` | JWT | — | authMiddleware, validateTask | `createTask` | Create Task |
| DELETE | `/api/v1/tasks/:id` | JWT | — | authMiddleware | `softDeleteTask` | Soft Delete Task |
| GET | `/api/v1/tasks/:id` | JWT | — | authMiddleware | `getTask` | Get Task |
| PATCH | `/api/v1/tasks/:id` | JWT | — | authMiddleware, validateTask | `updateTask` | Update Task |
| POST | `/api/v1/tasks/:id/activate` | JWT | — | authMiddleware | `activateTask` | Activate Task |
| GET | `/api/v1/tasks/:id/activity` | JWT | — | authMiddleware | `getTaskActivity` | Get Task Activity |
| POST | `/api/v1/tasks/:id/assign` | JWT | — | authMiddleware | `assignTask` | Assign Task |
| POST | `/api/v1/tasks/:id/assign-bulk` | JWT | — | authMiddleware | `assignTaskBulk` | Assign Task Bulk |
| DELETE | `/api/v1/tasks/:id/assignees/:userId` | JWT | — | authMiddleware | `removeAssignee` | Remove Assignee |
| GET | `/api/v1/tasks/:id/assignments` | JWT | — | authMiddleware | `getTaskAssignments` | Get Task Assignments |
| GET | `/api/v1/tasks/:id/attachments` | JWT | — | authMiddleware | `getAttachments` | Get Attachments |
| POST | `/api/v1/tasks/:id/attachments` | JWT | — | authMiddleware | `uploadAttachment` | Upload Attachment |
| DELETE | `/api/v1/tasks/:id/attachments/:attachmentId` | JWT | — | authMiddleware | `deleteAttachment` | Delete Attachment |
| POST | `/api/v1/tasks/:id/cancel` | JWT | — | authMiddleware | `cancelTask` | Cancel Task |
| POST | `/api/v1/tasks/:id/close` | JWT | — | authMiddleware | `closeTask` | Close Task |
| GET | `/api/v1/tasks/:id/comments` | JWT | — | authMiddleware | `getComments` | Get Comments |
| POST | `/api/v1/tasks/:id/comments` | JWT | — | authMiddleware | `createComment` | Create Comment |
| DELETE | `/api/v1/tasks/:id/comments/:commentId` | JWT | — | authMiddleware | `deleteComment` | Delete Comment |
| PATCH | `/api/v1/tasks/:id/comments/:commentId` | JWT | — | authMiddleware | `updateComment` | Update Comment |
| POST | `/api/v1/tasks/:id/comments/:commentId/mentions` | JWT | — | authMiddleware | `addMention` | Add Mention |
| POST | `/api/v1/tasks/:id/deactivate` | JWT | — | authMiddleware | `deactivateTask` | Deactivate Task |
| POST | `/api/v1/tasks/:id/duplicate` | JWT | — | authMiddleware | `duplicateTask` | Duplicate Task |
| GET | `/api/v1/tasks/:id/history` | JWT | — | authMiddleware | `getTaskHistory` | Get Task History |
| GET | `/api/v1/tasks/:id/invitations` | JWT | — | authMiddleware | `getInvitations` | Get Invitations |
| POST | `/api/v1/tasks/:id/invitations/:invitationId/accept` | JWT | — | authMiddleware | `acceptInvitation` | Accept Invitation |
| POST | `/api/v1/tasks/:id/invitations/:invitationId/reject` | JWT | — | authMiddleware | `rejectInvitation` | Reject Invitation |
| POST | `/api/v1/tasks/:id/invite` | JWT | — | authMiddleware | `inviteUser` | Invite User |
| POST | `/api/v1/tasks/:id/invite-bulk` | JWT | — | authMiddleware | `inviteUserBulk` | Invite User Bulk |
| POST | `/api/v1/tasks/:id/reassign` | JWT | — | authMiddleware | `reassignTask` | Reassign Task |
| POST | `/api/v1/tasks/:id/reject` | JWT | — | authMiddleware | `rejectTask` | Reject Task |
| POST | `/api/v1/tasks/:id/reopen` | JWT | — | authMiddleware | `reopenTask` | Reopen Task |
| POST | `/api/v1/tasks/:id/resume` | JWT | — | authMiddleware | `resumeTask` | Resume Task |
| POST | `/api/v1/tasks/:id/start` | JWT | — | authMiddleware | `startTask` | Start Task |
| POST | `/api/v1/tasks/:id/stop` | JWT | — | authMiddleware | `stopTask` | Stop Task |
| POST | `/api/v1/tasks/:id/submit` | JWT | — | authMiddleware | `submitTask` | Submit Task |
| POST | `/api/v1/tasks/:id/verify` | JWT | — | authMiddleware | `verifyTask` | Verify Task |
| GET | `/api/v1/tasks/:id/work-sessions` | JWT | — | authMiddleware | `getWorkSessions` | Get Work Sessions |
| GET | `/api/v1/tasks/invitations` | JWT | — | authMiddleware | `getInvitations` | Get Invitations |
| GET | `/api/v1/tasks/my-assignments` | JWT | — | authMiddleware | `getMyAssignments` | Get My Assignments |
| GET | `/api/v1/tasks/today` | JWT | — | authMiddleware | `getTodayTasks` | Get Today Tasks |
| GET | `/api/v1/tasks/users/:id/work-time` | JWT | — | authMiddleware | `getUserWorkTime` | Get User Work Time |
| PATCH | `/api/v1/tasks/work-sessions/:id` | JWT | — | authMiddleware | `correctWorkSession` | Correct Work Session |

### `/api/v1/users`

| Method | Path | Auth | Permission | Middleware | Handler | Purpose |
|---|---|---|---|---|---|---|
| GET | `/api/v1/users/assigned` | JWT | — | authMiddleware | `getAssignedUsers` | Get Assigned Users |
| GET | `/api/v1/users/invited` | JWT | — | authMiddleware | `getInvitedUsers` | Get Invited Users |
<!-- AUTO:END:api -->

---

## Deep-dive notes

Add module-specific explanations here. Suggested sections to fill in as needed:

- **Attendance** — punch validation rules, auto-close behaviour, late/half-day calculation.
- **Requests** — approval scope, multi-level approval, comp-off rules.
- **Payroll** — salary engine inputs, LOP calculation, payslip generation (see `PAYROLL_API.md`).
- **Sales sessions** — punch-in/out automation, geo-fencing, bulk upload format.
- **Tasks** — workflow states, assignment/invitation rules, work-session timers.
- **Face** — training pipeline, recognition threshold, device registration.

> Put notes **outside** the AUTO markers above.
