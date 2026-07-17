import Employee from "../../../models/Attandance/Employee.js";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
HELPER : HAVERSINE DISTANCE
============================================================ */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // KM

    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Number((R * c).toFixed(2));
};

/* ============================================================
SAFE STRING CONVERSION - FIX FOR TYPE ERRORS
============================================================ */
const safeString = (value, defaultValue = "-") => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return defaultValue;
        }
    }
    return String(value);
};

/* ============================================================
SAFE NUMBER CONVERSION
============================================================ */
const safeNumber = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
};

/* ============================================================
EXPORT SALES REPORT
============================================================ */
export const exportSalesPersonReport = async (req, res) => {
    let filePath = null;

    try {
        const { companyId, salesPersonId, fromDate, toDate } = req.query;

        /* ============================================================
        VALIDATION
        ============================================================ */

        if (!companyId || !salesPersonId) {
            return res.status(400).json({
                success: false,
                message: "companyId and salesPersonId are required"
            });
        }

        // Convert IDs to strings safely
        const companyIdStr = safeString(companyId);
        const salesPersonIdStr = safeString(salesPersonId);

        // Validate MongoDB ObjectIds
        if (!mongoose.Types.ObjectId.isValid(companyIdStr) ||
            !mongoose.Types.ObjectId.isValid(salesPersonIdStr)) {
            return res.status(400).json({
                success: false,
                message: "Invalid companyId or salesPersonId format"
            });
        }

        /* ============================================================
        DATE FILTER
        ============================================================ */

        let dateFilter = {};

        // FIX: hoisted so we can also apply these bounds per-visitLog below.
        // Previously the date filter only restricted which SESSIONS were
        // fetched (via session-level punchInTime), but a session can contain
        // many visitLogs across different days, so out-of-range visit logs
        // were still showing up in the export. We now also bound each log.
        let fromDateBound = null;
        let toDateBound = null;

        if (fromDate || toDate) {
            dateFilter.punchInTime = {};

            if (fromDate) {
                const fromDateObj = new Date(fromDate);
                if (isNaN(fromDateObj.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid fromDate format"
                    });
                }
                fromDateObj.setHours(0, 0, 0, 0);
                dateFilter.punchInTime.$gte = fromDateObj;
                fromDateBound = fromDateObj;
            }

            if (toDate) {
                const toDateObj = new Date(toDate);
                if (isNaN(toDateObj.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid toDate format"
                    });
                }
                toDateObj.setHours(23, 59, 59, 999);
                dateFilter.punchInTime.$lte = toDateObj;
                toDateBound = toDateObj;
            }
        }

        /* ============================================================
        GET EMPLOYEE
        ============================================================ */

        const employee = await Employee.findOne({
            companyId: new mongoose.Types.ObjectId(companyIdStr),
            userId: new mongoose.Types.ObjectId(salesPersonIdStr)
        }).populate("userId", "name");

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        /* ============================================================
        GET SESSIONS
        ============================================================ */

        const sessions = await SalesSession.find({
            companyId: new mongoose.Types.ObjectId(companyIdStr),
            $or: [
                { employeeId: new mongoose.Types.ObjectId(salesPersonIdStr) },
                { assignedTo: new mongoose.Types.ObjectId(salesPersonIdStr) },
                { createdBy: new mongoose.Types.ObjectId(salesPersonIdStr) }
            ],
            ...dateFilter
        })
            .sort({ punchInTime: 1 })
            .lean();

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No sessions found"
            });
        }

        /* ============================================================
        BUILD EXPORT ROWS
        ============================================================ */

        let exportRows = [];
        let previousLocation = null;
        let srNo = 1;

        for (const session of sessions) {
            try {
                const customer = session.customer || {};
                const visitLogs = Array.isArray(session.visitLogs)
                    ? session.visitLogs
                    : [];
                const salesLogs = Array.isArray(session.salesLogs)
                    ? session.salesLogs
                    : [];
                const meetingLogs = Array.isArray(session.meetingLogs)
                    ? session.meetingLogs
                    : [];

                for (const log of visitLogs) {
                    try {
                        /* ============================================================
                        ONLY THIS SALESPERSON VISITS
                        ============================================================ */

                        if (
                            log.userId &&
                            log.userId.toString() !== salesPersonIdStr
                        ) {
                            continue;
                        }

                        /* ============================================================
                        FIX: PER-LOG DATE RANGE CHECK
                        The session-level query above only narrows down which
                        SESSIONS are fetched. A single session can have visit
                        logs spread across many days, so we must also check
                        each individual log's punchInTime against fromDate/toDate,
                        otherwise visits outside the requested range still appear.
                        ============================================================ */

                        if (fromDateBound || toDateBound) {
                            const logPunchInForFilter = log?.punchInTime
                                ? new Date(log.punchInTime)
                                : null;

                            if (!logPunchInForFilter || isNaN(logPunchInForFilter.getTime())) {
                                continue;
                            }
                            if (fromDateBound && logPunchInForFilter < fromDateBound) {
                                continue;
                            }
                            if (toDateBound && logPunchInForFilter > toDateBound) {
                                continue;
                            }
                        }

                        /* ============================================================
                        DISTANCE CALCULATION - FIXED WITH SAFE NUMBER CONVERSION
                        ============================================================ */

                        const punchInCoords =
                            log?.punchInLocation?.coordinates || [];
                        const punchOutCoords =
                            log?.punchOutLocation?.coordinates || [];

                        let visitDistance = 0;

                        if (
                            Array.isArray(punchInCoords) &&
                            punchInCoords.length === 2 &&
                            Array.isArray(punchOutCoords) &&
                            punchOutCoords.length === 2
                        ) {
                            // FIXED: Ensure coordinates are properly parsed as numbers
                            const lat1 = parseFloat(punchInCoords[1]);
                            const lon1 = parseFloat(punchInCoords[0]);
                            const lat2 = parseFloat(punchOutCoords[1]);
                            const lon2 = parseFloat(punchOutCoords[0]);

                            if (!isNaN(lat1) && !isNaN(lon1) &&
                                !isNaN(lat2) && !isNaN(lon2)) {
                                visitDistance = calculateDistance(
                                    lat1, lon1, lat2, lon2
                                );
                            }
                        }

                        let previousDistance = 0;

                        if (
                            previousLocation &&
                            Array.isArray(punchInCoords) &&
                            punchInCoords.length === 2
                        ) {
                            const currentLat = parseFloat(punchInCoords[1]);
                            const currentLon = parseFloat(punchInCoords[0]);

                            if (!isNaN(currentLat) && !isNaN(currentLon)) {
                                previousDistance = calculateDistance(
                                    previousLocation.lat,
                                    previousLocation.lng,
                                    currentLat,
                                    currentLon
                                );
                            }
                        }

                        /* ============================================================
                        SAVE CURRENT LOCATION
                        ============================================================ */

                        if (
                            Array.isArray(punchOutCoords) &&
                            punchOutCoords.length === 2
                        ) {
                            const outLat = parseFloat(punchOutCoords[1]);
                            const outLon = parseFloat(punchOutCoords[0]);

                            if (!isNaN(outLat) && !isNaN(outLon)) {
                                previousLocation = {
                                    lat: outLat,
                                    lng: outLon
                                };
                            }
                        }

                        /* ============================================================
                        SALES DATA
                        ============================================================ */

                        const firstSalesLog = salesLogs[0] || {};
                        const firstMeetingLog = meetingLogs[0] || {};

                        /* ============================================================
                        CALL GENERATION - FIXED LOGIC
                        ============================================================ */

                        let callGeneration = "Own"; // Default value

                        if (Array.isArray(session?.assignedTo)) {
                            const isAssigned = session.assignedTo.some(
                                id => {
                                    try {
                                        return id && id.toString() === salesPersonIdStr;
                                    } catch {
                                        return false;
                                    }
                                }
                            );
                            callGeneration = isAssigned ? "Transferred" : "Own";
                        }

                        /* ============================================================
                        FORMAT DATES & TIMES SAFELY
                        ============================================================ */

                        const punchInTime = log?.punchInTime
                            ? new Date(log.punchInTime)
                            : null;
                        const punchOutTime = log?.punchOutTime
                            ? new Date(log.punchOutTime)
                            : null;
                        const nextMeetingDate =
                            session?.nextMeeting?.date
                                ? new Date(session.nextMeeting.date)
                                : null;

                        // Validate dates
                        const isValidDate = (date) => {
                            return date instanceof Date && !isNaN(date.getTime());
                        };

                        /* ============================================================
                        PUSH ROW - ALL VALUES AS STRINGS TO PREVENT TYPE ERRORS
                        ============================================================ */

                        exportRows.push({
                            "S.N": String(srNo++),
                            "Call Id": safeString(session.sessionId, "-"),
                            "Date": isValidDate(punchInTime)
                                ? punchInTime.toLocaleDateString("en-IN")
                                : "-",
                            "Sales Person Name": safeString(
                                employee?.userId?.name ||
                                employee?.user_name
                            ),
                            "Call Generation": safeString(callGeneration),
                            "Check In": isValidDate(punchInTime)
                                ? punchInTime.toLocaleTimeString("en-IN")
                                : "-",
                            "Check Out": isValidDate(punchOutTime)
                                ? punchOutTime.toLocaleTimeString("en-IN")
                                : "-",
                            "Distance Between CheckIn & CheckOut (KM)":
                                String(safeNumber(visitDistance)),
                            "Distance From Previous Call (KM)":
                                String(safeNumber(previousDistance)),
                            "Company Name": safeString(customer.companyName),
                            "Contact Person": safeString(customer.contactName),
                            "Contact Number": safeString(customer.phoneNumber),
                            "Customer Address": safeString(customer.address),
                            "Sales Service Outcome": safeString(
                                firstSalesLog?.dealStatus
                            ),
                            "Payment": firstSalesLog?.paymentCollected
                                ? "Collected"
                                : "Pending",
                            "Amount": String(safeNumber(firstSalesLog?.amount)),
                            "Payment Mode": safeString(
                                firstSalesLog?.paymentMode
                            ),
                            "Sales Status": safeString(session?.SalesStatus),
                            "Next Meeting Date": isValidDate(nextMeetingDate)
                                ? nextMeetingDate.toLocaleDateString("en-IN")
                                : "-",
                            "Meeting Notes": safeString(
                                firstMeetingLog?.notes
                            ),
                            "Session Status": safeString(session?.status)
                        });
                    } catch (logError) {
                        console.error("Error processing log:", logError);
                        continue;
                    }
                }
            } catch (sessionError) {
                console.error("Error processing session:", sessionError);
                continue;
            }
        }

        /* ============================================================
        VALIDATION: CHECK IF ROWS EXIST
        ============================================================ */

        if (!exportRows || exportRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No data available for export"
            });
        }

        /* ============================================================
        CSV PARSER - ENSURE ALL FIELDS ARE STRINGS
        ============================================================ */

        const fields = Object.keys(exportRows[0]);

        const json2csvParser = new Parser({
            fields,
            header: true,
            delimiter: ",",
            quote: '"',
            // Add escape character handling
            escapedQuote: '""'
        });

        let csv = "";
        try {
            csv = json2csvParser.parse(exportRows);

            // Add BOM for Excel compatibility
            const BOM = '\uFEFF';
            csv = BOM + csv;

        } catch (parseError) {
            console.error("CSV PARSE ERROR:", parseError);
            return res.status(500).json({
                success: false,
                message: "Failed to parse CSV",
                error: parseError.message
            });
        }

        /* ============================================================
        EXPORT DIRECTORY
        ============================================================ */

        const exportDir = path.join(process.cwd(), "exports");

        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        /* ============================================================
        FILE PATH
        ============================================================ */

        const timestamp = Date.now();
        const sanitizedFileName = `Sales_Visit_Report_${salesPersonIdStr}_${timestamp}.csv`
            .replace(/[^a-zA-Z0-9_.-]/g, '_'); // Sanitize filename

        filePath = path.join(exportDir, sanitizedFileName);

        /* ============================================================
        WRITE FILE WITH PROPER ENCODING
        ============================================================ */

        fs.writeFileSync(filePath, csv, { encoding: "utf8" });

        // Verify file was created and has content
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            return res.status(500).json({
                success: false,
                message: "Failed to create export file"
            });
        }

        /* ============================================================
        SET RESPONSE HEADERS
        ============================================================ */

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${sanitizedFileName}"`
        );
        res.setHeader("Content-Length", fs.statSync(filePath).size);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

        /* ============================================================
        SEND FILE
        ============================================================ */

        const fileStream = fs.createReadStream(filePath, {
            encoding: "utf-8",
            highWaterMark: 64 * 1024 // 64KB chunks for better performance
        });

        fileStream.on("error", (err) => {
            console.error("STREAM ERROR:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: "Error reading file",
                    error: err.message
                });
            }
        });

        // Use pipeline for better error handling
        const { pipeline } = await import('stream');
        pipeline(fileStream, res, (err) => {
            if (err) {
                console.error("PIPELINE ERROR:", err);
            }

            // Cleanup after sending
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (cleanupErr) {
                console.error("CLEANUP ERROR:", cleanupErr);
            }
        });

    } catch (error) {
        console.error("EXPORT ERROR:", error);

        // Cleanup file if error occurs
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (cleanupErr) {
            console.error("CLEANUP ERROR:", cleanupErr);
        }

        return res.status(500).json({
            success: false,
            message: "Failed to export report",
            error: error.message
        });
    }
};

/**
 * @desc    Export Sales Reports (Company-specific data only)
 * @route   GET /api/sales/reports/export
 * @access  Private (Company Admin/Manager - only sees their company data)
 */

export const exportSalesReport = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            employeeId,      // Single employee ID
            employeeIds,     // Multiple employee IDs
            status,          // SalesStatus filter
            sessionStatus,   // Session status filter
            format = 'csv'
        } = req.query;

        // ============================================
        // SECURITY: Extract company ID from authenticated user
        // FIX: original code had a typo `re.use?.id` (undefined variable `re`)
        // which would throw a ReferenceError whenever req.user?._id was falsy.
        // ============================================
        const companyId = req.user?._id || req.user?.id;
        console.log("Authenticated User ID:", req.user?._id);
        console.log("Company ID:", companyId);
        if (!companyId) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Company ID not found."
            });
        }

        // ============================================
        // STEP 1: Get ALL employees of this company
        // ============================================
        const companyEmployees = await Employee.find({
            companyId: companyId,
            employmentStatus: "active"
        }).select('userId user_name empCode employeeType role').lean();
        console.log(`Found ${companyEmployees.length} active employees for company`);

        if (!companyEmployees || companyEmployees.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No employees found for this company"
            });
        }

        // Create valid employee IDs set
        const validEmployeeIds = new Set(
            companyEmployees.map(emp => emp.userId?.toString()).filter(Boolean)
        );

        // Employee details map
        const employeeDetailsMap = new Map();
        companyEmployees.forEach(emp => {
            if (emp.userId) {
                employeeDetailsMap.set(emp.userId.toString(), {
                    userId: emp.userId,
                    user_name: emp.user_name || 'Unknown',
                    empCode: emp.empCode || 'N/A',
                    employeeType: emp.employeeType || 'non_sales',
                    role: emp.role || 'employee'
                });
            }
        });

        // ============================================
        // STEP 2: Determine which employees to filter
        // ============================================
        let targetEmployeeIds = [];

        // Handle single employeeId
        if (employeeId) {
            const empIdStr = employeeId.toString();
            if (!validEmployeeIds.has(empIdStr)) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Employee does not belong to your company."
                });
            }
            targetEmployeeIds = [empIdStr];
        }
        // Handle multiple employeeIds
        else if (employeeIds) {
            const parsedIds = Array.isArray(employeeIds)
                ? employeeIds
                : employeeIds.split(',').map(id => id.trim());

            // Validate all belong to company
            const invalidIds = parsedIds.filter(id => !validEmployeeIds.has(id.toString()));
            if (invalidIds.length > 0) {
                return res.status(403).json({
                    success: false,
                    message: `Access denied. Employees [${invalidIds.join(', ')}] do not belong to your company.`
                });
            }
            targetEmployeeIds = parsedIds.map(id => id.toString());
        }
        // If no employee filter, get ALL company employees
        else {
            targetEmployeeIds = [...validEmployeeIds];
        }

        // Remove duplicates
        targetEmployeeIds = [...new Set(targetEmployeeIds)];

        // ============================================
        // STEP 3: Build query - GET ALL SESSIONS associated with these employees
        // ============================================
        const query = {
            companyId: companyId  // Always filter by company first
        };

        // Employee match condition - session belongs to an employee if they
        // appear ANYWHERE (main employee, creator, assignee, or inside any log)
        const employeeOrConditions = [
            { employeeId: { $in: targetEmployeeIds } },           // Main employee
            { createdBy: { $in: targetEmployeeIds } },            // Created by
            { assignedTo: { $in: targetEmployeeIds } },           // Assigned to
            { 'visitLogs.userId': { $in: targetEmployeeIds } },    // In visit logs
            { 'salesLogs.userId': { $in: targetEmployeeIds } },    // In sales logs
            { 'meetingLogs.userId': { $in: targetEmployeeIds } }   // In meeting logs
        ];

        // ============================================
        // STEP 4: Date range filter (if provided)
        // ============================================
        // FIX: The original code pushed the date conditions into the SAME
        // $or array as the employee conditions:
        //   query.$or = [...employee conditions...];
        //   query.$or.push(...date conditions...);
        // That made Mongo match documents where "ANY employee condition
        // matches OR ANY date condition matches" instead of
        // "employee matches AND date matches" — so the date range filter
        // was effectively ignored (and could even leak in wrong employees).
        // Fix: keep employee conditions and date conditions in their own
        // $or blocks, and combine those two blocks with $and.
        if (startDate || endDate) {
            const dateFilter = {};

            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                dateFilter.$gte = start;
            }

            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFilter.$lte = end;
            }

            // Check multiple date fields
            const dateOrConditions = [
                { punchInTime: dateFilter },
                { createdAt: dateFilter },
                { 'visitLogs.punchInTime': dateFilter }
            ];

            // Combine: (employee match) AND (date match)
            query.$and = [
                { $or: employeeOrConditions },
                { $or: dateOrConditions }
            ];
        } else {
            query.$or = employeeOrConditions;
        }

        console.log("Target Employee IDs:", targetEmployeeIds);
        console.log("Final Query:", JSON.stringify(query, null, 2));

        // ============================================
        // STEP 6: Fetch sessions
        // ============================================
        const sessions = await SalesSession.find(query)
            .populate({
                path: 'employeeId',
                select: 'user_name empCode'
            })
            .populate({
                path: 'createdBy',
                select: 'user_name empCode'
            })
            .populate({
                path: 'assignedTo',
                select: 'user_name empCode'
            })
            .populate({
                path: 'visitLogs.userId',
                select: 'user_name empCode'
            })
            .populate({
                path: 'salesLogs.userId',
                select: 'user_name empCode'
            })
            .populate({
                path: 'meetingLogs.userId',
                select: 'user_name empCode'
            })
            .sort({ createdAt: -1 })
            .lean();

        console.log(`Found ${sessions.length} sessions for employee(s)`);

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No sales data found for the given criteria",
                filters: {
                    companyId: companyId.toString(),
                    employeeIds: targetEmployeeIds,
                    startDate,
                    endDate,
                    status,
                    sessionStatus
                }
            });
        }

        // ============================================
        // STEP 7: Process sessions and create report rows
        // ============================================
        const reportData = [];

        for (const session of sessions) {
            // Get ALL employees involved in this session that belong to the company
            const involvedEmployees = new Map();

            const addEmployeeIfValid = (userId, populatedUser) => {
                if (!userId) return;
                const userIdStr = userId._id ? userId._id.toString() : userId.toString();

                // Only include if employee belongs to this company AND is in our target list
                if (validEmployeeIds.has(userIdStr) && targetEmployeeIds.includes(userIdStr)) {
                    if (!involvedEmployees.has(userIdStr)) {
                        const empDetails = employeeDetailsMap.get(userIdStr);
                        involvedEmployees.set(userIdStr, {
                            userId: userId._id || userId,
                            empCode: populatedUser?.empCode || empDetails?.empCode || 'N/A',
                            user_name: populatedUser?.user_name || empDetails?.user_name || 'Unknown',
                            employeeType: empDetails?.employeeType || 'non_sales',
                            role: empDetails?.role || 'employee'
                        });
                    }
                }
            };

            // Check all possible locations where employee could appear
            if (session.employeeId) addEmployeeIfValid(session.employeeId._id, session.employeeId);
            if (session.createdBy) addEmployeeIfValid(session.createdBy._id, session.createdBy);

            if (session.assignedTo && Array.isArray(session.assignedTo)) {
                session.assignedTo.forEach(assigned => {
                    if (assigned) addEmployeeIfValid(assigned._id || assigned, assigned);
                });
            }

            session.visitLogs?.forEach(log => {
                if (log.userId) addEmployeeIfValid(log.userId._id, log.userId);
            });

            session.salesLogs?.forEach(log => {
                if (log.userId) addEmployeeIfValid(log.userId._id, log.userId);
            });

            session.meetingLogs?.forEach(log => {
                if (log.userId) addEmployeeIfValid(log.userId._id, log.userId);
            });

            // Create rows for each involved employee
            if (involvedEmployees.size === 0 && targetEmployeeIds.length > 0) {
                // If session has no direct employee match but should be included
                // Create a row with session data but unknown employee
                reportData.push({
                    ...createCompanyReportRow(session, null),
                    empCode: 'N/A',
                    empName: 'Unknown Employee',
                    employeeType: 'N/A',
                    role: 'N/A'
                });
            } else {
                for (const [empId, empData] of involvedEmployees) {
                    reportData.push(createCompanyReportRow(session, empData));
                }
            }
        }

        // ============================================
        // STEP 8: Generate CSV
        // ============================================
        if (reportData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No report data to export"
            });
        }

        const fields = [
            { label: 'Date', value: 'date' },
            { label: 'Employee Code', value: 'empCode' },
            { label: 'Employee Name', value: 'empName' },
            { label: 'Employee Type', value: 'employeeType' },
            { label: 'Role', value: 'role' },
            { label: 'Customer ID', value: 'customerId' },
            { label: 'Company Name', value: 'companyName' },
            { label: 'Contact Name', value: 'contactName' },
            { label: 'Phone Number', value: 'phoneNumber' },
            { label: 'Address', value: 'address' },
            { label: 'Landmark', value: 'landmark' },
            { label: 'Customer Location', value: 'customerLocation' },
            { label: 'Sales Logs', value: 'salesLogs' },
            { label: 'Total Sales Amount', value: 'totalSalesAmount' },
            { label: 'Payment Collected', value: 'paymentCollected' },
            { label: 'Meeting Logs', value: 'meetingLogs' },
            { label: 'Next Meeting Decided', value: 'nextMeetingDecided' },
            { label: 'Next Meeting Date', value: 'nextMeetingDate' },
            { label: 'Next Meeting Time', value: 'nextMeetingTime' },
            { label: 'Next Meeting Notes', value: 'nextMeetingNotes' },
            { label: 'Sales Status', value: 'salesStatus' },
            { label: 'Session Status', value: 'sessionStatus' },
            { label: 'Form Completed', value: 'formCompleted' },
            { label: 'Session Created', value: 'sessionCreated' },
            { label: 'Punch In Time', value: 'punchInTime' },
            { label: 'Punch In Location', value: 'punchInLocation' },
            { label: 'Punch Out Time', value: 'punchOutTime' },
            { label: 'Punch Out Location', value: 'punchOutLocation' },
            { label: 'Punch Out Address', value: 'punchOutAddress' },
            { label: 'Duration (minutes)', value: 'duration' },
            { label: 'Total Distance (km)', value: 'totalDistance' }
        ];

        const json2csvParser = new Parser({ fields, delimiter: ',', quote: '"', header: true });
        const csv = json2csvParser.parse(reportData);

        // Generate filename
        const companyName = req.user?.companyName || 'Company';
        const employeeName = targetEmployeeIds.length === 1
            ? employeeDetailsMap.get(targetEmployeeIds[0])?.user_name || 'Employee'
            : 'Multiple_Employees';
        const dateRange = startDate && endDate
            ? `${startDate.split('T')[0]}_to_${endDate.split('T')[0]}`
            : new Date().toISOString().split('T')[0];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `Sales_Visit_Report_${companyName}_${employeeName}_${dateRange}_${timestamp}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const BOM = '\uFEFF';
        return res.status(200).send(BOM + csv);

    } catch (error) {
        console.error("Export Sales Report Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate sales report",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

/**
 * Helper function to create a formatted row for company report
 */
const createCompanyReportRow = (session, employeeData) => {
    // Format sales logs for this employee only
    const salesLogsFormatted = (session.salesLogs || [])
        .filter(log => {
            if (!employeeData) return true; // Include all if no specific employee
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .map(log => {
            const parts = [];
            if (log.dealStatus) parts.push(`Status: ${log.dealStatus}`);
            if (log.amount) parts.push(`Amount: ₹${log.amount.toLocaleString()}`);
            if (log.paymentCollected !== undefined) parts.push(`Payment: ${log.paymentCollected ? 'Yes' : 'No'}`);
            if (log.paymentMode) parts.push(`Mode: ${log.paymentMode}`);
            if (log.note) parts.push(`Note: ${log.note}`);
            if (log.createdAt) parts.push(`Date: ${new Date(log.createdAt).toLocaleDateString()}`);
            return parts.join(' | ');
        })
        .filter(Boolean)
        .join('\n');

    // Calculate total sales amount for this employee
    const employeeSalesAmount = (session.salesLogs || [])
        .filter(log => {
            if (!employeeData) return true;
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .reduce((sum, log) => sum + (log.amount || 0), 0);

    // Check if payment was collected
    const hasPaymentCollected = (session.salesLogs || [])
        .filter(log => {
            if (!employeeData) return true;
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .some(log => log.paymentCollected);

    // Format meeting logs for this employee only
    const meetingLogsFormatted = (session.meetingLogs || [])
        .filter(log => {
            if (!employeeData) return true;
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .map(log => {
            const parts = [];
            if (log.date) parts.push(`Date: ${new Date(log.date).toLocaleDateString()}`);
            if (log.time) parts.push(`Time: ${log.time}`);
            if (log.notes) parts.push(`Notes: ${log.notes}`);
            return parts.join(' | ');
        })
        .filter(Boolean)
        .join('\n');

    // Format locations
    const formatCoordinates = (location) => {
        if (location?.coordinates?.length === 2) {
            return `${location.coordinates[1].toFixed(6)}, ${location.coordinates[0].toFixed(6)}`;
        }
        return '';
    };

    return {
        // Date & Employee Info
        date: session.createdAt ? new Date(session.createdAt).toISOString().split('T')[0] : '',
        empCode: employeeData?.empCode || 'N/A',
        empName: employeeData?.user_name || 'Unknown',
        employeeType: employeeData?.employeeType || 'N/A',
        role: employeeData?.role || 'N/A',

        // Customer Information
        customerId: session.customer?.customerId || '',
        companyName: session.customer?.companyName || '',
        contactName: session.customer?.contactName || '',
        phoneNumber: session.customer?.phoneNumber || '',
        address: session.customer?.address || '',
        landmark: session.customer?.landmark || '',
        customerLocation: formatCoordinates(session.customer?.location),

        // Sales Information
        salesLogs: salesLogsFormatted || 'No sales logs',
        totalSalesAmount: employeeSalesAmount || 0,
        paymentCollected: hasPaymentCollected ? 'Yes' : 'No',

        // Meeting Information
        meetingLogs: meetingLogsFormatted || 'No meeting logs',
        nextMeetingDecided: session.nextMeeting?.decided ? 'Yes' : 'No',
        nextMeetingDate: session.nextMeeting?.date
            ? new Date(session.nextMeeting.date).toLocaleDateString()
            : '',
        nextMeetingTime: session.nextMeeting?.time || '',
        nextMeetingNotes: session.nextMeeting?.notes || '',

        // Status
        salesStatus: session.SalesStatus || 'N/A',
        sessionStatus: session.status || 'N/A',
        formCompleted: session.formCompleted ? 'Yes' : 'No',

        // Time Tracking
        sessionCreated: session.createdAt ? new Date(session.createdAt).toLocaleString() : '',
        punchInTime: session.punchInTime ? new Date(session.punchInTime).toLocaleString() : '',
        punchInLocation: formatCoordinates(session.punchInLocation),
        punchOutTime: session.punchOutTime ? new Date(session.punchOutTime).toLocaleString() : '',
        punchOutLocation: formatCoordinates(session.punchOutLocation),
        punchOutAddress: session.punchOutAddress || '',
        duration: session.duration ? Math.round(session.duration / 60) : 0,
        totalDistance: session.totalDistance ? Math.round(session.totalDistance / 1000 * 100) / 100 : 0
    };
};


/* ============================================================
CONTROLLER: Export Sales Data to CSV
============================================================ */

export const exportDataSalesCSV = async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;

        let matchFilter = {};
        if (companyId) {
            matchFilter.companyId = new mongoose.Types.ObjectId(companyId);
        }
        if (startDate || endDate) {
            matchFilter.createdAt = {};
            if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                matchFilter.createdAt.$lte = end;
            }
        }

        const salesData = await SalesSession.aggregate([
            { $match: matchFilter },

            // ── STEP 1: Compute per-session visit stats BEFORE unwinding salesLogs ──
            {
                $addFields: {
                    sessionCallCount: {
                        $size: { $ifNull: ["$visitLogs", []] }
                    },

                    sessionCallDuration: {
                        $reduce: {
                            input: { $ifNull: ["$visitLogs", []] },
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    {
                                        $let: {
                                            vars: {
                                                // ✅ Use visitLog.punchOutTime if it exists,
                                                //    otherwise fall back to session-level punchOutTime
                                                effectivePunchOut: {
                                                    $ifNull: [
                                                        "$$this.punchOutTime",
                                                        "$punchOutTime"   // ← session-level fallback
                                                    ]
                                                },
                                                // ✅ Use visitLog.punchInTime if it exists,
                                                //    otherwise fall back to session-level punchInTime
                                                effectivePunchIn: {
                                                    $ifNull: [
                                                        "$$this.punchInTime",
                                                        "$punchInTime"    // ← session-level fallback
                                                    ]
                                                }
                                            },
                                            in: {
                                                $cond: {
                                                    if: {
                                                        $and: [
                                                            { $gt: ["$$effectivePunchIn", null] },
                                                            { $gt: ["$$effectivePunchOut", null] },
                                                            // Guard: punchOut must be after punchIn
                                                            { $gt: ["$$effectivePunchOut", "$$effectivePunchIn"] }
                                                        ]
                                                    },
                                                    then: {
                                                        $divide: [
                                                            { $subtract: ["$$effectivePunchOut", "$$effectivePunchIn"] },
                                                            60000  // ms → minutes
                                                        ]
                                                    },
                                                    else: 0
                                                }
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },

            // ── STEP 2: Unwind only salesLogs ──
            {
                $unwind: {
                    path: "$salesLogs",
                    preserveNullAndEmptyArrays: true
                }
            },

            // ── STEP 3: Group by employee ──
            {
                $group: {
                    _id: {
                        employeeId: "$employeeId",
                        createdBy: "$createdBy"
                    },

                    totalCalls: { $sum: "$sessionCallCount" },
                    totalCallDuration: { $sum: "$sessionCallDuration" },

                    totalAmountCollected: {
                        $sum: {
                            $cond: [
                                { $eq: ["$salesLogs.paymentCollected", true] },
                                { $ifNull: ["$salesLogs.amount", 0] },
                                0
                            ]
                        }
                    },

                    totalPaidCount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$salesLogs.paymentCollected", true] },
                                1,
                                0
                            ]
                        }
                    },

                    firstDate: { $min: "$createdAt" },
                    lastDate: { $max: "$createdAt" },

                    employeeIdRef: { $first: "$employeeId" },
                    createdByRef: { $first: "$createdBy" }
                }
            },

            // ── STEP 4: Lookups ──
            {
                $lookup: {
                    from: "users",
                    localField: "employeeIdRef",
                    foreignField: "_id",
                    as: "employeeDetails"
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "createdByRef",
                    foreignField: "_id",
                    as: "createdByDetails"
                }
            },

            {
                $addFields: {
                    employeeName: {
                        $ifNull: [
                            { $arrayElemAt: ["$employeeDetails.name", 0] },
                            { $arrayElemAt: ["$createdByDetails.name", 0] }
                        ]
                    },
                    employeeEmail: {
                        $arrayElemAt: ["$employeeDetails.email", 0]
                    }
                }
            },

            // ── STEP 5: Derive avg ──
            {
                $addFields: {
                    avgCallTime: {
                        $cond: [
                            { $gt: ["$totalCalls", 0] },
                            { $divide: ["$totalCallDuration", "$totalCalls"] },
                            0
                        ]
                    }
                }
            },

            // ── STEP 6: Project ──
            {
                $project: {
                    _id: 0,
                    salesPersonName: { $ifNull: ["$employeeName", "Unknown"] },
                    employeeEmail: { $ifNull: ["$employeeEmail", ""] },
                    periodFrom: {
                        $dateToString: { format: "%Y-%m-%d", date: "$firstDate" }
                    },
                    periodTo: {
                        $dateToString: { format: "%Y-%m-%d", date: "$lastDate" }
                    },
                    totalCalls: "$totalCalls",
                    totalCallDuration: { $round: ["$totalCallDuration", 2] },
                    avgCallTime: { $round: ["$avgCallTime", 2] },
                    totalAmountCollected: { $round: ["$totalAmountCollected", 2] },
                    totalPaidCount: "$totalPaidCount"
                }
            },

            { $sort: { salesPersonName: 1 } }
        ]);

        if (!salesData.length) {
            return res.status(404).json({
                success: false,
                message: "No data found for the selected criteria"
            });
        }

        // ── Build CSV ──────────────────────────────────────────────
        const csvRows = [];

        const rangeFrom = startDate
            ? new Date(startDate).toISOString().slice(0, 10)
            : "All time";
        const rangeTo = endDate
            ? new Date(endDate).toISOString().slice(0, 10)
            : "All time";

        csvRows.push(`"Sales Summary Report"`);
        csvRows.push(`"Period:","${rangeFrom} to ${rangeTo}"`);
        csvRows.push(`"Generated:","${new Date().toISOString().slice(0, 19).replace("T", " ")}"`);
        csvRows.push("");

        csvRows.push([
            "Sales Person Name",
            "Email",
            "Period From",
            "Period To",
            "Total Calls",
            "Total Call Duration (min)",
            "Avg Call Time (min)",
            "Total Amount Collected",
            "Total Paid Count"
        ].join(","));

        for (const row of salesData) {
            csvRows.push([
                `"${row.salesPersonName.replace(/"/g, '""')}"`,
                `"${row.employeeEmail.replace(/"/g, '""')}"`,
                row.periodFrom || "",
                row.periodTo || "",
                row.totalCalls || 0,
                row.totalCallDuration || 0,
                row.avgCallTime || 0,
                row.totalAmountCollected || 0,
                row.totalPaidCount || 0
            ].join(","));
        }

        // Grand total row
        const grandTotal = salesData.reduce(
            (acc, r) => {
                acc.totalCalls += r.totalCalls || 0;
                acc.totalCallDuration += r.totalCallDuration || 0;
                acc.totalAmountCollected += r.totalAmountCollected || 0;
                acc.totalPaidCount += r.totalPaidCount || 0;
                return acc;
            },
            { totalCalls: 0, totalCallDuration: 0, totalAmountCollected: 0, totalPaidCount: 0 }
        );

        csvRows.push([
            '"TOTAL"', '""', '""', '""',
            grandTotal.totalCalls,
            grandTotal.totalCallDuration.toFixed(2),
            '""',
            grandTotal.totalAmountCollected.toFixed(2),
            grandTotal.totalPaidCount
        ].join(","));

        const csvContent = csvRows.join("\n");
        const filename = `Sales_Audit_Report_${rangeFrom}_to_${rangeTo}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send("\uFEFF" + csvContent);

    } catch (error) {
        console.error("Error exporting sales CSV:", error);
        res.status(500).json({
            success: false,
            message: "Failed to export sales data",
            error: error.message
        });
    }
};


/* ============================================================
HELPERS
============================================================ */

// Safely pull [lng, lat] out of a geoPoint, or return blanks
const coords = (geo) => {
    if (!geo || !Array.isArray(geo.coordinates)) return { lng: "", lat: "" };
    return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
};

const sendCsv = (res, filename, rows, fields) => {
    if (!rows.length) {
        return res.status(404).json({ success: false, message: "No data found for the given filters" });
    }
    const parser = new Parser({ fields });
    const csv = parser.parse(rows);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
};



/* ============================================================
REPORT 1: CRM REPORT
Customer data + punch-in data, one row per session
GET /api/reports/crm?companyId=&startDate=&endDate=
============================================================ */
export const exportCrmReport = async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;

        const filter = {};
        if (companyId) filter.companyId = companyId;

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const sessions = await SalesSession.find(filter)
            .populate("employeeId", "name email phone")
            .populate("createdBy", "name email")
            .lean();

        const rows = sessions.map((s) => {
            const custLoc = coords(s.customer?.location);
            const punchInLoc = coords(s.punchInLocation);

            return {
                sessionId: s.sessionId,
                status: s.status,
                salesStatus: s.SalesStatus,

                // ---- Customer data ----
                customerId: s.customer?.customerId || "",
                companyName: s.customer?.companyName || "",
                contactName: s.customer?.contactName || "",
                phoneNumber: s.customer?.phoneNumber || "",
                address: s.customer?.address || "",
                landmark: s.customer?.landmark || "",
                customerLng: custLoc.lng,
                customerLat: custLoc.lat,
                shopPhotoCount: s.customer?.shopPhoto?.length || 0,

                // ---- Punch-in data ----
                employeeName: s.employeeId?.name || "",
                employeeEmail: s.employeeId?.email || "",
                punchInTime: s.punchInTime ? new Date(s.punchInTime).toISOString() : "",
                punchInLng: punchInLoc.lng,
                punchInLat: punchInLoc.lat,

                createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
            };
        });

        const fields = [
            "sessionId", "status", "salesStatus",
            "customerId", "companyName", "contactName", "phoneNumber",
            "address", "landmark", "customerLng", "customerLat", "shopPhotoCount",
            "employeeName", "employeeEmail", "punchInTime", "punchInLng", "punchInLat",
            "createdAt",
        ];

        return sendCsv(res, `crm-report-${Date.now()}.csv`, rows, fields);
    } catch (err) {
        console.error("exportCrmReport error:", err);
        return res.status(500).json({ success: false, message: "Failed to generate CRM report" });
    }
};

/* ============================================================
REPORT 2: SALES PERSON EXIT REPORT
ALL data for sessions belonging to one particular person
GET /api/reports/sales-person-exit?personId=&startDate=&endDate=
============================================================ */
export const exportSalesPersonExitReport = async (req, res) => {
    try {
        const { personId, startDate, endDate } = req.query;

        if (!personId) {
            return res.status(400).json({ success: false, message: "personId is required" });
        }

        const filter = {
            $or: [
                { employeeId: personId },
                { createdBy: personId },
                { assignedTo: personId },
            ],
        };

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const sessions = await SalesSession.find(filter)
            .populate("employeeId", "name email phone")
            .populate("createdBy", "name email")
            .populate("assignedTo", "name email")
            .lean();

        const rows = sessions.map((s) => {
            const custLoc = coords(s.customer?.location);
            const punchInLoc = coords(s.punchInLocation);
            const punchOutLoc = coords(s.punchOutLocation);

            return {
                sessionId: s.sessionId,
                status: s.status,
                salesStatus: s.SalesStatus,
                formCompleted: s.formCompleted,

                // ---- Customer ----
                customerId: s.customer?.customerId || "",
                companyName: s.customer?.companyName || "",
                contactName: s.customer?.contactName || "",
                phoneNumber: s.customer?.phoneNumber || "",
                address: s.customer?.address || "",
                landmark: s.customer?.landmark || "",
                customerLng: custLoc.lng,
                customerLat: custLoc.lat,

                // ---- People ----
                employeeName: s.employeeId?.name || "",
                employeeEmail: s.employeeId?.email || "",
                createdByName: s.createdBy?.name || "",
                assignedTo: (s.assignedTo || []).map((u) => u.name || u._id).join("; "),

                // ---- Punch info ----
                punchInTime: s.punchInTime ? new Date(s.punchInTime).toISOString() : "",
                punchInLng: punchInLoc.lng,
                punchInLat: punchInLoc.lat,
                punchOutTime: s.punchOutTime ? new Date(s.punchOutTime).toISOString() : "",
                punchOutLng: punchOutLoc.lng,
                punchOutLat: punchOutLoc.lat,
                punchOutAddress: s.punchOutAddress || "",
                lastPunchAt: s.lastPunchAt ? new Date(s.lastPunchAt).toISOString() : "",

                // ---- Route / distance ----
                totalDistance: s.totalDistance || 0,
                duration: s.duration || 0,
                routePointsCount: (s.routePath || []).length,

                // ---- Logs (summarized counts + raw JSON for full detail) ----
                visitLogsCount: (s.visitLogs || []).length,
                salesLogsCount: (s.salesLogs || []).length,
                meetingLogsCount: (s.meetingLogs || []).length,
                visitNotesCount: (s.visitNotes || []).length,

                visitLogsJson: JSON.stringify(s.visitLogs || []),
                salesLogsJson: JSON.stringify(s.salesLogs || []),
                meetingLogsJson: JSON.stringify(s.meetingLogs || []),
                visitNotesJson: JSON.stringify(s.visitNotes || []),
                routePathJson: JSON.stringify(s.routePath || []),

                // ---- Next meeting ----
                nextMeetingDecided: s.nextMeeting?.decided || false,
                nextMeetingDate: s.nextMeeting?.date ? new Date(s.nextMeeting.date).toISOString() : "",
                nextMeetingTime: s.nextMeeting?.time || "",
                nextMeetingNotes: s.nextMeeting?.notes || "",

                // ---- Evidence ----
                evidenceVisitNotes: s.evidence?.visitNotes || "",
                evidenceVisitPhotoUrl: s.evidence?.visitPhoto?.url || "",

                createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
                updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "",
            };
        });

        const fields = [
            "sessionId", "status", "salesStatus", "formCompleted",
            "customerId", "companyName", "contactName", "phoneNumber", "address", "landmark",
            "customerLng", "customerLat",
            "employeeName", "employeeEmail", "createdByName", "assignedTo",
            "punchInTime", "punchInLng", "punchInLat",
            "punchOutTime", "punchOutLng", "punchOutLat", "punchOutAddress", "lastPunchAt",
            "totalDistance", "duration", "routePointsCount",
            "visitLogsCount", "salesLogsCount", "meetingLogsCount", "visitNotesCount",
            "visitLogsJson", "salesLogsJson", "meetingLogsJson", "visitNotesJson", "routePathJson",
            "nextMeetingDecided", "nextMeetingDate", "nextMeetingTime", "nextMeetingNotes",
            "evidenceVisitNotes", "evidenceVisitPhotoUrl",
            "createdAt", "updatedAt",
        ];

        return sendCsv(res, `sales-person-exit-report-${personId}-${Date.now()}.csv`, rows, fields);
    } catch (err) {
        console.error("exportSalesPersonExitReport error:", err);
        return res.status(500).json({ success: false, message: "Failed to generate exit report" });
    }
};