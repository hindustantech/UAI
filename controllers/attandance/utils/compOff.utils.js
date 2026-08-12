// controllers/attandance/utils/compOff.utils.js
import SalaryRule from "../../../models/salaryRules.js";
import Employee from "../../../models/Attandance/Employee.js";

/*
    Get the company comp-off rule (per company).
    Returns { enabled, expireAfterDays } with defaults.
*/
export const getCompOffRule = async (companyId) => {
    const rule = await SalaryRule.findOne({ companyId }).lean();
    const compOff = rule?.compOff || {};
    return {
        enabled: compOff.enabled !== false,
        expireAfterDays: compOff.expireAfterDays ?? 90
    };
};

/*
    Expire credits older than expireAfterDays (lazy check).
    expireAfterDays <= 0 (or rule disabled) means never expire.
    Mutates the employee doc and persists it if anything was removed.
*/
export const expireCompOff = async (employee, expireAfterDays) => {
    if (!employee || expireAfterDays <= 0) return { removedDays: 0 };

    const credits = employee.compOff?.credits || [];
    if (!credits.length) return { removedDays: 0 };

    const cutoff = Date.now() - expireAfterDays * 86400000;
    let removedDays = 0;
    const valid = [];

    for (const c of credits) {
        const earnedAt = c.earnedAt ? new Date(c.earnedAt).getTime() : Date.now();
        if (earnedAt < cutoff) {
            removedDays += c.days || 0;
        } else {
            valid.push(c);
        }
    }

    if (removedDays > 0) {
        employee.compOff.credits = valid;
        employee.compOff.balance = Math.max(0, (employee.compOff.balance || 0) - removedDays);
        await employee.save();
    }

    return { removedDays };
};

/*
    FIFO deduction of comp-off days (oldest credits first).
    Mutates the employee doc — caller must save().
*/
export const deductCompOffFIFO = (employee, days) => {
    if (!days || days <= 0) return;

    const credits = employee.compOff?.credits || [];
    let remaining = days;
    const updated = [];

    for (const c of credits) {
        if (remaining <= 0) {
            updated.push(c);
            continue;
        }
        const cDays = c.days || 0;
        if (cDays <= remaining) {
            remaining -= cDays;
        } else {
            updated.push({ ...c.toObject ? c.toObject() : c, days: cDays - remaining });
            remaining = 0;
        }
    }

    employee.compOff.credits = updated;
    employee.compOff.balance = Math.max(0, (employee.compOff.balance || 0) - days);
};

/*
    Load employee + apply lazy expiry + return { employee, balance }.
    Used by request create/salary/report flows.
*/
export const getEmployeeCompOff = async (employeeId, companyId) => {
    const rule = await getCompOffRule(companyId);
    const employee = await Employee.findById(employeeId);
    if (!employee) return null;

    if (rule.enabled && rule.expireAfterDays > 0) {
        await expireCompOff(employee, rule.expireAfterDays);
    }

    return {
        employee,
        balance: employee.compOff?.balance || 0,
        expireAfterDays: rule.enabled ? rule.expireAfterDays : 0
    };
};
