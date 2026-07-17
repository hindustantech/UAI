import Employee from "../../../models/Attandance/Employee.js";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import ExcelJS from "exceljs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import mongoose from "mongoose";

/* ============================================================
CHART RENDERER
Renders Chart.js configs to PNG buffers server-side so they can
be embedded as images in the workbook. (ExcelJS's native "chart
object" support is experimental/unstable across Excel versions,
so rendered PNGs are the reliable path.)
============================================================ */
const chartCanvas = new ChartJSNodeCanvas({
    width: 640,
    height: 420,
    backgroundColour: "white"
});

const PALETTE = [
    "#4E79A7", "#F28E2C", "#E15759", "#76B7B2", "#59A14F",
    "#EDC949", "#AF7AA1", "#FF9DA7", "#9C755F", "#BAB0AB"
];

const renderBarChart = async (title, labels, data, yLabel = "") => {
    return chartCanvas.renderToBuffer({
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: yLabel || title,
                data,
                backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length])
            }]
        },
        options: {
            plugins: {
                title: { display: true, text: title, font: { size: 16 } },
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, title: { display: !!yLabel, text: yLabel } }
            }
        }
    });
};

const renderPieChart = async (title, labels, data) => {
    return chartCanvas.renderToBuffer({
        type: "pie",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length])
            }]
        },
        options: {
            plugins: {
                title: { display: true, text: title, font: { size: 16 } },
                legend: { position: "right" }
            }
        }
    });
};

/* ============================================================
STYLING HELPERS
============================================================ */
const FONT = "Calibri";

const styleHeaderRow = (row) => {
    row.eachCell((cell) => {
        cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF2F5496" }
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
            top: { style: "thin" }, left: { style: "thin" },
            bottom: { style: "thin" }, right: { style: "thin" }
        };
    });
    row.height = 20;
};

const styleDataRow = (row) => {
    row.eachCell((cell) => {
        cell.font = { name: FONT, size: 11 };
        cell.border = {
            top: { style: "thin", color: { argb: "FFE0E0E0" } },
            left: { style: "thin", color: { argb: "FFE0E0E0" } },
            bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
            right: { style: "thin", color: { argb: "FFE0E0E0" } }
        };
    });
};

const autoFitColumns = (sheet, minWidth = 12) => {
    sheet.columns.forEach((col) => {
        let max = minWidth;
        col.eachCell({ includeEmpty: true }, (cell) => {
            const len = cell.value ? String(cell.value).length : 0;
            if (len + 2 > max) max = len + 2;
        });
        col.width = Math.min(max, 45);
    });
};

const addTable = (sheet, startRow, headers, rows) => {
    const headerRow = sheet.getRow(startRow);
    headers.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
    styleHeaderRow(headerRow);

    rows.forEach((r, idx) => {
        const row = sheet.getRow(startRow + 1 + idx);
        r.forEach((val, i) => (row.getCell(i + 1).value = val));
        styleDataRow(row);
        if (idx % 2 === 1) {
            row.eachCell((cell) => {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF7F9FC" }
                };
            });
        }
    });

    return startRow + 1 + rows.length; // next free row
};

/* ============================================================
CONTROLLER: Export Sales Analytics as .xlsx (with charts)
GET /api/reports/sales-analytics/export
    ?companyId=&customerType=&startDate=&endDate=&employeeId=&employeeIds=
============================================================ */
export const exportSalesAnalyticsExcel = async (req, res) => {
    try {
        const {
            companyId: queryCompanyId,
            customerType,
            startDate,
            endDate,
            employeeId,
            employeeIds
        } = req.query;

        const companyId = queryCompanyId || req.user?._id || req.user?.id;

        if (!companyId) {
            return res.status(403).json({
                success: false,
                message: "companyId is required (or must be resolvable from the authenticated user)"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(companyId.toString())) {
            return res.status(400).json({ success: false, message: "Invalid companyId format" });
        }

        const companyObjectId = new mongoose.Types.ObjectId(companyId.toString());

        const allowedCustomerTypes = ["retail", "wholesale", "corporate", "customer", "agent"];
        if (customerType && !allowedCustomerTypes.includes(customerType)) {
            return res.status(400).json({
                success: false,
                message: `Invalid customerType. Must be one of: ${allowedCustomerTypes.join(", ")}`
            });
        }

        /* ============================================================
        EMPLOYEE DETAILS MAP
        ============================================================ */
        const companyEmployees = await Employee.find({
            companyId: companyObjectId,
            employmentStatus: "active"
        }).select("userId user_name empCode employeeType role").lean();

        const employeeDetailsMap = new Map();
        companyEmployees.forEach((emp) => {
            if (emp.userId) {
                employeeDetailsMap.set(emp.userId.toString(), {
                    user_name: emp.user_name || "Unknown",
                    empCode: emp.empCode || "N/A",
                    employeeType: emp.employeeType || "non_sales",
                    role: emp.role || "employee"
                });
            }
        });

        let targetEmployeeIds = null;
        if (employeeId) {
            targetEmployeeIds = [new mongoose.Types.ObjectId(employeeId.toString())];
        } else if (employeeIds) {
            const parsedIds = Array.isArray(employeeIds)
                ? employeeIds
                : employeeIds.split(",").map((id) => id.trim());
            targetEmployeeIds = parsedIds
                .filter((id) => mongoose.Types.ObjectId.isValid(id))
                .map((id) => new mongoose.Types.ObjectId(id));
        }

        /* ============================================================
        MATCH FILTER
        ============================================================ */
        const matchStage = { companyId: companyObjectId };
        if (customerType) matchStage["customer.type"] = customerType;
        if (targetEmployeeIds && targetEmployeeIds.length > 0) {
            matchStage.$or = [
                { employeeId: { $in: targetEmployeeIds } },
                { createdBy: { $in: targetEmployeeIds } },
                { assignedTo: { $in: targetEmployeeIds } }
            ];
        }
        if (startDate || endDate) {
            matchStage.createdAt = {};
            if (startDate) {
                const start = new Date(startDate);
                if (isNaN(start.getTime())) {
                    return res.status(400).json({ success: false, message: "Invalid startDate format" });
                }
                start.setHours(0, 0, 0, 0);
                matchStage.createdAt.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                if (isNaN(end.getTime())) {
                    return res.status(400).json({ success: false, message: "Invalid endDate format" });
                }
                end.setHours(23, 59, 59, 999);
                matchStage.createdAt.$lte = end;
            }
        }

        /* ============================================================
        AGGREGATE (same shape as getSalesAnalytics)
        ============================================================ */
        const results = await SalesSession.aggregate([
            { $match: matchStage },
            {
                $addFields: {
                    customerKey: {
                        $cond: [
                            { $and: [{ $ne: ["$customer.customerId", null] }, { $ne: ["$customer.customerId", ""] }] },
                            "$customer.customerId",
                            { $concat: ["phone_", { $ifNull: ["$customer.phoneNumber", "unknown"] }] }
                        ]
                    },
                    perfEmployeeId: { $ifNull: ["$employeeId", "$createdBy"] }
                }
            },
            {
                $facet: {
                    customerGroups: [
                        {
                            $group: {
                                _id: "$customerKey",
                                visits: { $sum: 1 },
                                customerType: { $first: "$customer.type" },
                                isActive: { $first: "$customer.isActive" },
                                companyName: { $first: "$customer.companyName" },
                                contactName: { $first: "$customer.contactName" },
                                phoneNumber: { $first: "$customer.phoneNumber" },
                                lastVisit: { $max: "$createdAt" }
                            }
                        }
                    ],
                    sessionOverview: [
                        {
                            $group: {
                                _id: null,
                                totalSessions: { $sum: 1 },
                                completedSessions: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                                inProgressSessions: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
                                openSales: { $sum: { $cond: [{ $eq: ["$SalesStatus", "open"] }, 1, 0] } },
                                closedSales: { $sum: { $cond: [{ $eq: ["$SalesStatus", "closed"] }, 1, 0] } },
                                followUpSales: { $sum: { $cond: [{ $eq: ["$SalesStatus", "follow_up"] }, 1, 0] } }
                            }
                        }
                    ],
                    dealBreakdown: [
                        { $unwind: { path: "$salesLogs", preserveNullAndEmptyArrays: true } },
                        {
                            $group: {
                                _id: null,
                                totalDeals: { $sum: { $cond: [{ $ifNull: ["$salesLogs", false] }, 1, 0] } },
                                closedWon: { $sum: { $cond: [{ $eq: ["$salesLogs.dealStatus", "Closed Won"] }, 1, 0] } },
                                closedLost: { $sum: { $cond: [{ $eq: ["$salesLogs.dealStatus", "Closed Lost"] }, 1, 0] } },
                                negotiation: { $sum: { $cond: [{ $eq: ["$salesLogs.dealStatus", "Negotiation"] }, 1, 0] } },
                                followUp: { $sum: { $cond: [{ $eq: ["$salesLogs.dealStatus", "Follow Up"] }, 1, 0] } },
                                totalAmountCollected: {
                                    $sum: { $cond: [{ $eq: ["$salesLogs.paymentCollected", true] }, { $ifNull: ["$salesLogs.amount", 0] }, 0] }
                                },
                                totalDealAmount: { $sum: { $ifNull: ["$salesLogs.amount", 0] } }
                            }
                        }
                    ],
                    employeeVisits: [
                        {
                            $group: {
                                _id: "$perfEmployeeId",
                                totalSessions: { $sum: 1 },
                                totalVisitLogs: { $sum: { $size: { $ifNull: ["$visitLogs", []] } } }
                            }
                        }
                    ],
                    employeeDeals: [
                        { $unwind: { path: "$salesLogs", preserveNullAndEmptyArrays: true } },
                        {
                            $group: {
                                _id: "$perfEmployeeId",
                                dealsWon: { $sum: { $cond: [{ $eq: ["$salesLogs.dealStatus", "Closed Won"] }, 1, 0] } },
                                dealsLost: { $sum: { $cond: [{ $eq: ["$salesLogs.dealStatus", "Closed Lost"] }, 1, 0] } },
                                amountCollected: {
                                    $sum: { $cond: [{ $eq: ["$salesLogs.paymentCollected", true] }, { $ifNull: ["$salesLogs.amount", 0] }, 0] }
                                }
                            }
                        }
                    ]
                }
            }
        ]);

        const facetResult = results[0] || {};
        const customerGroups = facetResult.customerGroups || [];
        const sessionOverview = facetResult.sessionOverview?.[0] || {
            totalSessions: 0, completedSessions: 0, inProgressSessions: 0,
            openSales: 0, closedSales: 0, followUpSales: 0
        };
        const dealBreakdown = facetResult.dealBreakdown?.[0] || {
            totalDeals: 0, closedWon: 0, closedLost: 0, negotiation: 0,
            followUp: 0, totalAmountCollected: 0, totalDealAmount: 0
        };
        const employeeVisits = facetResult.employeeVisits || [];
        const employeeDeals = facetResult.employeeDeals || [];

        // ---- Customer overview ----
        const customerOverview = {
            totalCustomers: customerGroups.length,
            totalVisits: customerGroups.reduce((s, c) => s + c.visits, 0),
            newCustomers: customerGroups.filter((c) => c.visits === 1).length,
            repeatCustomers: customerGroups.filter((c) => c.visits > 1).length,
            activeCustomers: customerGroups.filter((c) => c.isActive === true).length,
            inactiveCustomers: customerGroups.filter((c) => c.isActive === false).length
        };
        customerOverview.repeatVisitRate = customerOverview.totalCustomers > 0
            ? Number(((customerOverview.repeatCustomers / customerOverview.totalCustomers) * 100).toFixed(2))
            : 0;

        // ---- Customer type breakdown ----
        const typeMap = new Map();
        customerGroups.forEach((c) => {
            const t = c.customerType || "customer";
            if (!typeMap.has(t)) typeMap.set(t, { customerType: t, customerCount: 0, totalVisits: 0 });
            const entry = typeMap.get(t);
            entry.customerCount += 1;
            entry.totalVisits += c.visits;
        });
        const customerTypeBreakdown = Array.from(typeMap.values()).sort((a, b) => b.customerCount - a.customerCount);

        // ---- Top repeat customers ----
        const topRepeatCustomers = customerGroups
            .filter((c) => c.visits > 1)
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 10)
            .map((c) => ({
                customerId: c._id,
                companyName: c.companyName || "",
                contactName: c.contactName || "",
                phoneNumber: c.phoneNumber || "",
                customerType: c.customerType || "customer",
                isActive: c.isActive !== false,
                visitCount: c.visits,
                lastVisit: c.lastVisit ? new Date(c.lastVisit).toLocaleDateString("en-IN") : ""
            }));

        // ---- Employee performance ----
        const employeeVisitsMap = new Map(employeeVisits.map((e) => [e._id ? e._id.toString() : "unassigned", e]));
        const employeeDealsMap = new Map(employeeDeals.map((e) => [e._id ? e._id.toString() : "unassigned", e]));
        const allEmployeeKeys = new Set([...employeeVisitsMap.keys(), ...employeeDealsMap.keys()]);

        const employeePerformance = Array.from(allEmployeeKeys).map((empKey) => {
            const visitData = employeeVisitsMap.get(empKey) || { totalSessions: 0, totalVisitLogs: 0 };
            const dealData = employeeDealsMap.get(empKey) || { dealsWon: 0, dealsLost: 0, amountCollected: 0 };
            const empDetails = employeeDetailsMap.get(empKey);
            const conversionRate = visitData.totalSessions > 0
                ? Number(((dealData.dealsWon / visitData.totalSessions) * 100).toFixed(2))
                : 0;
            return {
                employeeId: empKey,
                empName: empDetails?.user_name || "Unknown",
                empCode: empDetails?.empCode || "N/A",
                role: empDetails?.role || "N/A",
                totalSessions: visitData.totalSessions,
                totalVisitLogs: visitData.totalVisitLogs,
                dealsWon: dealData.dealsWon,
                dealsLost: dealData.dealsLost,
                amountCollected: dealData.amountCollected,
                conversionRate
            };
        }).sort((a, b) => b.amountCollected - a.amountCollected);

        if (sessionOverview.totalSessions === 0) {
            return res.status(404).json({ success: false, message: "No data found for the given filters" });
        }

        /* ============================================================
        BUILD WORKBOOK
        ============================================================ */
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Sales Analytics";
        workbook.created = new Date();

        /* ---------- Sheet 1: Overview ---------- */
        const overviewSheet = workbook.addWorksheet("Overview");
        overviewSheet.getCell("A1").value = "Sales Analytics Report";
        overviewSheet.getCell("A1").font = { name: FONT, size: 18, bold: true, color: { argb: "FF2F5496" } };
        overviewSheet.mergeCells("A1:D1");

        overviewSheet.getCell("A2").value =
            `Period: ${startDate || "All time"} to ${endDate || "All time"}  |  Generated: ${new Date().toLocaleString("en-IN")}`;
        overviewSheet.getCell("A2").font = { name: FONT, italic: true, size: 10, color: { argb: "FF666666" } };
        overviewSheet.mergeCells("A2:D2");

        let row = addTable(overviewSheet, 4, ["Session Metric", "Value"], [
            ["Total Sessions", sessionOverview.totalSessions],
            ["Completed Sessions", sessionOverview.completedSessions],
            ["In Progress Sessions", sessionOverview.inProgressSessions],
            ["Open Sales", sessionOverview.openSales],
            ["Closed Sales", sessionOverview.closedSales],
            ["Follow-up Sales", sessionOverview.followUpSales]
        ]);

        row = addTable(overviewSheet, row + 2, ["Customer Metric", "Value"], [
            ["Total Customers", customerOverview.totalCustomers],
            ["Total Visits", customerOverview.totalVisits],
            ["New Customers", customerOverview.newCustomers],
            ["Repeat Customers", customerOverview.repeatCustomers],
            ["Active Customers", customerOverview.activeCustomers],
            ["Inactive Customers", customerOverview.inactiveCustomers],
            ["Repeat Visit Rate (%)", customerOverview.repeatVisitRate]
        ]);

        row = addTable(overviewSheet, row + 2, ["Deal Metric", "Value"], [
            ["Total Deals", dealBreakdown.totalDeals],
            ["Closed Won", dealBreakdown.closedWon],
            ["Closed Lost", dealBreakdown.closedLost],
            ["Negotiation", dealBreakdown.negotiation],
            ["Follow Up", dealBreakdown.followUp],
            ["Total Amount Collected (₹)", dealBreakdown.totalAmountCollected],
            ["Total Deal Amount (₹)", dealBreakdown.totalDealAmount]
        ]);

        autoFitColumns(overviewSheet);

        /* ---------- Sheet 2: Customer Types (table + bar chart) ---------- */
        const custSheet = workbook.addWorksheet("Customer Types");
        const custRowEnd = addTable(
            custSheet, 1,
            ["Customer Type", "Customer Count", "Total Visits"],
            customerTypeBreakdown.map((c) => [c.customerType, c.customerCount, c.totalVisits])
        );
        autoFitColumns(custSheet);

        if (customerTypeBreakdown.length > 0) {
            const barBuf = await renderBarChart(
                "Customers by Type",
                customerTypeBreakdown.map((c) => c.customerType),
                customerTypeBreakdown.map((c) => c.customerCount),
                "Customer Count"
            );
            const imgId = workbook.addImage({ buffer: barBuf, extension: "png" });
            custSheet.addImage(imgId, { tl: { col: 4, row: 1 }, ext: { width: 560, height: 370 } });
        }

        /* ---------- Sheet 3: Deal Breakdown (table + pie chart) ---------- */
        const dealSheet = workbook.addWorksheet("Deal Breakdown");
        const dealLabels = ["Closed Won", "Closed Lost", "Negotiation", "Follow Up"];
        const dealValues = [dealBreakdown.closedWon, dealBreakdown.closedLost, dealBreakdown.negotiation, dealBreakdown.followUp];

        addTable(dealSheet, 1, ["Deal Status", "Count"], dealLabels.map((l, i) => [l, dealValues[i]]));
        autoFitColumns(dealSheet);

        if (dealValues.some((v) => v > 0)) {
            const pieBuf = await renderPieChart("Deal Status Breakdown", dealLabels, dealValues);
            const imgId = workbook.addImage({ buffer: pieBuf, extension: "png" });
            dealSheet.addImage(imgId, { tl: { col: 3, row: 1 }, ext: { width: 560, height: 370 } });
        }

        /* ---------- Sheet 4: Employee Performance (table + bar chart) ---------- */
        const empSheet = workbook.addWorksheet("Employee Performance");
        const empRowEnd = addTable(
            empSheet, 1,
            ["Employee Code", "Employee Name", "Role", "Total Sessions", "Visit Logs", "Deals Won", "Deals Lost", "Amount Collected (₹)", "Conversion Rate (%)"],
            employeePerformance.map((e) => [
                e.empCode, e.empName, e.role, e.totalSessions, e.totalVisitLogs,
                e.dealsWon, e.dealsLost, e.amountCollected, e.conversionRate
            ])
        );
        autoFitColumns(empSheet);

        if (employeePerformance.length > 0) {
            const topEmployees = employeePerformance.slice(0, 10);
            const barBuf = await renderBarChart(
                "Amount Collected by Employee (Top 10)",
                topEmployees.map((e) => e.empName),
                topEmployees.map((e) => e.amountCollected),
                "Amount (₹)"
            );
            const imgId = workbook.addImage({ buffer: barBuf, extension: "png" });
            empSheet.addImage(imgId, { tl: { col: 10, row: 1 }, ext: { width: 620, height: 380 } });
        }

        /* ---------- Sheet 5: Top Repeat Customers ---------- */
        const repeatSheet = workbook.addWorksheet("Top Repeat Customers");
        addTable(
            repeatSheet, 1,
            ["Customer ID", "Company Name", "Contact Name", "Phone Number", "Type", "Active", "Visit Count", "Last Visit"],
            topRepeatCustomers.map((c) => [
                c.customerId, c.companyName, c.contactName, c.phoneNumber,
                c.customerType, c.isActive ? "Yes" : "No", c.visitCount, c.lastVisit
            ])
        );
        autoFitColumns(repeatSheet);

        /* ============================================================
        SEND FILE
        ============================================================ */
        const filename = `Sales_Analytics_${new Date().toISOString().split("T")[0]}.xlsx`;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("exportSalesAnalyticsExcel error:", error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Failed to export sales analytics Excel report",
                error: error.message
            });
        }
    }
};
