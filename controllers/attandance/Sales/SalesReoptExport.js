import Employee from "../../../models/Attandance/Employee.js";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

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
            employeeId,      // Filter by specific employee (must belong to company)
            employeeIds,     // Multiple employees (must all belong to company)
            status,          // SalesStatus filter
            sessionStatus,   // Session status filter
            format = 'csv'   // csv or excel
        } = req.query;

        // ============================================
        // SECURITY: Extract company ID from authenticated user
        // Company can ONLY access their own data
        // ============================================
        const companyId = req.user?.companyId || req.user?._id;

        if (!companyId) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Company ID not found."
            });
        }

        // ============================================
        // STEP 1: Get ALL employees of this company first
        // ============================================
        const companyEmployees = await Employee.find({
            companyId: companyId,
            employmentStatus: "active"  // Only active employees
        }).select('userId user_name empCode employeeType role').lean();

        if (!companyEmployees || companyEmployees.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No employees found for this company"
            });
        }

        // Create a map of valid employee userIds for this company
        const validEmployeeIds = new Set(
            companyEmployees.map(emp => emp.userId?.toString()).filter(Boolean)
        );

        // Create employee details map for quick lookup
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
        // STEP 2: Validate requested employee filters
        // ============================================
        let requestedEmployeeIds = [];

        if (employeeId) {
            // Check if requested employee belongs to this company
            if (!validEmployeeIds.has(employeeId.toString())) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Employee does not belong to your company."
                });
            }
            requestedEmployeeIds.push(employeeId.toString());
        }

        if (employeeIds) {
            const parsedIds = Array.isArray(employeeIds)
                ? employeeIds
                : employeeIds.split(',').map(id => id.trim());

            // Validate all requested employees belong to this company
            const invalidIds = parsedIds.filter(id => !validEmployeeIds.has(id.toString()));

            if (invalidIds.length > 0) {
                return res.status(403).json({
                    success: false,
                    message: `Access denied. Employees [${invalidIds.join(', ')}] do not belong to your company.`
                });
            }

            requestedEmployeeIds.push(...parsedIds.map(id => id.toString()));
        }

        // If no specific employees requested, use ALL company employees
        if (requestedEmployeeIds.length === 0) {
            requestedEmployeeIds = [...validEmployeeIds];
        } else {
            // Remove duplicates
            requestedEmployeeIds = [...new Set(requestedEmployeeIds)];
        }

        // ============================================
        // STEP 3: Build query with strict company filtering
        // ============================================
        const query = {
            companyId: companyId,  // CRITICAL: Always filter by company
            $or: [
                // Sessions created by company employees
                { createdBy: { $in: requestedEmployeeIds } },
                // Sessions assigned to company employees
                { employeeId: { $in: requestedEmployeeIds } },
                // Sessions where company employees are in visit logs
                { 'visitLogs.userId': { $in: requestedEmployeeIds } },
                // Sessions where company employees are in sales logs
                { 'salesLogs.userId': { $in: requestedEmployeeIds } },
                // Sessions where company employees are in meeting logs
                { 'meetingLogs.userId': { $in: requestedEmployeeIds } }
            ]
        };

        // Date range filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.createdAt.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // Sales Status filter
        if (status) {
            const validStatuses = ["open", "closed", "follow_up"];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
            query.SalesStatus = status;
        }

        // Session Status filter
        if (sessionStatus) {
            const validSessionStatuses = ["in_progress", "completed"];
            if (!validSessionStatuses.includes(sessionStatus)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid session status. Must be one of: ${validSessionStatuses.join(', ')}`
                });
            }
            query.status = sessionStatus;
        }

        // ============================================
        // STEP 4: Fetch sessions with populated data
        // ============================================
        const sessions = await SalesSession.find(query)
            .populate({
                path: 'employeeId',
                select: 'user_name empCode',
                match: { companyId: companyId }  // Extra security: only match company employees
            })
            .populate({
                path: 'createdBy',
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

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No sales data found for the given criteria",
                filters: {
                    companyId,
                    employeeIds: requestedEmployeeIds,
                    startDate,
                    endDate,
                    status,
                    sessionStatus
                }
            });
        }

        // ============================================
        // STEP 5: Process sessions and create report rows
        // ============================================
        const reportData = [];

        for (const session of sessions) {
            // Get unique employees involved in this session
            const involvedEmployees = new Map();

            // Helper to add employee from any log
            const addEmployeeIfValid = (userId, populatedUser) => {
                if (!userId) return;

                const userIdStr = userId._id ? userId._id.toString() : userId.toString();

                // Only include if employee belongs to this company
                if (validEmployeeIds.has(userIdStr)) {
                    const empDetails = employeeDetailsMap.get(userIdStr);
                    involvedEmployees.set(userIdStr, {
                        userId: userId._id || userId,
                        empCode: populatedUser?.empCode || empDetails?.empCode || 'N/A',
                        user_name: populatedUser?.user_name || empDetails?.user_name || 'Unknown',
                        employeeType: empDetails?.employeeType || 'non_sales',
                        role: empDetails?.role || 'employee'
                    });
                }
            };

            // Main employee of the session
            if (session.employeeId) {
                addEmployeeIfValid(session.employeeId._id, session.employeeId);
            }

            // Creator of the session
            if (session.createdBy) {
                addEmployeeIfValid(session.createdBy._id, session.createdBy);
            }

            // Employees from visit logs
            session.visitLogs?.forEach(log => {
                if (log.userId) {
                    addEmployeeIfValid(log.userId._id, log.userId);
                }
            });

            // Employees from sales logs
            session.salesLogs?.forEach(log => {
                if (log.userId) {
                    addEmployeeIfValid(log.userId._id, log.userId);
                }
            });

            // Employees from meeting logs
            session.meetingLogs?.forEach(log => {
                if (log.userId) {
                    addEmployeeIfValid(log.userId._id, log.userId);
                }
            });

            // Create rows for each involved employee or one row if no employees
            if (involvedEmployees.size === 0) {
                // Still create a row with session data but no employee info
                reportData.push(createCompanyReportRow(session, null));
            } else {
                // Create separate rows for each involved employee
                for (const [empId, empData] of involvedEmployees) {
                    reportData.push(createCompanyReportRow(session, empData));
                }
            }
        }

        // ============================================
        // STEP 6: Generate CSV
        // ============================================
        const fields = [
            // Date & Employee Info
            { label: 'Date', value: 'date' },
            { label: 'Employee Code', value: 'empCode' },
            { label: 'Employee Name', value: 'empName' },
            { label: 'Employee Type', value: 'employeeType' },
            { label: 'Role', value: 'role' },

            // Customer Information
            { label: 'Customer ID', value: 'customerId' },
            { label: 'Company Name', value: 'companyName' },
            { label: 'Contact Name', value: 'contactName' },
            { label: 'Phone Number', value: 'phoneNumber' },
            { label: 'Address', value: 'address' },
            { label: 'Landmark', value: 'landmark' },
            { label: 'Customer Location (Lat,Lng)', value: 'customerLocation' },

            // Sales Information
            { label: 'Sales Logs', value: 'salesLogs' },
            { label: 'Total Sales Amount', value: 'totalSalesAmount' },
            { label: 'Payment Collected', value: 'paymentCollected' },

            // Meeting Information
            { label: 'Meeting Logs', value: 'meetingLogs' },
            { label: 'Next Meeting Decided', value: 'nextMeetingDecided' },
            { label: 'Next Meeting Date', value: 'nextMeetingDate' },
            { label: 'Next Meeting Time', value: 'nextMeetingTime' },
            { label: 'Next Meeting Notes', value: 'nextMeetingNotes' },

            // Status
            { label: 'Sales Status', value: 'salesStatus' },
            { label: 'Session Status', value: 'sessionStatus' },
            { label: 'Form Completed', value: 'formCompleted' },

            // Time Tracking
            { label: 'Session Created', value: 'sessionCreated' },
            { label: 'Punch In Time', value: 'punchInTime' },
            { label: 'Punch In Location', value: 'punchInLocation' },
            { label: 'Punch Out Time', value: 'punchOutTime' },
            { label: 'Punch Out Location', value: 'punchOutLocation' },
            { label: 'Punch Out Address', value: 'punchOutAddress' },
            { label: 'Duration (minutes)', value: 'duration' },
            { label: 'Total Distance (km)', value: 'totalDistance' }
        ];

        const json2csvParser = new Parser({
            fields,
            delimiter: ',',
            quote: '"',
            header: true
        });

        const csv = json2csvParser.parse(reportData);

        // Generate filename
        const companyName = req.user?.companyName || 'Company';
        const dateRange = startDate && endDate
            ? `${startDate}_to_${endDate}`
            : new Date().toISOString().split('T')[0];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `Sales_Report_${companyName}_${dateRange}_${timestamp}.csv`;

        // Send CSV file
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Add BOM for Excel UTF-8 compatibility
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
