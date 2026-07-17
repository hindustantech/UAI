import Employee from "../../../models/Attandance/Employee.js";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";               // adjust path
import Attendance from "../../../models/Attandance/Attendance.js";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/* ============================================================
   SHARED HELPERS
============================================================ */

// Escapes a single CSV value (handles commas, quotes, newlines)
const csvEscape = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

// Converts an array of flat objects into a CSV string
const buildCsv = (rows) => {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);

    let csv = headers.join(",") + "\n";
    rows.forEach((row) => {
        csv += headers.map((h) => csvEscape(row[h])).join(",") + "\n";
    });

    return csv;
};

// Sends a CSV string as a downloadable file
const sendCsv = (res, csvString, fileName) => {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    return res.status(200).send(csvString);
};

// Resolves { start, end } from query params, defaulting to the current month
const getDateRange = (query) => {
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const start = query.startDate ? new Date(query.startDate) : defaultStart;
    const end = query.endDate ? new Date(query.endDate) : defaultEnd;
    end.setHours(23, 59, 59, 999);

    return { start, end };
};

// "2026-07-15" -> "2026-07"
const getMonthKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// "2026-07" -> "2026-08"
const getNextMonthKey = (monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    const next = new Date(year, month, 1); // month is already 1-indexed here, so this rolls forward
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
};

// "2026-07" -> "July 2026"
const monthLabel = (yyyyMM) => {
    if (!yyyyMM) return "";
    const [year, month] = yyyyMM.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("en-US", { month: "long", year: "numeric" });
};

const safeDiv = (numerator, denominator) => (denominator ? numerator / denominator : 0);
const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// Builds { userId -> { empCode, name } } and { employeeMongoId -> userId }
const loadEmployeeMaps = async (companyId) => {
    const employees = await Employee.find({ companyId }).populate("userId", "name").lean();

    const employeeByUserId = new Map();
    const employeeMongoIdToUserId = new Map();

    employees.forEach((emp) => {
        const uid = (emp.userId?._id || emp.userId)?.toString();
        if (!uid) return;

        employeeByUserId.set(uid, {
            empCode: emp.empCode || "",
            name: emp.user_name || emp.userId?.name || "Unknown"
        });
        employeeMongoIdToUserId.set(emp._id.toString(), uid);
    });

    return { employeeByUserId, employeeMongoIdToUserId };
};

/* ============================================================
   MAIN REPORT: EMPLOYEE MONTHLY PERFORMANCE
   GET /reports/employee-monthly?companyId=&startDate=&endDate=
============================================================ */
export const exportEmployeeMonthlyReport = async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, message: "companyId is required" });
        }

        const { start, end } = getDateRange(req.query);
        const { employeeByUserId, employeeMongoIdToUserId } = await loadEmployeeMaps(companyId);

        /* ---------- Attendance: working days / present days / field hours ---------- */
        const attendanceRecords = await Attendance.find({
            companyId,
            date: { $gte: start, $lte: end }
        }).lean();

        // key = `${userId}_${YYYY-MM}`
        const attendanceMap = new Map();
        attendanceRecords.forEach((rec) => {
            const userId = employeeMongoIdToUserId.get(rec.employeeId?.toString());
            if (!userId) return;

            const month = getMonthKey(rec.date);
            const key = `${userId}_${month}`;

            if (!attendanceMap.has(key)) {
                attendanceMap.set(key, { workingDays: 0, presentDays: 0, totalFieldHours: 0 });
            }
            const bucket = attendanceMap.get(key);

            if (!["week_off", "holiday"].includes(rec.status)) bucket.workingDays += 1;
            if (["present", "half_day"].includes(rec.status)) bucket.presentDays += 1;
            bucket.totalFieldHours += rec.totalWorkingHours || 0;
        });

        /* ---------- Sales sessions: visits, customers, revenue, calls ---------- */
        const sessions = await SalesSession.find({
            companyId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        // key = `${userId}_${YYYY-MM}`
        const groups = new Map();

        sessions.forEach((session) => {
            const userId = session.employeeId?.toString();
            if (!userId) return; // skip sessions with no field employee attached

            const month = getMonthKey(session.createdAt);
            const key = `${userId}_${month}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    userId,
                    month,
                    totalVisits: 0,
                    typeCounts: { retail: 0, wholesale: 0, corporate: 0, customer: 0, agent: 0 },
                    openAccounts: 0,
                    closeAccounts: 0,
                    closingAccounts: 0,
                    paidCases: 0,
                    totalAmount: 0,
                    totalCallHours: 0,
                    appointmentsNextMonth: 0,
                    customerVisitCounts: new Map() // customerKey -> visit count
                });
            }

            const g = groups.get(key);
            const customer = session.customer || {};

            g.totalVisits += 1;

            const custType = customer.type || "customer";
            if (g.typeCounts[custType] !== undefined) g.typeCounts[custType] += 1;

            const isActive = customer.isActive !== false;
            if (isActive) g.openAccounts += 1; else g.closeAccounts += 1;

            if (session.SalesStatus === "closed") g.closingAccounts += 1;

            const logs = session.salesLogs || [];
            if (logs.some((log) => log.paymentCollected)) g.paidCases += 1;
            g.totalAmount += logs.reduce((sum, log) => sum + (log.amount || 0), 0);

            // Call/visit duration in hours
            let callHours = 0;
            if (session.punchInTime && session.punchOutTime) {
                callHours = (new Date(session.punchOutTime) - new Date(session.punchInTime)) / (1000 * 60 * 60);
            } else if (session.duration) {
                callHours = session.duration / 60; // assumes `duration` is stored in minutes
            }
            g.totalCallHours += callHours;

            // Appointment scheduled for the month right after this session's month
            if (session?.nextMeeting?.decided && session.nextMeeting.date) {
                const nextMonthKey = getNextMonthKey(month);
                if (getMonthKey(session.nextMeeting.date) === nextMonthKey) {
                    g.appointmentsNextMonth += 1;
                }
            }

            // Track visits per customer to classify New vs Repeat later
            const customerKey = customer.phoneNumber || customer.customerId || customer.contactName;
            if (customerKey) {
                g.customerVisitCounts.set(customerKey, (g.customerVisitCounts.get(customerKey) || 0) + 1);
            }
        });

        /* ---------- Build final rows ---------- */
        const rows = [];
        groups.forEach((g) => {
            const empInfo = employeeByUserId.get(g.userId) || { empCode: "", name: "Unknown" };
            const att = attendanceMap.get(`${g.userId}_${g.month}`) || { workingDays: 0, presentDays: 0, totalFieldHours: 0 };

            let newCalls = 0, repeatCalls = 0;
            g.customerVisitCounts.forEach((count) => {
                if (count === 1) newCalls += 1; else repeatCalls += 1;
            });

            rows.push({
                month: monthLabel(g.month),
                exportedFrom: start.toISOString().split("T")[0],
                exportedTo: end.toISOString().split("T")[0],
                employeeName: empInfo.name,
                empCode: empInfo.empCode,
                workingDays: att.workingDays,
                presentDays: att.presentDays,
                retailCustomers: g.typeCounts.retail,
                wholesaleCustomers: g.typeCounts.wholesale,
                corporateCustomers: g.typeCounts.corporate,
                generalCustomers: g.typeCounts.customer,
                agentCustomers: g.typeCounts.agent,
                openAccounts: g.openAccounts,
                closeAccounts: g.closeAccounts,
                totalVisits: g.totalVisits,
                closingAccounts: g.closingAccounts,
                newCalls,
                repeatCalls,
                appointmentsNextMonth: g.appointmentsNextMonth,
                paidCases: g.paidCases,
                totalAmount: round2(g.totalAmount),
                totalFieldHours: round2(att.totalFieldHours),
                totalCallHours: round2(g.totalCallHours),
                avgTimePerCallHrs: round2(safeDiv(g.totalCallHours, g.totalVisits)),
                avgCallsPerDay: round2(safeDiv(g.totalVisits, att.presentDays || att.workingDays))
            });
        });

        rows.sort((a, b) => a.month.localeCompare(b.month) || a.employeeName.localeCompare(b.employeeName));

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No data found for the given period" });
        }

        const csv = buildCsv(rows);
        return sendCsv(res, csv, `employee_monthly_report_${Date.now()}.csv`);

    } catch (error) {
        console.error("Employee Monthly Report Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate report", error: error.message });
    }
};

/* ============================================================
   SUB-REPORT 1: CUSTOMER TYPE & ACCOUNT STATUS BREAKDOWN
   GET /reports/customer-type-breakdown?companyId=&startDate=&endDate=
============================================================ */
export const exportCustomerTypeBreakdownReport = async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, message: "companyId is required" });
        }

        const { start, end } = getDateRange(req.query);
        const { employeeByUserId } = await loadEmployeeMaps(companyId);

        const sessions = await SalesSession.find({
            companyId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        const groups = new Map(); // userId -> stats

        sessions.forEach((session) => {
            const userId = session.employeeId?.toString();
            if (!userId) return;

            if (!groups.has(userId)) {
                groups.set(userId, {
                    totalVisits: 0,
                    typeCounts: { retail: 0, wholesale: 0, corporate: 0, customer: 0, agent: 0 },
                    openAccounts: 0,
                    closeAccounts: 0
                });
            }

            const g = groups.get(userId);
            const customer = session.customer || {};

            g.totalVisits += 1;
            const t = customer.type || "customer";
            if (g.typeCounts[t] !== undefined) g.typeCounts[t] += 1;
            if (customer.isActive !== false) g.openAccounts += 1; else g.closeAccounts += 1;
        });

        const rows = [];
        groups.forEach((g, userId) => {
            const empInfo = employeeByUserId.get(userId) || { empCode: "", name: "Unknown" };
            rows.push({
                employeeName: empInfo.name,
                empCode: empInfo.empCode,
                totalVisits: g.totalVisits,
                retailCustomers: g.typeCounts.retail,
                wholesaleCustomers: g.typeCounts.wholesale,
                corporateCustomers: g.typeCounts.corporate,
                generalCustomers: g.typeCounts.customer,
                agentCustomers: g.typeCounts.agent,
                openAccounts: g.openAccounts,
                closeAccounts: g.closeAccounts,
                openAccountPct: round2(safeDiv(g.openAccounts * 100, g.totalVisits)),
                closeAccountPct: round2(safeDiv(g.closeAccounts * 100, g.totalVisits))
            });
        });

        rows.sort((a, b) => b.totalVisits - a.totalVisits);

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No data found for the given period" });
        }

        const csv = buildCsv(rows);
        return sendCsv(res, csv, `customer_type_breakdown_${Date.now()}.csv`);

    } catch (error) {
        console.error("Customer Type Breakdown Report Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate report", error: error.message });
    }
};

/* ============================================================
   SUB-REPORT 2: NEW VS REPEAT CUSTOMER DETAIL
   GET /reports/new-vs-repeat-customers?companyId=&startDate=&endDate=
============================================================ */
export const exportNewVsRepeatCustomerReport = async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, message: "companyId is required" });
        }

        const { start, end } = getDateRange(req.query);
        const { employeeByUserId } = await loadEmployeeMaps(companyId);

        const sessions = await SalesSession.find({
            companyId,
            createdAt: { $gte: start, $lte: end }
        }).sort({ createdAt: 1 }).lean();

        // key = `${userId}::${customerKey}`
        const customerMap = new Map();

        sessions.forEach((session) => {
            const userId = session.employeeId?.toString();
            if (!userId) return;

            const customer = session.customer || {};
            const customerKey = customer.phoneNumber || customer.customerId || customer.contactName;
            if (!customerKey) return;

            const key = `${userId}::${customerKey}`;
            if (!customerMap.has(key)) {
                customerMap.set(key, {
                    userId,
                    customerName: customer.contactName || "",
                    companyName: customer.companyName || "",
                    phoneNumber: customer.phoneNumber || "",
                    visitCount: 0,
                    firstVisit: session.createdAt,
                    lastVisit: session.createdAt
                });
            }

            const c = customerMap.get(key);
            c.visitCount += 1;
            if (new Date(session.createdAt) < new Date(c.firstVisit)) c.firstVisit = session.createdAt;
            if (new Date(session.createdAt) > new Date(c.lastVisit)) c.lastVisit = session.createdAt;
        });

        const rows = [];
        customerMap.forEach((c) => {
            const empInfo = employeeByUserId.get(c.userId) || { empCode: "", name: "Unknown" };
            rows.push({
                employeeName: empInfo.name,
                empCode: empInfo.empCode,
                customerName: c.customerName,
                companyName: c.companyName,
                phoneNumber: c.phoneNumber,
                visitCount: c.visitCount,
                classification: c.visitCount === 1 ? "New" : "Repeat",
                firstVisitDate: new Date(c.firstVisit).toISOString().split("T")[0],
                lastVisitDate: new Date(c.lastVisit).toISOString().split("T")[0]
            });
        });

        rows.sort((a, b) => b.visitCount - a.visitCount);

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No data found for the given period" });
        }

        const csv = buildCsv(rows);
        return sendCsv(res, csv, `new_vs_repeat_customers_${Date.now()}.csv`);

    } catch (error) {
        console.error("New vs Repeat Customer Report Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate report", error: error.message });
    }
};

/* ============================================================
   SUB-REPORT 3: PAYMENT & REVENUE
   GET /reports/payment-revenue?companyId=&startDate=&endDate=
============================================================ */
export const exportPaymentRevenueReport = async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, message: "companyId is required" });
        }

        const { start, end } = getDateRange(req.query);
        const { employeeByUserId } = await loadEmployeeMaps(companyId);

        const sessions = await SalesSession.find({
            companyId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        const groups = new Map(); // userId -> stats

        sessions.forEach((session) => {
            const userId = session.employeeId?.toString();
            if (!userId) return;

            if (!groups.has(userId)) {
                groups.set(userId, {
                    totalCases: 0,
                    paidCases: 0,
                    totalAmount: 0,
                    paymentModes: { Cash: 0, Card: 0, UPI: 0, "Bank Transfer": 0 }
                });
            }

            const g = groups.get(userId);
            g.totalCases += 1;

            const logs = session.salesLogs || [];
            if (logs.some((l) => l.paymentCollected)) g.paidCases += 1;

            logs.forEach((log) => {
                g.totalAmount += log.amount || 0;
                if (log.paymentMode && g.paymentModes[log.paymentMode] !== undefined) {
                    g.paymentModes[log.paymentMode] += 1;
                }
            });
        });

        const rows = [];
        groups.forEach((g, userId) => {
            const empInfo = employeeByUserId.get(userId) || { empCode: "", name: "Unknown" };
            rows.push({
                employeeName: empInfo.name,
                empCode: empInfo.empCode,
                totalCases: g.totalCases,
                paidCases: g.paidCases,
                unpaidCases: g.totalCases - g.paidCases,
                cashPayments: g.paymentModes.Cash,
                cardPayments: g.paymentModes.Card,
                upiPayments: g.paymentModes.UPI,
                bankTransferPayments: g.paymentModes["Bank Transfer"],
                totalAmount: round2(g.totalAmount),
                avgDealSize: round2(safeDiv(g.totalAmount, g.paidCases))
            });
        });

        rows.sort((a, b) => b.totalAmount - a.totalAmount);

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No data found for the given period" });
        }

        const csv = buildCsv(rows);
        return sendCsv(res, csv, `payment_revenue_report_${Date.now()}.csv`);

    } catch (error) {
        console.error("Payment Revenue Report Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate report", error: error.message });
    }
};

/* ============================================================
   SUB-REPORT 4: APPOINTMENTS SCHEDULED FOR NEXT MONTH
   GET /reports/appointments-next-month?companyId=&startDate=&endDate=
============================================================ */
export const exportAppointmentsNextMonthReport = async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, message: "companyId is required" });
        }

        const { start, end } = getDateRange(req.query);
        const { employeeByUserId } = await loadEmployeeMaps(companyId);

        // "Next month" window is calculated relative to the export's end date
        const nextMonthKey = getNextMonthKey(getMonthKey(end));
        const [nYear, nMonth] = nextMonthKey.split("-").map(Number);
        const nextMonthStart = new Date(nYear, nMonth - 1, 1);
        const nextMonthEnd = new Date(nYear, nMonth, 0, 23, 59, 59, 999);

        const sessions = await SalesSession.find({
            companyId,
            createdAt: { $gte: start, $lte: end },
            "nextMeeting.decided": true,
            "nextMeeting.date": { $gte: nextMonthStart, $lte: nextMonthEnd }
        }).sort({ "nextMeeting.date": 1 }).lean();

        const rows = sessions.map((session) => {
            const userId = session.employeeId?.toString();
            const empInfo = employeeByUserId.get(userId) || { empCode: "", name: "Unknown" };
            const customer = session.customer || {};

            return {
                employeeName: empInfo.name,
                empCode: empInfo.empCode,
                customerName: customer.contactName || "",
                companyName: customer.companyName || "",
                phoneNumber: customer.phoneNumber || "",
                appointmentDate: session.nextMeeting?.date
                    ? new Date(session.nextMeeting.date).toISOString().split("T")[0]
                    : "",
                appointmentTime: session.nextMeeting?.time || "",
                notes: session.nextMeeting?.notes || "",
                originalVisitDate: session.createdAt
                    ? new Date(session.createdAt).toISOString().split("T")[0]
                    : ""
            };
        });

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No upcoming appointments found for next month" });
        }

        const csv = buildCsv(rows);
        return sendCsv(res, csv, `appointments_next_month_${Date.now()}.csv`);

    } catch (error) {
        console.error("Appointments Next Month Report Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate report", error: error.message });
    }
};

/* ============================================================
   SUB-REPORT 5: DAILY ATTENDANCE VS FIELD/CALL TIME
   GET /reports/attendance-field-time?companyId=&startDate=&endDate=
============================================================ */
export const exportAttendanceFieldTimeReport = async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, message: "companyId is required" });
        }

        const { start, end } = getDateRange(req.query);
        const { employeeByUserId, employeeMongoIdToUserId } = await loadEmployeeMaps(companyId);

        const attendanceRecords = await Attendance.find({
            companyId,
            date: { $gte: start, $lte: end }
        }).lean();

        // key = `${userId}_${YYYY-MM-DD}`
        const attendanceMap = new Map();
        attendanceRecords.forEach((rec) => {
            const userId = employeeMongoIdToUserId.get(rec.employeeId?.toString());
            if (!userId) return;

            const dayKey = new Date(rec.date).toISOString().split("T")[0];
            attendanceMap.set(`${userId}_${dayKey}`, {
                status: rec.status,
                totalWorkingHours: rec.totalWorkingHours || 0,
                lateByMinutes: rec.lateByMinutes || 0
            });
        });

        const sessions = await SalesSession.find({
            companyId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        const callHoursMap = new Map(); // `${userId}_${YYYY-MM-DD}` -> { callHours, visits }
        sessions.forEach((session) => {
            const userId = session.employeeId?.toString();
            if (!userId) return;

            const dayKey = new Date(session.createdAt).toISOString().split("T")[0];
            const key = `${userId}_${dayKey}`;

            let callHours = 0;
            if (session.punchInTime && session.punchOutTime) {
                callHours = (new Date(session.punchOutTime) - new Date(session.punchInTime)) / (1000 * 60 * 60);
            } else if (session.duration) {
                callHours = session.duration / 60;
            }

            if (!callHoursMap.has(key)) callHoursMap.set(key, { callHours: 0, visits: 0 });
            const c = callHoursMap.get(key);
            c.callHours += callHours;
            c.visits += 1;
        });

        const allKeys = new Set([...attendanceMap.keys(), ...callHoursMap.keys()]);

        const rows = [];
        allKeys.forEach((key) => {
            const [userId, day] = key.split("_");
            const empInfo = employeeByUserId.get(userId) || { empCode: "", name: "Unknown" };
            const att = attendanceMap.get(key) || { status: "absent", totalWorkingHours: 0, lateByMinutes: 0 };
            const call = callHoursMap.get(key) || { callHours: 0, visits: 0 };

            rows.push({
                date: day,
                employeeName: empInfo.name,
                empCode: empInfo.empCode,
                attendanceStatus: att.status,
                totalFieldHours: round2(att.totalWorkingHours),
                totalCallHours: round2(call.callHours),
                totalVisits: call.visits,
                lateByMinutes: att.lateByMinutes
            });
        });

        rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No data found for the given period" });
        }

        const csv = buildCsv(rows);
        return sendCsv(res, csv, `attendance_field_time_report_${Date.now()}.csv`);

    } catch (error) {
        console.error("Attendance Field Time Report Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate report", error: error.message });
    }
};
