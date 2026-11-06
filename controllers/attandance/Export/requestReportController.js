import ExcelJS from "exceljs";
import mongoose from "mongoose";
import AttendanceRequest from "../../../models/Attandance/Request.js";
import Employee from "../../../models/Attandance/Employee.js";
import {
    getApproverScope,
    getApprovalScopeEmployeeIds,
    normalizeDepartment,
} from "../../../utils/approvalScope.js";

/* ─────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────── */
const IST_OFFSET_MIN = 330;                      // UTC+05:30
const IST_OFFSET_MS = IST_OFFSET_MIN * 60 * 1000;
const DAY_MS = 86400000;

// Export is limited to the current month + the previous month (IST)
const EXPORTABLE_MONTHS = 2;

const REQUEST_TYPES = [
    "leave",
    "punch_in_out",
    "punch_in",
    "punch_in_and_out",
    "overtime",
    "comp_off",
];

const REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"];

const TYPE_LABEL = {
    leave: "Leave",
    punch_in_out: "Punch Correction",
    punch_in: "Punch In Correction",
    punch_in_and_out: "Punch Correction",
    overtime: "Overtime",
    comp_off: "Comp Off",
};

const STATUS_LABEL = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    cancelled: "Cancelled",
};

const STATUS_FILL = {
    pending: "FFFFF2CC",
    approved: "FFD9EAD3",
    rejected: "FFFFC7CE",
    cancelled: "FFE7E6E6",
};

const STATUS_FONT = {
    pending: "FF7D6608",
    approved: "FF137333",
    rejected: "FF9C0006",
    cancelled: "FF595959",
};

const HEADER_BG = "FF1F3864";
const SUBHEAD_BG = "FF2F5496";
const ALT_ROW_BG = "FFF2F6FC";
const TOTAL_BG = "FFD9E1F2";

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const pad2 = (value) => String(value).padStart(2, "0");

const toIST = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getTime() + IST_OFFSET_MS);
};

const istParts = (value) => {
    const date = toIST(value);
    if (!date) return null;
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
    };
};

const formatDateIST = (value) => {
    const p = istParts(value);
    return p ? `${pad2(p.day)}-${pad2(p.month)}-${p.year}` : "—";
};

const formatDateTimeIST = (value) => {
    const p = istParts(value);
    return p ? `${pad2(p.day)}-${pad2(p.month)}-${p.year} ${pad2(p.hour)}:${pad2(p.minute)}` : "—";
};

const formatTimeIST = (value) => {
    const p = istParts(value);
    return p ? `${pad2(p.hour)}:${pad2(p.minute)}` : "—";
};

/** Start of a calendar month in IST, expressed as a UTC Date. */
const istMonthStartUtc = (year, month) => new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);

/** Current month + previous month. Bounds are the full calendar months (IST). */
const getAllowedWindow = () => {
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();

    let startYear = year;
    let startMonth = month - (EXPORTABLE_MONTHS - 1);
    while (startMonth < 0) {
        startMonth += 12;
        startYear -= 1;
    }

    const start = istMonthStartUtc(startYear, startMonth);
    // Last millisecond of the current month (handles December rollover).
    const end = new Date(istMonthStartUtc(year, month + 1).getTime() - 1);

    return { start, end };
};

/** "YYYY-MM-DD" → Date (IST day start or IST day end). Returns null when invalid. */
const parseISTBoundary = (value, endOfDay = false) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const startUtcMs = Date.UTC(year, month - 1, day) - IST_OFFSET_MS;
    const verify = new Date(startUtcMs + IST_OFFSET_MS);
    if (
        verify.getUTCFullYear() !== year ||
        verify.getUTCMonth() !== month - 1 ||
        verify.getUTCDate() !== day
    ) {
        return null;
    }

    return new Date(endOfDay ? startUtcMs + DAY_MS - 1 : startUtcMs);
};

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitList = (value) =>
    String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

/** Narrow an existing employeeId filter by another list of ids. */
const intersectEmployeeFilter = (query, ids) => {
    const allowed = new Set(ids.map((id) => String(id)));

    if (query.employeeId == null) {
        query.employeeId = { $in: ids };
        return;
    }

    if (typeof query.employeeId === "object" && Array.isArray(query.employeeId.$in)) {
        query.employeeId = {
            $in: query.employeeId.$in.filter((id) => allowed.has(String(id))),
        };
        return;
    }

    query.employeeId = allowed.has(String(query.employeeId))
        ? query.employeeId
        : { $in: [] };
};

const halfDaySessionLabel = (session) => {
    if (session === "first") return "First half";
    if (session === "second") return "Second half";
    return "—";
};

/* ─────────────────────────────────────────────
   EXPORT — REQUEST REPORT
───────────────────────────────────────────── */
export const exportRequestReport = async (req, res) => {
    try {
        const {
            fromDate,
            toDate,
            department,
            requestType,
            status,
            employeeCode,
        } = req.query;

        const companyId = req.query.companyId || req.user?.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: "CompanyId required" });
        }

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({ success: false, message: "Invalid companyId" });
        }

        /* ── Allowed export window (current + previous month, IST) ── */
        const window = getAllowedWindow();

        let from = window.start;
        let to = new Date();

        if (fromDate) {
            const parsed = parseISTBoundary(fromDate, false);
            if (!parsed) {
                return res.status(400).json({
                    success: false,
                    message: "fromDate must be a valid date in YYYY-MM-DD format",
                });
            }
            from = parsed;
        }

        if (toDate) {
            const parsed = parseISTBoundary(toDate, true);
            if (!parsed) {
                return res.status(400).json({
                    success: false,
                    message: "toDate must be a valid date in YYYY-MM-DD format",
                });
            }
            to = parsed;
        }

        if (from > to) {
            return res.status(400).json({
                success: false,
                message: "fromDate cannot be after toDate",
            });
        }

        if (from < window.start || to > window.end) {
            return res.status(400).json({
                success: false,
                message:
                    `Only requests submitted between ${formatDateIST(window.start)} and ` +
                    `${formatDateIST(window.end)} can be exported`,
            });
        }

        /* ── Request type / status validation ── */
        const requestedTypes = splitList(requestType);
        const invalidTypes = requestedTypes.filter((type) => !REQUEST_TYPES.includes(type));
        if (invalidTypes.length) {
            return res.status(400).json({
                success: false,
                message: `Invalid requestType: ${invalidTypes.join(", ")}. Allowed: ${REQUEST_TYPES.join(", ")}`,
            });
        }

        const requestedStatuses = splitList(status);
        const invalidStatuses = requestedStatuses.filter((value) => !REQUEST_STATUSES.includes(value));
        if (invalidStatuses.length) {
            return res.status(400).json({
                success: false,
                message: `Invalid status: ${invalidStatuses.join(", ")}. Allowed: ${REQUEST_STATUSES.join(", ")}`,
            });
        }

        /* ── Scope (mirrors getAttendanceRequests) ── */
        const userId = req.user?._id || req.user?.id;
        const approverScope = await getApproverScope(req, companyId);
        const isGlobalViewer = ["super_admin", "partner"].includes(req.user?.type);

        const query = {
            companyId,
            createdAt: { $gte: from, $lte: to },
        };

        if (!isGlobalViewer) {
            if (!approverScope.eligible) {
                const employee = await Employee.findOne({ companyId, userId }).select("_id").lean();
                if (!employee) {
                    return res.status(404).json({
                        success: false,
                        message: "Employee record not found",
                    });
                }
                query.employeeId = employee._id;
            } else {
                const scopeEmployeeIds = await getApprovalScopeEmployeeIds(approverScope, companyId);
                if (scopeEmployeeIds !== null) {
                    query.employeeId = { $in: scopeEmployeeIds };
                }
            }
        }

        /* ── Department filter (same normalized matching as the list API) ── */
        const targetDepartment = normalizeDepartment(department);
        if (targetDepartment) {
            const companyDepartments = await Employee.distinct("jobInfo.department", { companyId });
            const matchedDepartments = companyDepartments.filter(
                (value) => normalizeDepartment(value) === targetDepartment
            );

            const departmentEmployeeIds = matchedDepartments.length
                ? await Employee.distinct("_id", {
                    companyId,
                    "jobInfo.department": { $in: matchedDepartments },
                })
                : [];

            intersectEmployeeFilter(query, departmentEmployeeIds);
        }

        /* ── Employee code filter ── */
        if (employeeCode) {
            const code = String(employeeCode).trim();
            const employeeIds = await Employee.distinct("_id", {
                companyId,
                empCode: { $regex: `^${escapeRegex(code)}$`, $options: "i" },
            });
            intersectEmployeeFilter(query, employeeIds);
        }

        if (requestedTypes.length) query.requestType = { $in: requestedTypes };
        if (requestedStatuses.length) query.status = { $in: requestedStatuses };

        /* ── Fetch ── */
        const requests = await AttendanceRequest.find(query)
            .populate({
                path: "employeeId",
                select: "empCode user_name jobInfo userId",
                populate: { path: "userId", select: "name" },
            })
            .populate("approvedBy", "name")
            .populate("leaveTypeId", "name code")
            .sort({ createdAt: 1 })
            .lean();

        if (!requests.length) {
            return res.status(404).json({
                success: false,
                message: "No requests found for the selected filters",
            });
        }

        /* ── Shape rows ── */
        const detailRows = requests.map((request, index) => {
            const employee = request.employeeId || {};
            const employeeName =
                employee.user_name || employee.userId?.name || "N/A";
            const isLeave = request.requestType === "leave";
            const usesLeaveDates =
                isLeave || request.requestType === "comp_off";
            const isPunch = ["punch_in", "punch_in_out", "punch_in_and_out"].includes(
                request.requestType
            );
            const isOvertime = request.requestType === "overtime";

            return {
                index: index + 1,
                empCode: employee.empCode || "—",
                empName: employeeName,
                department: employee.jobInfo?.department || "N/A",
                designation: employee.jobInfo?.designation || "N/A",
                requestType: TYPE_LABEL[request.requestType] || request.requestType,
                leaveType: request.leaveTypeId
                    ? `${request.leaveTypeId.name || "—"}${request.leaveTypeId.code ? ` (${request.leaveTypeId.code})` : ""}`
                    : "—",
                fromDate: usesLeaveDates ? formatDateIST(request.leaveDetails?.startDate) : "—",
                toDate: usesLeaveDates ? formatDateIST(request.leaveDetails?.endDate) : "—",
                days: usesLeaveDates && request.leaveDays ? request.leaveDays : "—",
                halfDay: isLeave ? (request.isHalfDay ? "Yes" : "No") : "—",
                session: isLeave && request.isHalfDay ? halfDaySessionLabel(request.halfDaySession) : "—",
                punchDate: isPunch ? formatDateIST(request.punchDetails?.date) : "—",
                punchIn: isPunch ? formatTimeIST(request.punchDetails?.punchInTime) : "—",
                punchOut: isPunch ? formatTimeIST(request.punchDetails?.punchOutTime) : "—",
                otDate: isOvertime ? formatDateIST(request.otDetails?.date) : "—",
                otMode: isOvertime
                    ? (request.otDetails?.compOff ? "Comp Off credit" : "Cash OT")
                    : "—",
                paid: isLeave ? (request.isPaid ? "Yes" : "No") : "—",
                status: STATUS_LABEL[request.status] || request.status || "—",
                statusKey: request.status,
                requestedOn: formatDateTimeIST(request.createdAt),
                reason: request.reason || "—",
                approvedBy: request.approvedBy?.name || "—",
                approvedOn: formatDateTimeIST(request.approvedAt),
                rejectionReason: request.rejectionReason || "—",
            };
        });

        /* ── Per-employee aggregation ── */
        const summaryMap = new Map();

        requests.forEach((request) => {
            const employee = request.employeeId || {};
            const key = String(employee._id || `unknown-${request._id}`);

            if (!summaryMap.has(key)) {
                summaryMap.set(key, {
                    empCode: employee.empCode || "—",
                    empName: employee.user_name || employee.userId?.name || "N/A",
                    department: employee.jobInfo?.department || "N/A",
                    designation: employee.jobInfo?.designation || "N/A",
                    total: 0,
                    leave: 0,
                    punch: 0,
                    overtime: 0,
                    compOff: 0,
                    pending: 0,
                    approved: 0,
                    rejected: 0,
                    cancelled: 0,
                    leaveDays: 0,
                });
            }

            const bucket = summaryMap.get(key);
            bucket.total += 1;

            if (request.requestType === "leave") bucket.leave += 1;
            else if (request.requestType === "overtime") bucket.overtime += 1;
            else if (request.requestType === "comp_off") bucket.compOff += 1;
            else bucket.punch += 1;

            if (request.status === "pending") bucket.pending += 1;
            else if (request.status === "approved") bucket.approved += 1;
            else if (request.status === "rejected") bucket.rejected += 1;
            else if (request.status === "cancelled") bucket.cancelled += 1;

            if (
                (request.requestType === "leave" || request.requestType === "comp_off") &&
                Number.isFinite(request.leaveDays)
            ) {
                bucket.leaveDays += request.leaveDays;
            }
        });

        const summaryRows = [...summaryMap.values()]
            .sort((a, b) => String(a.empCode).localeCompare(String(b.empCode)))
            .map((row, index) => ({ ...row, index: index + 1 }));

        /* ───────────────────────────────────────────
           Workbook
        ─────────────────────────────────────────── */
        const wb = new ExcelJS.Workbook();
        wb.creator = "HR System";

        const periodLabel = `${formatDateIST(from)} to ${formatDateIST(to)}`;
        const filterLabel = [
            targetDepartment ? `Department: ${department}` : "Department: All",
            requestedTypes.length ? `Type: ${requestedTypes.join(", ")}` : "Type: All",
            requestedStatuses.length ? `Status: ${requestedStatuses.join(", ")}` : "Status: All",
        ].join("   |   ");

        /* ── Sheet 1: Request Detail ── */
        const wsDetail = wb.addWorksheet("Request Detail", {
            views: [{ state: "frozen", ySplit: 3 }],
        });

        const detailHeaders = [
            "#", "Emp Code", "Employee Name", "Department", "Designation",
            "Request Type", "Leave Type", "From Date", "To Date", "Days",
            "Half Day", "Session", "Punch Date", "Punch In", "Punch Out",
            "OT Date", "OT Mode", "Paid", "Status", "Requested On",
            "Reason", "Approved By", "Approved On", "Rejection Reason",
        ];
        const detailCols = detailHeaders.length;

        wsDetail.mergeCells(1, 1, 1, detailCols);
        const dTitle = wsDetail.getCell(1, 1);
        dTitle.value = `REQUEST REPORT  |  Submitted ${periodLabel}`;
        dTitle.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
        dTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        dTitle.alignment = { horizontal: "center", vertical: "middle" };
        wsDetail.getRow(1).height = 26;

        wsDetail.mergeCells(2, 1, 2, detailCols);
        const dSub = wsDetail.getCell(2, 1);
        dSub.value = `${filterLabel}   |   ${detailRows.length} request(s)`;
        dSub.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF44546A" } };
        dSub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF2F9" } };
        dSub.alignment = { horizontal: "center", vertical: "middle" };
        wsDetail.getRow(2).height = 18;

        const dHeaderRow = wsDetail.getRow(3);
        dHeaderRow.height = 20;
        detailHeaders.forEach((header, i) => {
            const cell = dHeaderRow.getCell(i + 1);
            cell.value = header;
            cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        });

        detailRows.forEach((row, idx) => {
            const sheetRow = wsDetail.addRow([]);
            sheetRow.height = 16;
            const bg = idx % 2 === 0 ? ALT_ROW_BG : "FFFFFFFF";

            const values = [
                row.index, row.empCode, row.empName, row.department, row.designation,
                row.requestType, row.leaveType, row.fromDate, row.toDate, row.days,
                row.halfDay, row.session, row.punchDate, row.punchIn, row.punchOut,
                row.otDate, row.otMode, row.paid, row.status, row.requestedOn,
                row.reason, row.approvedBy, row.approvedOn, row.rejectionReason,
            ];

            values.forEach((value, i) => {
                const cell = sheetRow.getCell(i + 1);
                cell.value = value;
                cell.font = { name: "Arial", size: 9, bold: i <= 1 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                cell.alignment = {
                    horizontal: i === 2 || i === 3 || i === 4 || i === 20 || i === 23 ? "left" : "center",
                    vertical: "middle",
                };
                if (i === 9 && typeof value === "number") cell.numFmt = "0.##";
            });

            // Status colour
            const statusCell = sheetRow.getCell(19);
            statusCell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: STATUS_FILL[row.statusKey] || bg },
            };
            statusCell.font = {
                name: "Arial",
                size: 9,
                bold: true,
                color: { argb: STATUS_FONT[row.statusKey] || "FF000000" },
            };
        });

        const totalDaysRequested = detailRows.reduce(
            (sum, row) => sum + (typeof row.days === "number" ? row.days : 0),
            0
        );

        const dTotalRow = wsDetail.addRow([]);
        dTotalRow.height = 18;
        dTotalRow.getCell(1).value = "Total";
        dTotalRow.getCell(3).value = `${detailRows.length} request(s)`;
        dTotalRow.getCell(10).value = Number(totalDaysRequested.toFixed(2));
        dTotalRow.getCell(10).numFmt = "0.##";
        [1, 3, 10].forEach((col) => {
            const cell = dTotalRow.getCell(col);
            cell.font = { name: "Arial", size: 9, bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        wsDetail.columns = [
            { width: 5 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 18 },
            { width: 18 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 7 },
            { width: 9 }, { width: 12 }, { width: 12 }, { width: 9 }, { width: 9 },
            { width: 12 }, { width: 15 }, { width: 7 }, { width: 12 }, { width: 17 },
            { width: 32 }, { width: 20 }, { width: 17 }, { width: 24 },
        ];
        wsDetail.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: detailCols } };

        /* ── Sheet 2: Employee Summary ── */
        const wsSummary = wb.addWorksheet("Employee Summary", {
            views: [{ state: "frozen", ySplit: 3 }],
        });

        const summaryHeaders = [
            "#", "Emp Code", "Employee Name", "Department", "Designation",
            "Total Requests", "Leave", "Punch Correction", "Overtime", "Comp Off",
            "Pending", "Approved", "Rejected", "Cancelled", "Total Leave Days",
        ];
        const summaryCols = summaryHeaders.length;

        wsSummary.mergeCells(1, 1, 1, summaryCols);
        const sTitle = wsSummary.getCell(1, 1);
        sTitle.value = `REQUEST SUMMARY BY EMPLOYEE  |  Submitted ${periodLabel}`;
        sTitle.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
        sTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        sTitle.alignment = { horizontal: "center", vertical: "middle" };
        wsSummary.getRow(1).height = 26;

        wsSummary.mergeCells(2, 1, 2, summaryCols);
        const sSub = wsSummary.getCell(2, 1);
        sSub.value = `${filterLabel}   |   ${summaryRows.length} employee(s)`;
        sSub.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF44546A" } };
        sSub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF2F9" } };
        sSub.alignment = { horizontal: "center", vertical: "middle" };
        wsSummary.getRow(2).height = 18;

        const sHeaderRow = wsSummary.getRow(3);
        sHeaderRow.height = 20;
        summaryHeaders.forEach((header, i) => {
            const cell = sHeaderRow.getCell(i + 1);
            cell.value = header;
            cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        });

        summaryRows.forEach((row, idx) => {
            const sheetRow = wsSummary.addRow([]);
            sheetRow.height = 16;
            const bg = idx % 2 === 0 ? ALT_ROW_BG : "FFFFFFFF";

            const values = [
                row.index, row.empCode, row.empName, row.department, row.designation,
                row.total, row.leave, row.punch, row.overtime, row.compOff,
                row.pending, row.approved, row.rejected, row.cancelled,
                Number(row.leaveDays.toFixed(2)),
            ];

            values.forEach((value, i) => {
                const cell = sheetRow.getCell(i + 1);
                cell.value = value;
                cell.font = { name: "Arial", size: 9, bold: i <= 1 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                cell.alignment = {
                    horizontal: i === 2 || i === 3 || i === 4 ? "left" : "center",
                    vertical: "middle",
                };
                if (i === 14) cell.numFmt = "0.##";
            });

            if (row.rejected > 0) {
                sheetRow.getCell(13).font = {
                    name: "Arial", size: 9, bold: true, color: { argb: "FF9C0006" },
                };
            }
        });

        const summaryDataStart = 4;
        const summaryDataEnd = summaryDataStart + summaryRows.length - 1;
        const sTotalRow = wsSummary.addRow([]);
        sTotalRow.height = 18;
        sTotalRow.getCell(1).value = "Total";
        for (let col = 6; col <= 10; col += 1) {
            const letter = String.fromCharCode(64 + col);
            sTotalRow.getCell(col).value = `=SUM(${letter}${summaryDataStart}:${letter}${summaryDataEnd})`;
        }
        for (let col = 11; col <= 14; col += 1) {
            const letter = String.fromCharCode(64 + col);
            sTotalRow.getCell(col).value = `=SUM(${letter}${summaryDataStart}:${letter}${summaryDataEnd})`;
        }
        sTotalRow.getCell(15).value = Number(
            summaryRows.reduce((sum, row) => sum + row.leaveDays, 0).toFixed(2)
        );
        sTotalRow.getCell(15).numFmt = "0.##";
        for (let col = 1; col <= summaryCols; col += 1) {
            const cell = sTotalRow.getCell(col);
            cell.font = { name: "Arial", size: 9, bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
        }

        wsSummary.columns = [
            { width: 5 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 18 },
            { width: 14 }, { width: 9 }, { width: 17 }, { width: 12 }, { width: 11 },
            { width: 10 }, { width: 11 }, { width: 10 }, { width: 11 }, { width: 16 },
        ];
        wsSummary.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: summaryCols } };

        /* ── Send ── */
        const fileFrom = new Date(from).toISOString().split("T")[0];
        const fileTo = new Date(to).toISOString().split("T")[0];

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=request_report_${fileFrom}_to_${fileTo}.xlsx`
        );
        await wb.xlsx.write(res);
        return res.end();

    } catch (error) {
        console.error("Request report export error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate request report",
            error: error.message,
        });
    }
};
