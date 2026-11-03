import test from "node:test";
import assert from "node:assert/strict";

import {
    buildAttendanceLedger,
    getMonthDays,
    toDateKey,
} from "../../services/payroll/attendanceLedger.service.js";

/* ───────────────────────── helpers ───────────────────────── */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function makeEmployee(overrides = {}) {
    return {
        _id: "emp-1",
        companyId: "company-1",
        weeklyOff: ["Sunday"],
        weeklyOffHalfDay: [],
        jobInfo: {},
        ...overrides,
    };
}

function dt(year, month, day) {
    return new Date(year, month - 1, day);
}

function present(year, month, day, extra = {}) {
    return {
        employeeId: "emp-1",
        date: dt(year, month, day),
        status: "present",
        workSummary: {
            totalMinutes: 480,
            payableMinutes: 480,
            overtimeMinutes: 0,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
        },
        ...extra,
    };
}

function record(year, month, day, status, extra = {}) {
    return {
        employeeId: "emp-1",
        date: dt(year, month, day),
        status,
        workSummary: {
            totalMinutes: 0,
            payableMinutes: 0,
            overtimeMinutes: 0,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
        },
        ...extra,
    };
}

function leave(year, month, startDay, endDay, { paid = true, isHalfDay = false, days } = {}) {
    const leaveTypeId = paid
        ? { _id: "lt-paid", name: "Casual Leave", code: "CL", paid: true }
        : { _id: "lt-unpaid", name: "Leave Without Pay", code: "LWP", paid: false };

    return {
        _id: `req-${month}-${startDay}-${endDay}`,
        employeeId: "emp-1",
        companyId: "company-1",
        requestType: "leave",
        status: "approved",
        leaveTypeId,
        isPaid: paid,
        isHalfDay,
        leaveDays: days ?? (isHalfDay ? 0.5 : endDay - startDay + 1),
        leaveDetails: {
            startDate: dt(year, month, startDay),
            endDate: dt(year, month, endDay),
        },
    };
}

function allWorkdaysPresent(year, month, skipDays = []) {
    const total = getMonthDays(month, year);
    const skip = new Set(skipDays);
    const records = [];

    for (let day = 1; day <= total; day++) {
        const dow = WEEKDAYS[dt(year, month, day).getDay()];
        if (dow === "Sunday") continue;
        if (skip.has(day)) continue;
        records.push(present(year, month, day));
    }

    return records;
}

function weekdayRecords(year, month) {
    const total = getMonthDays(month, year);
    const records = [];

    for (let day = 1; day <= total; day++) {
        const dow = WEEKDAYS[dt(year, month, day).getDay()];
        if (dow === "Saturday" || dow === "Sunday") continue;
        records.push(present(year, month, day));
    }

    return records;
}

/* ───────────────────────── month lengths ───────────────────────── */

test("getMonthDays returns actual calendar days", () => {
    assert.equal(getMonthDays(1, 2026), 31);
    assert.equal(getMonthDays(2, 2026), 28);
    assert.equal(getMonthDays(2, 2028), 29);
    assert.equal(getMonthDays(4, 2026), 30);
    assert.equal(getMonthDays(12, 2026), 31);
});

test("toDateKey is timezone safe", () => {
    assert.equal(toDateKey(dt(2026, 2, 3)), "2026-02-03");
});

/* ───────────────────────── leave rules ───────────────────────── */

test("paid leave never creates LOP", async () => {
    // Feb 2026 has 28 days and four Sundays (1, 8, 15, 22).
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: allWorkdaysPresent(2026, 2, [10, 11]),
            leaveRequests: [leave(2026, 2, 10, 11, { paid: true })],
        },
    });

    assert.equal(ledger.standardDays, 28);
    assert.equal(ledger.weeklyOffDays, 4);
    assert.equal(ledger.paidLeaveDays, 2);
    assert.equal(ledger.unpaidLeaveDays, 0);
    assert.equal(ledger.absentDays, 0);
    assert.equal(ledger.lopDays, 0);
    assert.equal(ledger.payableDays, 28);
    assert.deepEqual(ledger.leaveBreakdown, [
        {
            leaveTypeId: "lt-paid",
            leaveTypeName: "Casual Leave",
            leaveTypeCode: "CL",
            paid: true,
            days: 2,
        },
    ]);
});

test("unpaid leave creates LOP", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: allWorkdaysPresent(2026, 2, [10, 11]),
            leaveRequests: [leave(2026, 2, 10, 11, { paid: false })],
        },
    });

    assert.equal(ledger.paidLeaveDays, 0);
    assert.equal(ledger.unpaidLeaveDays, 2);
    assert.equal(ledger.lopDays, 2);
    assert.equal(ledger.payableDays, 26);
});

test("unpaid half-day counts as 0.5 LOP", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: [
                ...allWorkdaysPresent(2026, 2, [5]),
                record(2026, 2, 5, "half_day"),
            ],
        },
    });

    assert.equal(ledger.halfDays, 1);
    assert.equal(ledger.presentDays, 23.5);
    assert.equal(ledger.unpaidHalfDays, 0.5);
    assert.equal(ledger.lopDays, 0.5);
});

test("paid half-day leave covers the unpaid half of a half-day record", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: [
                ...allWorkdaysPresent(2026, 2, [5]),
                record(2026, 2, 5, "half_day"),
            ],
            leaveRequests: [leave(2026, 2, 5, 5, { paid: true, isHalfDay: true })],
        },
    });

    assert.equal(ledger.halfDays, 1);
    assert.equal(ledger.paidLeaveDays, 0.5);
    assert.equal(ledger.unpaidHalfDays, 0);
    assert.equal(ledger.lopDays, 0);
});

test("half-day leave without attendance record is payable for the other half", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: allWorkdaysPresent(2026, 2, [5]),
            leaveRequests: [leave(2026, 2, 5, 5, { paid: true, isHalfDay: true })],
        },
    });

    assert.equal(ledger.paidLeaveDays, 0.5);
    assert.equal(ledger.presentDays, 23.5);
    assert.equal(ledger.payableDays, 28);
    assert.equal(ledger.lopDays, 0);
});

/* ─────────────────────── holidays / weekly offs ─────────────────── */

test("holiday is paid and never marked absent", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: allWorkdaysPresent(2026, 2, [12]),
            holidays: [{ companyId: "company-1", date: dt(2026, 2, 12), applicableTo: {} }],
        },
    });

    assert.equal(ledger.holidays, 1);
    assert.equal(ledger.absentDays, 0);
    assert.equal(ledger.lopDays, 0);
    assert.equal(ledger.payableDays, 28);
});

test("weekly offs are paid and missing working days are absent", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {},
    });

    assert.equal(ledger.weeklyOffDays, 4);
    assert.equal(ledger.absentDays, 24);
    assert.equal(ledger.lopDays, 24);
});

test("half-day weekly off counts as half a paid day", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee({ weeklyOffHalfDay: ["Saturday"] }),
        month: 2,
        year: 2026,
        data: { records: weekdayRecords(2026, 2) },
    });

    assert.equal(ledger.weeklyOffDays, 4);
    assert.equal(ledger.weeklyOffHalfDays, 4);
    // 20 weekdays worked + 4 Sundays + 2 (four half Saturdays) = 26.
    assert.equal(ledger.payableDays, 26);
});

/* ───────────────────── employment window ───────────────────── */

test("mid-month joiner is not marked absent before joining date", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee({ jobInfo: { joiningDate: dt(2026, 2, 16) } }),
        month: 2,
        year: 2026,
        data: {},
    });

    assert.equal(ledger.employmentCalendarDays, 13);
    assert.equal(ledger.prorationDays, 15);
    assert.equal(ledger.weeklyOffDays, 1); // Sunday 22 Feb
    assert.equal(ledger.absentDays, 12);
});

test("mid-month exit is not marked absent after deactivation", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee({ deactivatedAt: dt(2026, 2, 15) }),
        month: 2,
        year: 2026,
        data: {},
    });

    assert.equal(ledger.employmentCalendarDays, 15);
    assert.equal(ledger.prorationDays, 13);
    assert.equal(ledger.weeklyOffDays, 3); // Sundays 1, 8, 15
    assert.equal(ledger.absentDays, 12);
});

test("employee outside the pay period yields zero employment days", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee({ jobInfo: { joiningDate: dt(2026, 5, 1) } }),
        month: 2,
        year: 2026,
        data: {},
    });

    assert.equal(ledger.employmentCalendarDays, 0);
    assert.equal(ledger.prorationDays, 28);
    assert.equal(ledger.payableDays, 0);
});

test("29-day leap February uses 29 standard days", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2028,
        data: { records: allWorkdaysPresent(2028, 2) },
    });

    assert.equal(ledger.standardDays, 29);
});

test("31-day month uses 31 standard days", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 1,
        year: 2026,
        data: { records: allWorkdaysPresent(2026, 1) },
    });

    assert.equal(ledger.standardDays, 31);
});

/* ───────────────────── overtime aggregation ───────────────────── */

test("overtime is summed only for working days", async () => {
    const ledger = await buildAttendanceLedger({
        employee: makeEmployee(),
        month: 2,
        year: 2026,
        data: {
            records: [
                ...allWorkdaysPresent(2026, 2, [5]),
                present(2026, 2, 5, {
                    workSummary: {
                        totalMinutes: 540,
                        payableMinutes: 480,
                        overtimeMinutes: 60,
                        lateMinutes: 10,
                        earlyLeaveMinutes: 0,
                    },
                }),
            ],
        },
    });

    assert.equal(ledger.overtimeMinutes, 60);
    assert.equal(ledger.lateDays, 1);
});
