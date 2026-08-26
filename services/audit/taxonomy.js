/**
 * Audit Event Taxonomy — derives operation, eventType, and severity
 * from the composite action string (e.g. "EMPLOYEE.UPDATE").
 *
 * Every logApiAction / logApiError call flows through this mapping so
 * that investigation queries can filter by operation/eventType/severity
 * without relying on fragile string parsing at query time.
 */

/* ────────────────────────────────────────────────────────────────
   REGISTRY:  action prefix  →  { eventType, operation, severity }
   ──────────────────────────────────────────────────────────────── */

const TAU = Object.create(null);

const register = (prefix, eventType, operation, severity = 'INFO') => {
    TAU[prefix.toUpperCase()] = { eventType, operation, severity };
};

/* — Authentication ───────────────────────────────────────────── */
register('AUTH',                'SECURITY',   'OTHER',      'WARNING');
register('AUTH.LOGIN',         'SECURITY',   'LOGIN');
register('AUTH.LOGOUT',        'SECURITY',   'LOGOUT');
register('AUTH.LOGIN_FAILED',  'SECURITY',   'LOGIN',      'WARNING');
register('AUTH.PASSWORD_CHANGED',   'SECURITY', 'OTHER');
register('AUTH.PASSWORD_RESET',     'SECURITY', 'OTHER');
register('AUTH.TOKEN_REFRESH',      'SECURITY', 'OTHER');
register('AUTH.ACCOUNT_LOCKED',     'SECURITY', 'OTHER',    'CRITICAL');
register('AUTH.ACCOUNT_UNLOCKED',   'SECURITY', 'OTHER');

/* — Employee ─────────────────────────────────────────────────── */
register('EMPLOYEE.CREATE',       'WRITE', 'CREATE');
register('EMPLOYEE.UPDATE',       'WRITE', 'UPDATE');
register('EMPLOYEE.DELETE',       'WRITE', 'DELETE');
register('EMPLOYEE.ACTIVATE',     'WRITE', 'ACTIVATE');
register('EMPLOYEE.DEACTIVATE',   'WRITE', 'DEACTIVATE');
register('EMPLOYEE.STATUS_CHANGE','WRITE', 'UPDATE');

/* — User ─────────────────────────────────────────────────────── */
register('USER.CREATE',            'WRITE', 'CREATE');
register('USER.UPDATE',            'WRITE', 'UPDATE');
register('USER.DELETE',            'WRITE', 'DELETE');
register('USER.ACTIVATE',          'WRITE', 'ACTIVATE');
register('USER.DEACTIVATE',        'WRITE', 'DEACTIVATE');
register('USER.ROLE_CHANGE',       'SECURITY', 'UPDATE', 'WARNING');
register('USER.PERMISSION_CHANGE', 'SECURITY', 'UPDATE', 'WARNING');

/* — Shift ────────────────────────────────────────────────────── */
register('SHIFT.CREATE',    'WRITE',   'CREATE');
register('SHIFT.UPDATE',    'WRITE',   'UPDATE');
register('SHIFT.DELETE',    'WRITE',   'DELETE');
register('SHIFT.ACTIVATE',  'WRITE',   'ACTIVATE');
register('SHIFT.DEACTIVATE','WRITE',   'DEACTIVATE');
register('SHIFT.GET_LIST',  'READ',    'READ');
register('SHIFT.GET_DETAIL','READ',    'READ');

/* — Attendance ───────────────────────────────────────────────── */
register('ATTENDANCE.CREATE',       'WRITE',   'CREATE');
register('ATTENDANCE.UPDATE',       'WRITE',   'UPDATE');
register('ATTENDANCE.DELETE',       'WRITE',   'DELETE');
register('ATTENDANCE.MARK',         'WRITE',   'CREATE');
register('ATTENDANCE.MANUAL_MARK',  'WRITE',   'CREATE');
register('ATTENDANCE.CORRECTION',   'WRITE',   'UPDATE');
register('ATTENDANCE.APPROVE',      'WRITE',   'APPROVE');
register('ATTENDANCE.REJECT',       'WRITE',   'REJECT');
register('ATTENDANCECREATE_START',  'WRITE',   'CREATE');
register('ATTENDANCECREATE_SUCCESS','WRITE',   'CREATE');
register('ATTENDANCEFETCH_EMPLOYEE','READ',    'READ');
register('ATTENDANCEAPPROVE',       'WRITE',   'APPROVE');
register('ATTENDANCEREJECT',        'WRITE',   'REJECT');
register('ATTENDANCECANCEL',        'WRITE',   'UPDATE');
register('ATTENDANCEUPDATE',        'WRITE',   'UPDATE');
register('ATTENDANCEBULK_APPROVE',  'WRITE',   'APPROVE');
register('ATTENDANCEGET_STATISTICS','READ',    'READ');

/* — Payroll ──────────────────────────────────────────────────── */
register('PAYROLL.CREATE',        'FINANCIAL', 'CREATE');
register('PAYROLL.UPDATE',        'FINANCIAL', 'UPDATE');
register('PAYROLL.DELETE',        'FINANCIAL', 'DELETE');
register('PAYROLL.PROCESS',       'FINANCIAL', 'PROCESS');
register('PAYROLL.APPROVE',       'FINANCIAL', 'APPROVE');
register('PAYROLL.REJECT',        'FINANCIAL', 'REJECT');
register('PAYROLL.PAYMENT',       'FINANCIAL', 'PAYMENT');
register('PAYROLL.PAYMENT_FAILED','FINANCIAL', 'PAYMENT', 'CRITICAL');
register('PAYROLL.SALARY_UPDATE', 'FINANCIAL', 'UPDATE');

/* — Leave ────────────────────────────────────────────────────── */
register('LEAVE.CREATE',   'WRITE', 'CREATE');
register('LEAVE.UPDATE',   'WRITE', 'UPDATE');
register('LEAVE.CANCEL',   'WRITE', 'UPDATE');
register('LEAVE.APPROVE',  'WRITE', 'APPROVE');
register('LEAVE.REJECT',   'WRITE', 'REJECT');

/* — Payment / Refund ─────────────────────────────────────────── */
register('PAYMENT.CREATE',         'FINANCIAL', 'CREATE');
register('PAYMENT.UPDATE',         'FINANCIAL', 'UPDATE');
register('PAYMENT.DELETE',         'FINANCIAL', 'DELETE');
register('PAYMENT.SUCCESS',        'FINANCIAL', 'PAYMENT');
register('PAYMENT.FAILED',         'FINANCIAL', 'PAYMENT', 'CRITICAL');
register('PAYMENT.CREATE_ORDER',   'FINANCIAL', 'CREATE');
register('PAYMENT.VERIFY_PAYMENT', 'FINANCIAL', 'PROCESS');
register('PAYMENT.CREATE_MANUAL',  'FINANCIAL', 'CREATE');
register('PAYMENT.CANCEL',         'FINANCIAL', 'UPDATE');
register('REFUND.CREATE',          'FINANCIAL', 'CREATE');
register('REFUND.UPDATE',          'FINANCIAL', 'UPDATE');
register('REFUND.SUCCESS',         'FINANCIAL', 'PAYMENT');
register('REFUND.FAILED',          'FINANCIAL', 'PAYMENT', 'CRITICAL');

/* — Organization ─────────────────────────────────────────────── */
register('ORGANIZATION.CREATE',     'WRITE', 'CREATE');
register('ORGANIZATION.UPDATE',     'WRITE', 'UPDATE');
register('ORGANIZATION.ACTIVATE',   'WRITE', 'ACTIVATE');
register('ORGANIZATION.DEACTIVATE', 'WRITE', 'DEACTIVATE');

/* — Subscription / Plan ──────────────────────────────────────── */
register('SUBSCRIPTION.CREATE',         'FINANCIAL', 'CREATE');
register('SUBSCRIPTION.ACTIVE',         'FINANCIAL', 'ACTIVATE');
register('SUBSCRIPTION.UPDATE',         'FINANCIAL', 'UPDATE');
register('SUBSCRIPTION.CANCEL',         'FINANCIAL', 'UPDATE');
register('SUBSCRIPTION.TOGGLE_STATUS',  'WRITE',     'UPDATE');
register('PLAN.CREATE',                 'WRITE',     'CREATE');
register('PLAN.UPDATE',                 'WRITE',     'UPDATE');
register('PLAN.DELETE',                 'WRITE',     'DELETE');

/* — AttendanceRequest (controller uses dot-separated action) ─── */
register('ATTENDANCEREQUEST.CREATE_START',   'WRITE',   'CREATE');
register('ATTENDANCEREQUEST.CREATE_SUCCESS', 'WRITE',   'CREATE');
register('ATTENDANCEREQUEST.APPROVE',        'WRITE',   'APPROVE');
register('ATTENDANCEREQUEST.REJECT',         'WRITE',   'REJECT');
register('ATTENDANCEREQUEST.CANCEL',         'WRITE',   'UPDATE');
register('ATTENDANCEREQUEST.UPDATE',         'WRITE',   'UPDATE');
register('ATTENDANCEREQUEST.BULK_APPROVE',   'WRITE',   'APPROVE');

/* — SalaryRule / PricingRule / PayrollRule ───────────────────── */
register('SALARYRULE.CREATE',  'WRITE',     'CREATE');
register('SALARYRULE.UPDATE',  'WRITE',     'UPDATE');
register('SALARYRULE.DELETE',  'WRITE',     'DELETE');
register('SALARYRULE.GET',     'READ',      'READ');
register('SALARYRULE.GET_LIST','READ',      'READ');
register('SALARYRULE.GET_COMPANY','READ',   'READ');
register('PRICINGRULE.CREATE', 'WRITE',     'CREATE');
register('PRICINGRULE.UPDATE', 'WRITE',     'UPDATE');
register('PRICINGRULE.DELETE', 'WRITE',     'DELETE');
register('PRICINGRULE.GET',    'READ',      'READ');
register('PRICINGRULE.GET_LIST','READ',     'READ');
register('PAYROLLRULE.CREATE', 'WRITE',     'CREATE');
register('PAYROLLRULE.UPDATE', 'WRITE',     'UPDATE');
register('PAYROLLRULE.DELETE', 'WRITE',     'DELETE');
register('PAYROLLRULE.GET',    'READ',      'READ');
register('PAYROLLRULE.GET_LIST','READ',     'READ');
register('PAYROLLRULE.TOGGLE_STATUS','WRITE','UPDATE');

/* — Cron events ──────────────────────────────────────────────── */
register('CRON',       'SYSTEM', 'OTHER');
register('CRON.STATUS','SYSTEM', 'OTHER');

/* — Audit administration ─────────────────────────────────────── */
register('AUDIT.EVENT_DEACTIVATED', 'SECURITY', 'UPDATE', 'CRITICAL');
register('AUDIT.EXPORT',            'READ',     'EXPORT');

/* ────────────────────────────────────────────────────────────────
   HEURISTIC FALLBACKS for legacy/unregistered action strings
   ──────────────────────────────────────────────────────────────── */

const READ_SUFFIXES = [
    'GET_LIST', 'GET_DETAIL', 'GET', 'FETCH', 'SEARCH', 'LIST',
    'GET_STATISTICS', 'GET_ALL', 'GET_BY', 'FIND', 'EXPORT',
    'GET_COMPANY',
];
const WRITE_CREATE = ['CREATE', 'INSERT', 'ADD', 'NEW', 'IMPORT'];
const WRITE_UPDATE = ['UPDATE', 'EDIT', 'MODIFY', 'CHANGE', 'PATCH', 'TOGGLE_STATUS', 'SAVE', 'BULK_APPROVE'];
const WRITE_DELETE = ['DELETE', 'REMOVE', 'DESTROY', 'DROP'];
const WRITE_ACTIVATE = ['ACTIVATE', 'ENABLE', 'OPEN'];
const WRITE_DEACTIVATE = ['DEACTIVATE', 'DISABLE', 'CLOSE', 'CANCEL'];
const FINANCIAL_OPS = ['PAYMENT', 'PAY', 'TRANSFER', 'REFUND', 'CHARGE', 'BILL', 'PAYOUT', 'COLLECT'];

/**
 * Derive operation / eventType / severity from a full action string.
 *
 * @param {string} action  e.g. "EMPLOYEE.UPDATE", "SHIFT.GET_LIST", "UNKNOWN.WHATEVER"
 * @returns {{ eventType: string, operation: string, severity: string }}
 */
export const deriveFromAction = (action) => {
    if (!action || typeof action !== 'string') {
        return { eventType: 'WRITE', operation: 'OTHER', severity: 'INFO' };
    }

    const normalized = action.toUpperCase().trim();

    // 1. Exact match in registry (fast path)
    if (TAU[normalized]) return { ...TAU[normalized] };

    // 2. Fallback: split on first dot, inspect the suffix
    const dotIdx = normalized.lastIndexOf('.');
    const suffix = dotIdx >= 0 ? normalized.slice(dotIdx + 1) : normalized;

    if (READ_SUFFIXES.includes(suffix)) {
        return { eventType: 'READ', operation: 'READ', severity: 'INFO' };
    }
    if (WRITE_CREATE.some(s => suffix.includes(s))) {
        return { eventType: 'WRITE', operation: 'CREATE', severity: 'INFO' };
    }
    if (WRITE_UPDATE.some(s => suffix.includes(s))) {
        return { eventType: 'WRITE', operation: 'UPDATE', severity: 'INFO' };
    }
    if (WRITE_DELETE.some(s => suffix.includes(s))) {
        return { eventType: 'WRITE', operation: 'DELETE', severity: 'WARNING' };
    }
    if (WRITE_ACTIVATE.some(s => suffix.includes(s))) {
        return { eventType: 'WRITE', operation: 'ACTIVATE', severity: 'INFO' };
    }
    if (WRITE_DEACTIVATE.some(s => suffix.includes(s))) {
        return { eventType: 'WRITE', operation: 'DEACTIVATE', severity: 'WARNING' };
    }
    if (FINANCIAL_OPS.some(s => suffix.includes(s))) {
        return { eventType: 'FINANCIAL', operation: 'PAYMENT', severity: 'INFO' };
    }

    return { eventType: 'WRITE', operation: 'OTHER', severity: 'INFO' };
};

/**
 * Explicit derivation helpers — called at write time by apiLogger.
 */
export const deriveOperation = (action) => deriveFromAction(action).operation;
export const deriveEventType = (action) => deriveFromAction(action).eventType;
export const deriveSeverity  = (action) => deriveFromAction(action).severity;
