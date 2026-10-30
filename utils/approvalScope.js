import User from "../models/userModel.js";
import Employee from "../models/Attandance/Employee.js";
import AssingPermission, {
    normalizeDepartmentList
} from "../models/AssingPermission.js";

const APPROVAL_PERMISSION = "request.update";
const GLOBAL_TYPES = ["super_admin", "partner"];
const APPROVER_ROLES = ["admin", "manager", "hr"];
export const APPROVAL_SCOPE_TYPES = ["department", "departments", "company"];
export const DEFAULT_APPROVAL_SCOPE = Object.freeze({
    type: "department",
    departments: []
});

export const normalizeDepartment = (value) =>
    (value === undefined || value === null ? "" : String(value))
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

export const isSameDepartment = (a, b) => {
    const left = normalizeDepartment(a);
    const right = normalizeDepartment(b);
    return !!left && !!right && left === right;
};

export const isEligibleRole = (role) => APPROVER_ROLES.includes(role);

/**
 * Normalize a stored/raw approval scope into a safe, predictable shape.
 * Unknown or empty scopes fall back to the approver's own department.
 */
export const resolveApprovalScope = (raw) => {
    if (!raw) return { ...DEFAULT_APPROVAL_SCOPE };

    const type = typeof raw === "string" ? raw : raw.type;

    if (type === "company") {
        return { type: "company", departments: [] };
    }

    const departments = normalizeDepartmentList(
        typeof raw === "object" ? raw.departments : []
    );

    if (type === "departments" && departments.length > 0) {
        return { type: "departments", departments };
    }

    return { ...DEFAULT_APPROVAL_SCOPE };
};

/**
 * Check whether a requester's department falls inside the approver's scope.
 */
export const isDepartmentInScope = (
    approvalScope,
    approverDepartment,
    requesterDepartment
) => {
    const scope = resolveApprovalScope(approvalScope);

    if (scope.type === "company") {
        return true;
    }

    if (scope.type === "departments") {
        const requester = normalizeDepartment(requesterDepartment);
        return !!requester && scope.departments.some(
            (department) => normalizeDepartment(department) === requester
        );
    }

    return isSameDepartment(approverDepartment, requesterDepartment);
};

/**
 * Resolve the approver's company employee record + whether they are eligible
 * to approve attendance requests. Only partner/super_admin bypass this check;
 * hr/manager/admin employees must have an explicit request.update assignment,
 * which also supplies the department-wise approval scope.
 */
export const getApproverScope = async (req, companyId) => {
    const userId = req.user?.id || req.user?._id;
    const resolvedCompanyId = companyId || req.user?.companyId;

    if (!userId) {
        return { userId: null, companyId: resolvedCompanyId, eligible: false, reason: "Unauthorized" };
    }

    const user = await User.findById(userId).select("type accountStatus").lean();

    if (!user) {
        return {
            userId,
            companyId: resolvedCompanyId || null,
            userType: null,
            employee: null,
            department: null,
            eligible: false,
            reason: "User not found"
        };
    }

    if (user.accountStatus && user.accountStatus !== "ACTIVE") {
        return {
            userId,
            companyId: resolvedCompanyId || null,
            userType: user.type,
            employee: null,
            department: null,
            eligible: false,
            reason: "Account is not active"
        };
    }

    const isGlobal = GLOBAL_TYPES.includes(user?.type);

    if (isGlobal) {
        return {
            userId,
            companyId: resolvedCompanyId || null,
            userType: user?.type,
            employee: null,
            department: null,
            approvalScope: { type: "company", departments: [] },
            isGlobal: true,
            eligible: true,
            reason: null
        };
    }

    if (!resolvedCompanyId) {
        return {
            userId,
            companyId: null,
            userType: user?.type,
            employee: null,
            department: null,
            eligible: false,
            reason: "CompanyId required"
        };
    }

    const employee = await Employee.findOne({
        companyId: resolvedCompanyId,
        userId,
        employmentStatus: { $ne: "inactive" }
    })
        .select("role jobInfo.department")
        .lean();

    if (!employee) {
        return {
            userId,
            companyId: resolvedCompanyId,
            userType: user?.type,
            employee: null,
            department: null,
            eligible: false,
            reason: "Access denied: not part of company"
        };
    }

    if (!isEligibleRole(employee.role)) {
        return {
            userId,
            companyId: resolvedCompanyId,
            userType: user?.type,
            employee,
            department: employee?.jobInfo?.department ?? null,
            approvalScope: { ...DEFAULT_APPROVAL_SCOPE },
            eligible: false,
            reason: "Forbidden: insufficient permissions"
        };
    }

    const assignment = await AssingPermission.findOne({
        companyId: resolvedCompanyId,
        userId
    })
        .select("permissions approvalScope")
        .lean();

    const hasPermission = Array.isArray(assignment?.permissions)
        && assignment.permissions.includes(APPROVAL_PERMISSION);

    const approvalScope = resolveApprovalScope(assignment?.approvalScope);

    return {
        userId,
        companyId: resolvedCompanyId,
        userType: user?.type,
        employee,
        department: employee?.jobInfo?.department ?? null,
        approvalScope,
        eligible: hasPermission,
        reason: hasPermission ? null : "Forbidden: insufficient permissions"
    };
};

/**
 * Pure approval evaluation once the requester employee is known.
 * Rules: eligible permission, same company, not own request, in approval scope.
 */
export const evaluateApproval = (scope, request, requesterEmployee) => {
    if (!scope?.eligible) {
        return { allowed: false, reason: scope?.reason || "Forbidden: insufficient permissions" };
    }

    if (scope.isGlobal) {
        return { allowed: true, reason: null };
    }

    if (!scope.companyId || String(request.companyId) !== String(scope.companyId)) {
        return { allowed: false, reason: "Access denied: request belongs to another company" };
    }

    if (!scope.employee?._id) {
        return { allowed: false, reason: "Access denied: approver employee record not found" };
    }

    const requesterId = request.employeeId?._id || request.employeeId;

    if (!requesterId) {
        return { allowed: false, reason: "Requester employee record not found" };
    }

    if (String(requesterId) === String(scope.employee._id)) {
        return { allowed: false, reason: "You cannot approve your own leave request" };
    }

    if (!requesterEmployee) {
        return { allowed: false, reason: "Requester employee record not found" };
    }

    const requesterDepartment = requesterEmployee.jobInfo?.department ?? null;
    const approvalScope = resolveApprovalScope(scope.approvalScope);

    if (!isDepartmentInScope(approvalScope, scope.department, requesterDepartment)) {
        return {
            allowed: false,
            reason: approvalScope.type === "departments"
                ? "You can only approve leave requests from the departments assigned to you"
                : "You can only approve leave requests from your own department"
        };
    }

    return { allowed: true, reason: null };
};

/**
 * Resolve the employee ids an approver may act on.
 * Returns null when the scope is company-wide (no employee restriction).
 */
export const getApprovalScopeEmployeeIds = async (scope, companyId) => {
    if (!scope?.eligible) return [];
    if (scope.isGlobal) return null;

    const approvalScope = resolveApprovalScope(scope.approvalScope);
    if (approvalScope.type === "company") return null;

    const targetDepartments = approvalScope.type === "departments"
        ? approvalScope.departments
        : [scope.department];

    const normalizedTargets = targetDepartments
        .map(normalizeDepartment)
        .filter(Boolean);

    if (normalizedTargets.length === 0) return [];

    const companyDepartments = await Employee.distinct("jobInfo.department", {
        companyId
    });
    const matchedDepartments = companyDepartments.filter(
        (value) => normalizedTargets.includes(normalizeDepartment(value))
    );

    if (matchedDepartments.length === 0) return [];

    return Employee.distinct("_id", {
        companyId,
        "jobInfo.department": { $in: matchedDepartments }
    });
};

/**
 * Check whether the approver may act on this specific request.
 * Loads the requester employee when it is not already supplied.
 */
export const canApproveRequest = async (scope, request, options = {}) => {
    const { session = null, requester = null } = options;

    // Validate the cheap conditions before touching the database.
    const preCheck = evaluateApproval(scope, request, requester);
    if (!preCheck.allowed && preCheck.reason !== "Requester employee record not found") {
        return preCheck;
    }

    if (!requester) {
        const requesterId = request.employeeId?._id || request.employeeId;
        if (!requesterId) {
            return preCheck;
        }

        let query = Employee.findById(requesterId).select("jobInfo.department");
        if (session) query = query.session(session);
        const requesterEmployee = await query.lean();

        if (!requesterEmployee) {
            return preCheck;
        }

        return evaluateApproval(scope, request, requesterEmployee);
    }

    return preCheck;
};

export default {
    normalizeDepartment,
    isSameDepartment,
    isEligibleRole,
    resolveApprovalScope,
    isDepartmentInScope,
    getApproverScope,
    getApprovalScopeEmployeeIds,
    evaluateApproval,
    canApproveRequest
};
