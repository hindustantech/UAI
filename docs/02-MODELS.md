# Data Models

Every Mongoose schema under `models/`. Field tables are generated from the schema definitions;
notes about relationships and business rules are hand-written.

## Relationship overview

- `User` is the account/tenant root. It carries `type` (`super_admin`, `partner`, `admin`,
  employee-level roles), `companyId` and permission references.
- `Employee` joins a `User` to a company (`companyId`) and a `Shift`; it holds job info, salary
  structure and deductions.
- `Attendance` belongs to an `Employee` and stores punch in/out, breaks and day status.
- `AttendanceRequest` (`models/Attandance/Request.js`) is the leave / attendance request record
  approved through `/api/attendance/requests`.
- Leave subsystem: `LeaveType` → `LeavePolicy` → `LeaveBalance` / `LeaveLedger` (accrual and
  consumption history).
- Payroll subsystem: `SalaryRule` / `PayrollRule` → `Payroll` → `Payslip`.
- Sales subsystem: `Sales` session records plus bulk upload staging.
- Tasks: `Task` → `TaskAssignment` → `TaskWorkSession` / `TaskStatusHistory` /
  `TaskComment` / `TaskAttachment` / `TaskInvitation` / `TaskCompletionRecord`.
- Subscription: `Plan` → `Subscription` → `PaymentLog`; `UserPlan` is the user-facing plan.
- Audit: `AuditLog` (hash-chained) with `AuditSequence` for ordering.
- Notifications: `Notification` and `DeadLetter` live in `src/notification/models/`, not `models/`.

## Conventions

- `companyId` is present on almost every tenant-scoped collection and is the primary isolation key.
- ObjectId references are shown in the `Constraints` column as `ref: 'ModelName'`.
- Enum values are shown inline; defaults are truncated if long.
- There are 47 files under `models/`, of which 45 define a schema. `models/Attandance/Holiydaycron.js`
  is the holiday cron job and `models/Attandance/subscration/upgradeController.js` is a controller
  that happens to live in the models folder; neither is a Mongoose model.

---

<!-- AUTO:START:models -->
**Total models: 45** — Mongoose schemas discovered under `models/`.

### `Advertisement`

Source: `models/Attandance/Advertistment.js`

| Field | Type | Constraints |
|---|---|---|
| `title` | String | required: yes |
| `description` | String | required: yes |
| `imageUrl` | String | required: yes |
| `linkUrl` | String | required: yes |
| `category` | ObjectId | ref: `AdvertisementCategory`; required: yes; index |
| `companyId` | ObjectId | ref: `User`; required: no; default: null; index |
| `status` | String | default: "active"; enum: "active" \\| "inactive"; index |

### `AdvertisementCategory`

Source: `models/Attandance/AdvertisementCategory.js`

| Field | Type | Constraints |
|---|---|---|
| `name` | String | required: yes; unique |
| `description` | String | — |
| `slug` | String | required: yes; unique; index |
| `status` | String | default: "active"; enum: "active" \\| "inactive"; index |

### `AppSettings`

Source: `models/appsessting.js`

| Field | Type | Constraints |
|---|---|---|
| `color` | String | required: yes; default: "#000000" |
| `link` | String | required: no; default: "https://www.uaihr.com" |

### `AssingPermission`

Source: `models/AssingPermission.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `userId` | ObjectId | ref: `User`; required: yes; index |
| `permissions` | Array | — |
| `approvalScope` | Object | default: 'department' |
| `assignedBy` | ObjectId | ref: `User`; required: yes |

- Hooks: `pre('validate')`, `pre('save')`, `post('save')`
- Indexes: `{ companyId: 1, userId: 1 }`

### `Attendance`

Source: `models/Attandance/Attendance.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `employeeId` | ObjectId | ref: `Employee`; required: yes; index |
| `date` | Date | required: yes; index |
| `shift` | Number | default: 0 |
| `totalWorkingHours` | Number | default: 0 |
| `lateByMinutes` | Number | default: 0 |
| `punchIn` | Date | index |
| `punchOut` | Date | index |
| `breaks` | [BreakSchema] | default: [] |
| `punchHistory` | Array | default: "mobile"; enum: "in" \\| "out" |
| `lastPunchAt` | Date | index |
| `workSummary` | Number | default: 0 |
| `status` | String | default: "present"; enum: "present" \\| "present autocheckout" \\| "absent" \\| "leave" … |
| `leaveTypeId` | ObjectId | ref: `LeaveType` |
| `isPaidLeave` | Boolean | default: null |
| `approvalStatus` | String | default: "approved"; enum: "pending" \\| "approved" \\| "rejected" |
| `geoLocation` | Object | enum: "Point" |
| `deviceInfo` | String | enum: "android" \\| "ios" \\| "web"; index |
| `remarks` | String | — |
| `editLogs` | Array | ref: `User`; default: Date.now |
| `isAutoMarked` | Boolean | default: false |
| `isSuspicious` | Boolean | default: false |

- Indexes: `{ companyId: 1, employeeId: 1, date: 1 }`, `{ geoLocation: "2dsphere" }`, `{ "deviceInfo.deviceId": 1 }`, `{ employeeId: 1, date: -1 }`, `{ status: 1, approvalStatus: 1 }`

### `AttendanceRequest`

Source: `models/Attandance/Request.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `employeeId` | ObjectId | ref: `Employee`; required: yes; index |
| `requestType` | String | required: yes; enum: "leave" \\| "punch_in_out" \\| "punch_in" \\| "punch_in_and_ou…; index |
| `reason` | String | — |
| `leaveDetails` | Date | — |
| `leaveTypeId` | ObjectId | ref: `LeaveType` |
| `leaveDays` | Number | default: 0 |
| `isPaid` | Boolean | default: true |
| `isHalfDay` | Boolean | default: false |
| `halfDaySession` | String | enum: "first" \\| "second" |
| `balanceBefore` | Number | default: 0 |
| `balanceAfter` | Number | default: 0 |
| `policyId` | ObjectId | ref: `LeavePolicy` |
| `punchDetails` | Date | — |
| `otDetails` | Date | default: false |
| `status` | String | default: "pending"; enum: "pending" \\| "approved" \\| "rejected" \\| "cancelled"; index |
| `approvedBy` | ObjectId | ref: `User` |
| `approvedAt` | Date | — |
| `rejectionReason` | String | — |

### `AuditLog`

Source: `models/AuditLog.js`

| Field | Type | Constraints |
|---|---|---|
| `eventId` | String | required: yes; unique |
| `schemaVersion` | Number | required: yes; default: 1 |
| `timestamp` | Date | required: yes; default: Date.now |
| `requestId` | String | — |
| `correlationId` | String | — |
| `idempotencyKey` | String | unique |
| `actorType` | String | required: yes; enum: 'USER' \\| 'SERVICE_ACCOUNT' \\| 'SYSTEM' \\| 'CRON' \\| 'QUEUE… |
| `userId` | ObjectId | ref: `User` |
| `employeeId` | ObjectId | ref: `Employee` |
| `impersonatedUserId` | ObjectId | ref: `User` |
| `organizationId` | ObjectId | index |
| `userRole` | String | — |
| `action` | String | required: yes; index |
| `operation` | String | enum: 'CREATE' \\| 'UPDATE' \\| 'DELETE' \\| 'ACTIVATE' \\| 'DEACTIVA… |
| `eventType` | String | enum: 'READ' \\| 'WRITE' \\| 'SECURITY' \\| 'FINANCIAL' \\| 'SYSTEM' |
| `severity` | String | default: 'INFO'; enum: 'INFO' \\| 'WARNING' \\| 'CRITICAL' |
| `category` | String | enum: 'AUTHENTICATION' \\| 'AUTHORIZATION' \\| 'DATA' \\| 'BUSINESS'…; index |
| `resource` | String | required: yes |
| `resourceId` | String | required: yes |
| `parentResourceId` | String | — |
| `http` | Object | — |
| `sanitizedRequestBody` | String | — |
| `sanitizedResponseMetadata` | String | — |
| `oldData` | Mixed | — |
| `newData` | Mixed | — |
| `changedFields` | Array | — |
| `noChange` | Boolean | default: false |
| `success` | Boolean | required: yes |
| `result` | String | enum: 'SUCCESS' \\| 'FAILURE' \\| 'PARTIAL_SUCCESS' \\| 'NOT_FOUND' … |
| `errorCode` | String | — |
| `errorCategory` | String | — |
| `safeErrorMessage` | String | — |
| `durationMs` | Number | — |
| `source` | String | enum: 'USER_ACTION' \\| 'SYSTEM_ACTION' |
| `origin` | String | enum: 'HTTP' \\| 'CRON' \\| 'QUEUE' \\| 'WORKER' \\| 'SYSTEM' |
| `jobId` | String | — |
| `queueName` | String | — |
| `cronJobName` | String | — |
| `initiatingUserId` | ObjectId | ref: `User` |
| `metadata` | Mixed | — |
| `bulk` | String | — |
| `changes` | Array | — |
| `visibilityStatus` | String | default: 'VISIBLE'; enum: 'VISIBLE' \\| 'HIDDEN' |
| `deactivatedAt` | Date | — |
| `deactivatedBy` | ObjectId | ref: `User` |
| `deactivationReason` | String | — |
| `file` | Object | — |
| `payloadTruncated` | Boolean | default: false |
| `retryOfEventId` | String | — |
| `chainScope` | String | required: yes |
| `seq` | Number | required: yes |
| `previousHash` | String | — |
| `currentHash` | String | required: yes |
| `sealedAt` | Date | — |

- Indexes: `{ chainScope: 1, seq: 1 }`, `{ organizationId: 1, timestamp: -1 }`, `{ organizationId: 1, action: 1, timestamp: -1 }`, `{ organizationId: 1, resource: 1, timestamp: -1 }`, `{ organizationId: 1, resourceId: 1, timestamp: -1 }`, `{ organizationId: 1, resource: 1, resourceId: 1, timestamp: -1 }`, `{ organizationId: 1, userId: 1, timestamp: -1 }`, `{ organizationId: 1, success: 1, timestamp: -1 }`, `{ organizationId: 1, category: 1, timestamp: -1 }`, `{ userId: 1, timestamp: -1 }`, `{ resource: 1, resourceId: 1, timestamp: -1 }`, `{ action: 1, timestamp: -1 }`, `{ requestId: 1 }`

### `AuditSequence`

Source: `models/AuditSequence.js`

| Field | Type | Constraints |
|---|---|---|
| `_id` | String | required: yes |
| `seq` | Number | default: 0 |

### `Bill`

Source: `models/BilledDate/billedDate.js`

| Field | Type | Constraints |
|---|---|---|
| `billDate` | Date | required: yes |
| `bill_id` | String | required: yes; unique; index |
| `customerName` | String | required: yes |
| `phone` | String | required: yes |
| `serviceName` | String | required: yes |
| `baseServiceName` | String | index |
| `staffName` | String | index |
| `status` | String | default: 'issued'; enum: 'draft' \\| 'issued' \\| 'paid' \\| 'overdue' \\| 'cancelled'; index |
| `remarks` | String | — |
| `followUps` | Array | — |
| `followUpMax` | Number | default: 3 |
| `followUpCount` | Number | default: 0 |
| `reminderStatus` | String | default: 'pending'; enum: 'pending' \\| 'skipped' \\| 'sent' \\| 'max_reached' \\| 'not_n…; index |
| `lastReminderSentAt` | Date | — |
| `nextReminderDate` | Date | — |
| `serviceIntervalDays` | Number | default: 30 |
| `metadata` | String | default: 'manual' |

- Hooks: `pre('save')`, `pre('findOneAndUpdate')`
- Indexes: `{ phone: 1, baseServiceName: 1 }`, `{ phone: 1, status: 1 }`, `{ reminderStatus: 1, nextReminderDate: 1 }`, `{ billDate: -1 }`, `{ createdAt: -1 }`

### `Blog`

Source: `models/Blog/Blog.js`

| Field | Type | Constraints |
|---|---|---|
| `title` | String | required: yes; index |
| `slug` | String | unique; index |
| `content` | String | required: yes |
| `excerpt` | String | — |
| `category` | ObjectId | ref: `Category`; required: yes; index |
| `subCategory` | String | index |
| `tags` | Array | — |
| `featuredImage` | String | required: yes |
| `gallery` | Array | — |
| `author` | ObjectId | ref: `User`; required: yes; index |
| `authorName` | String | required: yes |
| `authorAvatar` | String | default: null |
| `status` | String | default: "DRAFT"; enum: "DRAFT" \\| "PUBLISHED" \\| "ARCHIVED" \\| "SCHEDULED"; index |
| `visibility` | String | default: "PUBLIC"; enum: "PUBLIC" \\| "PRIVATE" \\| "PASSWORD_PROTECTED" |
| `password` | String | — |
| `scheduledAt` | Date | — |
| `publishedAt` | Date | — |
| `views` | Number | default: 0 |
| `uniqueViews` | Number | default: 0 |
| `readTime` | Number | default: 0 |
| `wordCount` | Number | default: 0 |
| `likes` | Array | ref: `User` |
| `likeCount` | Number | default: 0 |
| `bookmarks` | Array | ref: `User` |
| `bookmarkCount` | Number | default: 0 |
| `shares` | Number | default: 0 |
| `shareLinks` | Object | — |
| `ratings` | Array | — |
| `averageRating` | Number | default: 0 |
| `totalRatings` | Number | default: 0 |
| `comments` | Array | — |
| `commentCount` | Number | default: 0 |
| `allowComments` | Boolean | default: true |
| `metaTitle` | String | — |
| `metaDescription` | String | — |
| `metaKeywords` | Array | — |
| `focusKeyword` | String | — |
| `canonicalUrl` | String | — |
| `ogImage` | String | — |
| `isFeatured` | Boolean | default: false; index |
| `isTrending` | Boolean | default: false |
| `isEditorPick` | Boolean | default: false |
| `relatedPosts` | Array | ref: `Blog` |
| `version` | Number | default: 1 |
| `revisionHistory` | Array | ref: `User` |
| `isActive` | Boolean | default: true |
| `allowIndexing` | Boolean | default: true |

- Hooks: `pre('save')`
- Indexes: `{ slug: 1 }`, `{ category: 1, status: 1 }`, `{ author: 1, status: 1 }`, `{ tags: 1 }`, `{ createdAt: -1 }`, `{ status: 1, publishedAt: -1 }`, `{ isFeatured: 1, publishedAt: -1 }`, `{ title: "text", content: "text", tags: "text" }`

### `Category`

Source: `models/Blog/Category.js`

| Field | Type | Constraints |
|---|---|---|
| `name` | String | required: yes; unique |
| `slug` | String | unique |
| `description` | String | — |
| `image` | Object | — |
| `icon` | String | default: "📁" |
| `subCategories` | Array | — |
| `parentCategory` | ObjectId | ref: `Category`; default: null |
| `isActive` | Boolean | default: true |
| `isFeatured` | Boolean | default: false |
| `order` | Number | default: 0 |
| `blogCount` | Number | default: 0 |
| `metaTitle` | String | — |
| `metaDescription` | String | — |
| `metaKeywords` | Array | — |
| `createdBy` | ObjectId | ref: `User` |

- Hooks: `pre('save')`
- Indexes: `{ slug: 1 }`, `{ isActive: 1, isFeatured: 1 }`, `{ "subCategories.slug": 1 }`

### `Employee`

Source: `models/Attandance/Employee.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `shift` | ObjectId | ref: `Shift`; index |
| `userId` | ObjectId | ref: `User`; required: yes |
| `user_name` | String | — |
| `weeklyOff` | [{ | default: ["Sunday"]; enum: "Sunday" \\| "Monday" \\| "Tuesday" \\| "Wednesday" \\| "Thursd… |
| `weeklyOffHalfDay` | [{ | default: []; enum: "Sunday" \\| "Monday" \\| "Tuesday" \\| "Wednesday" \\| "Thursd… |
| `empCode` | String | — |
| `referalCode` | String | — |
| `jobInfo` | ObjectId | ref: `User` |
| `employeeType` | String | default: "non_sales"; enum: 'non_sales' \\| 'sales' \\| 'pro_sales' |
| `role` | String | default: "employee"; enum: 'employee' \\| 'manager' \\| 'hr' \\| 'admin' \\| 'sales' \\| 's… |
| `salaryStructure` | String | required: yes; default: 0; enum: "full_minus_lop" \\| "pro_rata" |
| `deductions` | String | required: yes; default: 0 |
| `AllowDownlodslip` | Boolean | default: false |
| `bankDetails` | Object | — |
| `officeLocation` | Object | required: yes; default: "Point"; enum: "Point" |
| `employmentStatus` | String | default: "active"; enum: "active" \\| "inactive" |
| `deactivatedAt` | Date | — |
| `deactivatedBy` | ObjectId | ref: `User` |
| `deactivationReason` | String | — |
| `compOff` | Number | default: 0 |
| `leavePolicy` | ObjectId | ref: `LeavePolicy` |

- Indexes: `{ officeLocation: "2dsphere" }`, `{ companyId: 1, userId: 1 }`

### `Face`

Source: `models/Face.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `employeeId` | ObjectId | ref: `Employee`; required: yes; unique; index |
| `images` | [FaceImageSchema] | default: [] |
| `isEnrolled` | Boolean | default: false; index |
| `enrollmentStatus` | String | default: "not_started"; index |
| `minRequiredImages` | Number | default: 2 |
| `enrolledAt` | Date | default: null |
| `lastReEnrolledAt` | Date | default: null |
| `enrolledBy` | ObjectId | ref: `User`; default: null |
| `rejectionReason` | String | default: null |
| `matchThreshold` | Number | default: 0.65 |
| `modelVersion` | String | default: "insightface-arcface-buffalo_l" |
| `verificationLogs` | [VerificationLogSchema] | default: [] |
| `lastVerifiedAt` | Date | default: null |
| `totalVerificationAttempts` | Number | default: 0 |
| `totalFailedAttempts` | Number | default: 0 |
| `consecutiveFailedAttempts` | Number | default: 0 |
| `isLocked` | Boolean | default: false; index |
| `lockedAt` | Date | default: null |
| `lockReason` | String | default: null |
| `isSuspicious` | Boolean | default: false; index |
| `flaggedForReview` | Boolean | default: false; index |
| `consentGiven` | Boolean | required: yes; default: false |
| `consentGivenAt` | Date | default: null |
| `consentWithdrawnAt` | Date | default: null |
| `dataRetentionExpiresAt` | Date | default: null; index |

- Hooks: `pre('save')`
- Indexes: `{ companyId: 1, employeeId: 1 }`, `{ companyId: 1, isEnrolled: 1 }`, `{ companyId: 1, enrollmentStatus: 1 }`, `{ companyId: 1, isLocked: 1 }`, `{ companyId: 1, isSuspicious: 1 }`, `{ companyId: 1, flaggedForReview: 1 }`, `{ dataRetentionExpiresAt: 1 }`, `{ enrollmentStatus: 1, lastReEnrolledAt: 1 }`

### `Holiday`

Source: `models/Attandance/Holiday.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `name` | String | required: yes |
| `date` | Date | required: yes |
| `type` | String | enum: "national" \\| "festival" \\| "company" \\| "optional" \\| "flo… |
| `isPaid` | Boolean | default: true |
| `applicableTo` | Object | — |
| `createdBy` | ObjectId | ref: `User` |

- Indexes: `{ companyId: 1, date: 1 }`

### `Lead`

Source: `models/uaileads.js`

| Field | Type | Constraints |
|---|---|---|
| `companyName` | String | required: yes |
| `phone` | String | required: yes |
| `companySize` | String | required: yes; enum: "1-10" \\| "11-50" \\| "51-200" \\| "201-500" \\| "501-1000" \\|… |
| `salesTeam` | Boolean | required: yes; default: false |
| `status` | String | default: "new"; enum: "new" \\| "contacted" \\| "qualified" \\| "converted" \\| "reje… |
| `notes` | String | default: "" |

- Indexes: `{ phone: 1 }`

### `LeaveBalance`

Source: `models/Attandance/LeaveBalance.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `employeeId` | ObjectId | ref: `Employee`; required: yes; index |
| `leaveTypeId` | ObjectId | ref: `LeaveType`; required: yes; index |
| `policyId` | ObjectId | ref: `LeavePolicy` |
| `year` | Number | required: yes |
| `month` | Number | — |
| `allocated` | Number | default: 0 |
| `carriedForward` | Number | default: 0 |
| `used` | Number | default: 0 |
| `pending` | Number | default: 0 |
| `expired` | Number | default: 0 |
| `adjusted` | Number | default: 0 |
| `balance` | Number | default: 0 |
| `monthly` | Array | default: 0 |

- Indexes: `{ employeeId: 1, leaveTypeId: 1, year: 1 }`

### `LeaveLedger`

Source: `models/Attandance/LeaveLedger.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `employeeId` | ObjectId | ref: `Employee`; required: yes; index |
| `leaveTypeId` | ObjectId | ref: `LeaveType`; required: yes; index |
| `year` | Number | required: yes |
| `month` | Number | — |
| `type` | String | required: yes; enum: "credit" \\| "debit" \\| "carry_forward" \\| "expire" \\| "adju… |
| `days` | Number | required: yes |
| `requestId` | ObjectId | ref: `AttendanceRequest` |
| `reason` | String | — |
| `balanceAfter` | Number | required: yes |
| `createdBy` | ObjectId | ref: `User`; default: null |
| `source` | String | default: "user"; enum: "user" \\| "cron" \\| "system" |

- Indexes: `{ employeeId: 1, leaveTypeId: 1, year: 1, month: 1, type: 1, reason: 1 }`

### `LeavePolicy`

Source: `models/Attandance/LeavePolicy.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `name` | String | required: yes |
| `description` | String | — |
| `isDefault` | Boolean | default: false |
| `financialYearStartMonth` | Number | default: 1 |
| `leaveRules` | Array | ref: `LeaveType`; required: yes; default: 15; enum: "lumpsum" \\| "monthly_prorated" |
| `isActive` | Boolean | default: true |

### `LeaveType`

Source: `models/Attandance/LeaveType.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `name` | String | required: yes |
| `code` | String | required: yes; unique |
| `category` | String | required: yes; enum: "yearly_fixed" \\| "monthly" \\| "earned" |
| `paid` | Boolean | default: true |
| `allowHalfDay` | Boolean | default: false |
| `isActive` | Boolean | default: true |

- Indexes: `{ companyId: 1, code: 1 }`

### `ManualAddress`

Source: `models/ManualAddress.js`

| Field | Type | Constraints |
|---|---|---|
| `city` | String | required: yes; index |
| `uniqueCode` | String | required: yes; unique; index |
| `state` | String | default: null |
| `country` | String | default: "India" |
| `isActive` | Boolean | default: true; index |
| `location` | Object | default: "Point"; enum: "Point" |

- Indexes: `{ location: "2dsphere" }`

### `Onboarding`

Source: `models/Onboarding.js`

| Field | Type | Constraints |
|---|---|---|
| `personalInfo` | String | required: yes |
| `company` | String | required: yes |
| `onboarding` | String | default: "pending"; enum: "pending" \\| "in_progress" \\| "completed" \\| "rejected" |

- Indexes: `{ "personalInfo.email": 1 }`, `{ "onboarding.status": 1, }`

### `Otp`

Source: `models/Otp.js`

| Field | Type | Constraints |
|---|---|---|
| `userId` | ObjectId | ref: `User`; required: yes; index |
| `phone` | String | required: yes; index |
| `otp` | String | required: yes |
| `attempts` | Number | default: 0 |
| `maxAttempts` | Number | default: 5 |
| `expiresAt` | Date | required: yes; index |
| `verified` | Boolean | default: false |
| `sms_uid` | String | default: null |

- Indexes: `{ expiresAt: 1 }`

### `PatnerProfile`

Source: `models/PatnerProfile.js`

| Field | Type | Constraints |
|---|---|---|
| `logo` | String | — |
| `User_id` | ObjectId | ref: `User`; required: yes |
| `mallId` | ObjectId | ref: `Mall`; default: null |
| `email` | String | required: yes |
| `idType` | String | required: no; default: "PAN"; enum: "PAN" \\| "GST" |
| `idNumber` | String | required: no; default: null |
| `firm_name` | String | required: yes |
| `isIndependent` | Boolean | default: true |
| `detilsmall` | MallDetailsSchema | default: null |
| `address` | String | default: "" |

- Hooks: `pre('save')`

### `PaymentLog`

Source: `models/Attandance/subscration/PaymentLog.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | — | — |
| `subscriptionId` | — | — |
| `amount` | Number | — |
| `status` | String | — |
| `razorpayPaymentId` | String | — |
| `razorpayOrderId` | String | — |
| `rawPayload` | — | — |
| `upgradeType` | String | default: null; enum: "EMPLOYEE_UPGRADE" \\| "PLAN_UPGRADE" \\| null |
| `metadata` | Mixed | default: { |
| `paymentCompletedAt` | Date | — |

### `Payroll`

Source: `models/Attandance/Payroll.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `employeeId` | ObjectId | ref: `Employee`; required: yes; index |
| `payPeriod` | Number | required: yes |
| `payDate` | Date | — |
| `employeeSnapshot` | Object | — |
| `payType` | String | default: "monthly"; enum: "monthly" \\| "hourly" \\| "perday" |
| `attendance` | Number | ref: `LeaveType`; default: 30 |
| `salaryRuleDeductions` | Number | default: 0 |
| `payableDays` | Number | default: 0 |
| `earnings` | Number | default: 0 |
| `grossSalary` | Number | default: 0 |
| `statutoryDeductions` | Number | default: 0 |
| `employerContributions` | Number | default: 0 |
| `otherDeductions` | Number | default: 0 |
| `totalDeductions` | Number | default: 0 |
| `netSalary` | Number | default: 0 |
| `lossOfPay` | Number | default: 0 |
| `salaryApproach` | String | default: "full_minus_lop"; enum: "full_minus_lop" \\| "pro_rata" |
| `ratesUsed` | Number | default: 0 |
| `status` | String | default: "draft"; enum: "draft" \\| "approved" \\| "paid" \\| "cancelled" |
| `paidAt` | Date | default: null |
| `paidBy` | ObjectId | ref: `User` |
| `remarks` | String | default: "" |
| `generatedBy` | ObjectId | ref: `User` |
| `approvedBy` | ObjectId | ref: `User` |
| `editLogs` | Array | ref: `User`; default: Date.now |

- Indexes: `{ companyId: 1, employeeId: 1, "payPeriod.month": 1, "payPeriod.year": 1 }`, `{ companyId: 1, "payPeriod.year": 1, "payPeriod.month": 1 }`, `{ status: 1 }`

### `PayrollRule`

Source: `models/PayrollRuleSchema.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User` |
| `deductions` | Boolean | default: true; enum: "percentage" \\| "fixed" |
| `isActive` | Boolean | default: true |

### `Payslip`

Source: `models/Attandance/Payslip.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; index |
| `employeeId` | ObjectId | ref: `Employee` |
| `payrollId` | ObjectId | ref: `Payroll` |
| `month` | String | index |
| `filePath` | String | — |
| `generatedAt` | Date | — |
| `status` | String | default: "generated"; enum: "generated" \\| "emailed" |

- Indexes: `{ companyId: 1, employeeId: 1, month: 1 }`

### `Permission`

Source: `models/Permission.js`

| Field | Type | Constraints |
|---|---|---|
| `resource` | String | required: yes; index |
| `action` | String | required: yes |
| `name` | String | — |
| `key` | String | required: yes; unique; index |
| `description` | String | default: '' |
| `system` | Boolean | default: false |
| `adminOnly` | Boolean | default: false |
| `meta` | Mixed | default: { |

- Hooks: `pre('validate')`, `post('save')`
- Indexes: `{ resource: 1, action: 1 }`

### `PermissionLog`

Source: `models/PermissionLog.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `userId` | ObjectId | ref: `User`; required: yes |
| `permissionKey` | String | required: yes |
| `actionType` | String | required: yes; enum: 'ASSIGNED' \\| 'REMOVED' |
| `performedBy` | ObjectId | ref: `User`; required: yes |
| `note` | String | default: '' |

### `Plan`

Source: `models/Attandance/subscration/plan.js`

| Field | Type | Constraints |
|---|---|---|
| `name` | String | required: yes; unique |
| `price` | Number | required: yes |
| `discount` | Number | default: 0 |
| `finalPrice` | Number | — |
| `auto_check_out` | Boolean | default: false |
| `features_version` | Boolean | default: false |
| `validityDays` | Number | required: yes |
| `data_export` | Boolean | default: false |
| `data_see` | Boolean | default: false |
| `Max_Employees` | Number | default: 0 |
| `Max_sales` | Number | default: 0 |
| `Max_Sales_pro` | Number | default: 0 |
| `isfree` | Boolean | default: false |
| `features` | Array | — |
| `isActive` | Boolean | default: true |
| `planType` | String | default: "BASIC"; enum: "FREE" \\| "BASIC" \\| "STANDARD" \\| "PREMIUM" \\| "ENTERPRISE" |
| `metadata` | Map | — |

- Hooks: `pre('save')`

### `PricingRule`

Source: `models/Slab/SlabRule.js`

| Field | Type | Constraints |
|---|---|---|
| `modules` | [modulePricingSchema] | required: yes |

- Indexes: `{ "modules.module": 1 }`

### `SalaryRule`

Source: `models/salaryRules.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User` |
| `late` | String | default: "3 Late = 0.5 Day Cut" |
| `halfDay` | String | default: "2 Half Days = 1 Day Cut" |
| `compOff` | String | default: "Comp Off Expiry" |

### `SalesSession`

Source: `models/Attandance/Salses/Salses.js`

| Field | Type | Constraints |
|---|---|---|
| `sessionId` | String | required: yes; unique |
| `customer` | String | default: ""; enum: "retail" \\| "wholesale" \\| "corporate" \\| 'customer' \\| 'ag… |
| `companyId` | ObjectId | ref: `User`; required: yes |
| `createdBy` | ObjectId | ref: `User` |
| `assignedTo` | Array | ref: `User` |
| `visitLogs` | [visitLogSchema] | default: [] |
| `salesLogs` | [salesLogSchema] | default: [] |
| `meetingLogs` | [meetingLogSchema] | default: [] |
| `visitNotes` | [visitNoteSchema] | default: [] |
| `visitType` | String | default: "one_time"; enum: "one_time" \\| "recurring" |
| `recurringSchedule` | Object | default: []; enum: "days" \\| "dates" |
| `routePath` | [routePointSchema] | default: [0.0 |
| `totalDistance` | Number | default: 0 |
| `duration` | Number | default: 0 |
| `status` | String | default: "not started"; enum: "not started" \\| "in_progress" \\| "completed"; index |
| `SalesStatus` | String | default: "open"; enum: "open" \\| "closed" \\| "follow_up" |
| `formCompleted` | Boolean | default: false |
| `nextMeeting` | Boolean | default: false |
| `evidence` | attachmentSchema | — |
| `punchInTime` | Date | default: null |
| `punchInLocation` | geoPointSchema | — |
| `punchOutTime` | Date | default: null |
| `punchOutLocation` | geoPointSchema | — |
| `punchOutAddress` | String | default: "" |
| `lastPunchAt` | Date | default: null |
| `employeeId` | ObjectId | ref: `User` |

- Indexes: `{ "routePath.location": "2dsphere" }`, `{ punchInLocation: "2dsphere" }`, `{ punchOutLocation: "2dsphere" }`, `{ status: 1, punchInLocation: "2dsphere" }`, `{ companyId: 1, status: 1, SalesStatus: 1 }`

### `Shift`

Source: `models/Attandance/Shift.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `shiftName` | String | required: yes; default: "General Shift" |
| `shiftCode` | String | required: yes; default: "GEN" |
| `startTime` | String | required: yes; default: "09:00" |
| `endTime` | String | required: yes; default: "18:00" |
| `shiftType` | String | default: "fixed"; enum: "fixed" \\| "rotational" \\| "flexible" |
| `weeklyOff` | [String] | default: ["Sunday"]; enum: "Sunday" \\| "Monday" \\| "Tuesday" \\| "Wednesday" \\| "Thursd… |
| `weeklyOffHalfDay` | [String] | default: []; enum: "Sunday" \\| "Monday" \\| "Tuesday" \\| "Wednesday" \\| "Thursd… |
| `breaks` | [BreakSchema] | default: () => [{ |
| `gracePeriod` | Number | default: 30 |
| `overtime` | Boolean | default: true |
| `isNightShift` | Boolean | default: false |
| `isDeleted` | Boolean | default: false; index |
| `deletedAt` | Date | — |

- Hooks: `pre('save')`
- Indexes: `{ companyId: 1 }`

### `Subscription`

Source: `models/Attandance/subscration/Subscription.js`

| Field | Type | Constraints |
|---|---|---|
| `company` | ObjectId | ref: `User`; required: yes; index |
| `plan` | ObjectId | ref: `Plan`; required: yes |
| `planSnapshot` | Object | — |
| `startDate` | Date | default: Date.now; index |
| `bill_id` | String | default: null |
| `bill_generation_date` | Date | default: null |
| `endDate` | Date | required: yes; index |
| `status` | String | default: "PENDING"; enum: "PENDING" \\| "ACTIVE" \\| "EXPIRED" \\| "CANCELLED" \\| "PAST_…; index |
| `payment` | String | default: "PENDING"; enum: "RAZORPAY" \\| "STRIPE" \\| "MANUAL" \\| "OTHER" \\| "FREE_PLAN" |
| `autoRenew` | Boolean | default: false |
| `renewalHistory` | Array | — |
| `usage` | Number | default: 0 |
| `isActive` | Boolean | default: true |

- Hooks: `pre('save')`
- Indexes: `{ status: 1, isActive: 1, endDate: 1 }`

### `Task`

Source: `models/tasks/taskModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskNumber` | String | — |
| `title` | String | required: yes |
| `description` | String | — |
| `taskType` | String | default: 'one_time'; enum: 'daily' \\| 'days' \\| 'dates' \\| 'one_time' |
| `recurringDays` | Array | enum: 'SUNDAY' \\| 'MONDAY' \\| 'TUESDAY' \\| 'WEDNESDAY' \\| 'THURSD… |
| `recurringDates` | Array | — |
| `priority` | String | default: 'MEDIUM'; enum: 'LOW' \\| 'MEDIUM' \\| 'HIGH' \\| 'URGENT' \\| 'CRITICAL' |
| `status` | String | default: 'DRAFT'; enum: 'DRAFT' \\| 'INVITED' \\| 'ASSIGNED' \\| 'ACCEPTED' \\| 'ACTIVE… |
| `createdBy` | ObjectId | ref: `User`; required: yes |
| `ownerId` | ObjectId | ref: `User`; required: yes |
| `assignedUsers` | Array | ref: `User` |
| `startDate` | Date | default: Date.now |
| `dueDate` | Date | — |
| `estimatedDurationSeconds` | Number | default: 0 |
| `actualDurationSeconds` | Number | default: 0 |
| `completedAt` | Date | — |
| `completedBy` | ObjectId | ref: `User` |
| `submittedAt` | Date | — |
| `submittedBy` | ObjectId | ref: `User` |
| `verifiedAt` | Date | — |
| `verifiedBy` | ObjectId | ref: `User` |
| `closedAt` | Date | — |
| `closedBy` | ObjectId | ref: `User` |
| `activatedAt` | Date | — |
| `activatedBy` | ObjectId | ref: `User` |
| `deactivatedAt` | Date | — |
| `deactivatedBy` | ObjectId | ref: `User` |
| `deletedAt` | Date | — |
| `deletedBy` | ObjectId | ref: `User` |
| `version` | Number | default: 0 |
| `createdAt` | Date | default: Date.now |
| `updatedAt` | Date | default: Date.now |

- Hooks: `pre('save')`
- Indexes: `{ companyId: 1, status: 1 }`, `{ companyId: 1, priority: 1 }`, `{ companyId: 1, dueDate: 1 }`, `{ companyId: 1, createdBy: 1 }`, `{ companyId: 1, ownerId: 1 }`, `{ companyId: 1, taskNumber: 1 }`, `{ companyId: 1, createdAt: -1 }`, `{ companyId: 1, status: 1, priority: 1 }`, `{ companyId: 1, status: 1, dueDate: 1 }`, `{ assignedUsers: 1, status: 1 }`, `{ companyId: 1, deletedAt: 1 }`, `{ companyId: 1, taskType: 1, dueDate: 1 }`, `{ companyId: 1, taskType: 1, recurringDays: 1 }`, `{ companyId: 1, taskType: 1, recurringDates: 1 }`

### `TaskAssignment`

Source: `models/tasks/taskAssignmentModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes |
| `userId` | ObjectId | ref: `User`; required: yes |
| `assignedBy` | ObjectId | ref: `User`; required: yes |
| `assignedAt` | Date | default: Date.now |
| `status` | String | default: 'INVITED'; enum: 'INVITED' \\| 'ASSIGNED' \\| 'ACCEPTED' \\| 'REJECTED' \\| 'REM… |
| `acceptedAt` | Date | — |
| `rejectedAt` | Date | — |
| `rejectionReason` | String | — |
| `startedAt` | Date | — |
| `completedAt` | Date | — |
| `createdAt` | Date | default: Date.now |
| `updatedAt` | Date | default: Date.now |

- Hooks: `pre('save')`
- Indexes: `{ companyId: 1, taskId: 1, userId: 1 }`, `{ companyId: 1, userId: 1, status: 1 }`, `{ companyId: 1, taskId: 1, status: 1 }`, `{ userId: 1, status: 1 }`, `{ companyId: 1, createdAt: -1 }`

### `TaskAttachment`

Source: `models/tasks/taskAttachmentModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes; index |
| `uploader` | ObjectId | ref: `User`; required: yes |
| `fileName` | String | required: yes |
| `fileId` | String | required: yes |
| `mimeType` | String | required: yes |
| `size` | Number | required: yes |
| `checksum` | String | default: '' |
| `accessType` | String | default: 'private'; enum: 'private' \\| 'public' \\| 'team' |
| `downloadCount` | Number | default: 0 |
| `createdAt` | Date | default: Date.now |

- Indexes: `{ companyId: 1, taskId: 1, createdAt: -1 }`, `{ companyId: 1, uploader: 1, createdAt: -1 }`

### `TaskComment`

Source: `models/tasks/taskCommentModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes; index |
| `userId` | ObjectId | ref: `User`; required: yes |
| `message` | String | required: yes |
| `parentCommentId` | ObjectId | ref: `TaskComment`; index |
| `mentions` | Array | ref: `User` |
| `deletedAt` | Date | — |
| `createdAt` | Date | default: Date.now |
| `updatedAt` | Date | default: Date.now |

- Indexes: `{ companyId: 1, taskId: 1, createdAt: -1 }`, `{ companyId: 1, userId: 1, createdAt: -1 }`, `{ taskId: 1, deletedAt: 1 }`

### `TaskCompletionRecord`

Source: `models/tasks/taskCompletionRecordModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `Company`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes |
| `userId` | ObjectId | ref: `User`; required: yes |
| `completionDate` | Date | required: yes |
| `status` | String | default: 'SUBMITTED'; enum: 'SUBMITTED' \\| 'COMPLETED' |
| `submittedAt` | Date | default: Date.now |
| `durationSeconds` | Number | default: 0 |
| `comment` | String | — |

- Indexes: `{ companyId: 1, taskId: 1, completionDate: 1 }`, `{ companyId: 1, userId: 1, completionDate: 1 }`, `{ companyId: 1, taskId: 1, userId: 1, completionDate: 1 }`

### `TaskInvitation`

Source: `models/tasks/taskInvitationModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes |
| `invitedUserId` | ObjectId | ref: `User`; required: yes |
| `invitedBy` | ObjectId | ref: `User`; required: yes |
| `status` | String | default: 'PENDING'; enum: 'PENDING' \\| 'ACCEPTED' \\| 'REJECTED' |
| `message` | String | — |
| `respondedAt` | Date | — |
| `rejectionReason` | String | — |
| `createdAt` | Date | default: Date.now |
| `updatedAt` | Date | default: Date.now |

- Indexes: `{ companyId: 1, taskId: 1, invitedUserId: 1, status: 1 }`, `{ invitedUserId: 1, status: 1 }`, `{ taskId: 1, status: 1 }`, `{ companyId: 1, createdAt: -1 }`

### `TaskStatusHistory`

Source: `models/tasks/taskStatusHistoryModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes; index |
| `fromStatus` | String | required: yes |
| `toStatus` | String | required: yes |
| `changedBy` | ObjectId | ref: `User`; required: yes |
| `reason` | String | — |
| `createdAt` | Date | default: Date.now |

- Indexes: `{ companyId: 1, taskId: 1, createdAt: -1 }`, `{ companyId: 1, changedBy: 1, createdAt: -1 }`, `{ companyId: 1, toStatus: 1, createdAt: -1 }`

### `TaskWorkSession`

Source: `models/tasks/taskWorkSessionModel.js`

| Field | Type | Constraints |
|---|---|---|
| `companyId` | ObjectId | ref: `User`; required: yes; index |
| `taskId` | ObjectId | ref: `Task`; required: yes |
| `userId` | ObjectId | ref: `User`; required: yes |
| `assignmentId` | ObjectId | ref: `TaskAssignment`; required: yes |
| `startedAt` | Date | required: yes |
| `stoppedAt` | Date | — |
| `durationSeconds` | Number | default: 0 |
| `status` | String | default: 'ACTIVE'; enum: 'ACTIVE' \\| 'STOPPED' \\| 'AUTO_STOPPED' \\| 'CANCELLED' |
| `startSource` | String | default: 'WEB'; enum: 'WEB' \\| 'MOBILE' \\| 'API' \\| 'ATTENDANCE_CHECKOUT' |
| `stopSource` | String | enum: 'USER' \\| 'SYSTEM' \\| 'ATTENDANCE_CHECKOUT' |
| `stopReason` | String | — |
| `createdAt` | Date | default: Date.now |
| `updatedAt` | Date | default: Date.now |

- Indexes: `{ companyId: 1, taskId: 1, userId: 1 }`, `{ companyId: 1, userId: 1, status: 1 }`, `{ companyId: 1, startedAt: -1 }`, `{ companyId: 1, status: 1 }`, `{ userId: 1, status: 1 }`, `{ companyId: 1, taskId: 1, status: 1 }`

### `User`

Source: `models/userModel.js`

| Field | Type | Constraints |
|---|---|---|
| `uid` | String | unique |
| `name` | String | required: no |
| `email` | String | — |
| `whatsapp_uid` | String | — |
| `password` | String | required: no |
| `suspend` | Boolean | default: false |
| `isVerified` | Boolean | default: false |
| `referalCode` | String | unique |
| `referrelCommisationType` | String | default: "fixed"; enum: "fixed" \\| "percentage" |
| `referrelCommisation` | Number | default: 0 |
| `referredBy` | String | default: null |
| `referaluseCount` | String | default: false |
| `isProfileCompleted` | Boolean | default: false |
| `type` | String | required: yes; default: 'user'; enum: 'user' \\| 'partner' \\| 'agency' \\| 'admin' \\| 'super_admin' |
| `data` | Mixed | required: no |
| `phone` | String | required: no |
| `profileImage` | String | required: no |
| `createdCouponsId` | [ObjectId] | ref: `Coupon`; default: [] |
| `devicetoken` | [String] | default: [] |
| `availedCouponsId` | Array | ref: `Coupon`; required: yes; default: Date.now; enum: 'ACTIVE' \\| 'EXPIRED' \\| 'REDEEMED' |
| `couponCount` | Number | required: yes; default: 5 |
| `manul_address` | String | index |
| `deviceId` | String | — |
| `corpareteUser` | Boolean | default: false |
| `permissions` | Array | — |
| `latestLocation` | Object | default: "Point"; enum: "Point" |
| `accountStatus` | String | default: "ACTIVE"; enum: "ACTIVE" \\| "SUSPENDED" \\| "PENDING_DELETION" \\| "DELETED"; index |
| `suspendedAt` | Date | default: null |
| `deletionRequestedAt` | Date | default: null |
| `scheduledDeletionAt` | Date | default: null; index |
| `deletedAt` | Date | default: null |
| `deletionReason` | String | default: null |
| `oauthProviders` | Object | — |
| `manageFeature` | Boolean | default: false |
| `googleId` | String | unique; index |
| `isGoogleVerified` | Boolean | default: false |
| `googleEmail` | String | — |
| `googleProfilePicture` | String | required: no |
| `authProvider` | String | default: 'local'; enum: 'local' \\| 'google' \\| 'whatsapp' \\| 'both' |
| `emailVerificationStatus` | String | default: 'pending'; enum: 'pending' \\| 'verified' \\| 'failed' \\| 'not_applicable' |
| `emailVerifiedAt` | Date | default: null |
| `createdBy` | ObjectId | ref: `User`; default: null |

- Hooks: `pre('save')`
- Indexes: `{ latestLocation: "2dsphere" }`

### `UserPlan`

Source: `models/UserPlan.js`

| Field | Type | Constraints |
|---|---|---|
| `userId` | ObjectId | ref: `User`; required: yes; index |
| `planId` | ObjectId | ref: `Plan`; required: yes |
| `status` | String | default: "active"; enum: "active" \\| "expired" \\| "used" \\| "cancelled" |
| `startedAt` | Date | default: Date.now |
| `expiresAt` | Date | — |
| `couponsAllowed` | Number | default: 0 |
| `couponsUsed` | Number | default: 0 |
| `lastUsedAt` | Date | — |
| `metadata` | Mixed | — |

- Indexes: `{ userId: 1, status: 1 }`
<!-- AUTO:END:models -->

---

## Business rules worth knowing

Add hand-written notes here, for example:

- Which collections are soft-deleted vs. hard-deleted.
- Which fields are denormalised and must be kept in sync.
- Indexes required for production performance.
- Migration / backfill history.

> Put notes **outside** the AUTO markers above.
