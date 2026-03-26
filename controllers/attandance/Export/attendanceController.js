import Attendance from "../../../models/Attandance/Attendance.js";
import Employee from "../../../models/Attandance/Employee.js";
import mongoose from "mongoose";
import { Parser } from "json2csv";

/**
 * Generate attendance report in CSV format matching the exact matrix format
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const generateAttendanceCSV = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            department,
            employeeCode
        } = req.query;

        const companyId = req.user._id
        // Validate required fields
        if (!companyId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "companyId, startDate, and endDate are required"
            });
        }

        // Parse dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Build employee filter
        const employeeFilter = { companyId, employmentStatus: "active" };
        if (department) employeeFilter["jobInfo.department"] = department;
        if (employeeCode) employeeFilter.empCode = employeeCode;

        // Fetch employees with their shift and weekly off details
        const employees = await Employee.find(employeeFilter)
            .populate("shift")
            .lean();

        if (!employees.length) {
            return res.status(404).json({
                success: false,
                message: "No employees found"
            });
        }

        // Fetch attendance records for the date range
        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map(emp => emp._id) },
            date: { $gte: start, $lte: end }
        }).lean();

        // Create a map for quick attendance lookup
        const attendanceMap = new Map();
        attendanceRecords.forEach(record => {
            const key = `${record.employeeId}_${record.date.toISOString().split('T')[0]}`;
            attendanceMap.set(key, record);
        });

        // Get all dates in range
        const dateRange = [];
        let currentDate = new Date(start);
        while (currentDate <= end) {
            dateRange.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Format dates for CSV headers
        const formattedDates = dateRange.map(date =>
            date.toISOString().split('T')[0]
        );

        // Prepare CSV data
        const csvData = [];

        for (const employee of employees) {
            // Get employee's weekly off days
            const weeklyOffDays = employee.weeklyOff || ["Sunday"];

            // Get employee's shift timings
            const shiftStart = employee.shift?.startTime || "09:00";
            const shiftEnd = employee.shift?.endTime || "18:00";

            // Create row for each employee
            const row = {
                "Emp Code": employee.empCode,
                "Emp Name": employee.user_name || employee.userId?.name || "N/A",
                "Department": employee.jobInfo?.department || "N/A"
            };

            // Add attendance for each date
            for (let i = 0; i < dateRange.length; i++) {
                const date = dateRange[i];
                const dateKey = date.toISOString().split('T')[0];
                const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });

                const attendanceKey = `${employee._id}_${dateKey}`;
                const attendance = attendanceMap.get(attendanceKey);

                // Determine if it's weekly off
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                let punchInTime = "";
                let punchOutTime = "";
                let workingHours = "";
                let status = "";

                if (isWeeklyOff) {
                    // Weekly Off
                    punchInTime = "Weekly Off";
                    punchOutTime = "Weekly Off";
                    workingHours = "0:00";
                    status = "Week Off";
                }
                else if (attendance) {
                    // Attendance record exists
                    switch (attendance.status) {
                        case "leave":
                            punchInTime = attendance.remarks || "Leave";
                            punchOutTime = attendance.remarks || "Leave";
                            workingHours = "0:00";
                            status = "Leave";
                            break;

                        case "half_day":
                            punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "N/A";
                            punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "N/A";
                            workingHours = formatWorkingHours(attendance.workSummary?.totalMinutes || 0);
                            status = "Half Day";
                            break;

                        case "holiday":
                            punchInTime = "Holiday";
                            punchOutTime = "Holiday";
                            workingHours = "0:00";
                            status = "Holiday";
                            break;

                        default: // present
                            punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "N/A";
                            punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "N/A";
                            workingHours = formatWorkingHours(attendance.workSummary?.totalMinutes || 0);
                            status = attendance.status === "present" ? "Present" : "Present";
                            break;
                    }
                }
                else {
                    // No attendance record - Absent
                    punchInTime = "Absent";
                    punchOutTime = "Absent";
                    workingHours = "0:00";
                    status = "Absent";
                }

                // Add to row
                row[dateKey] = {
                    "Punch In Time": punchInTime,
                    "Punch Out Time": punchOutTime,
                    "Working Hours": workingHours,
                    "Status": status
                };
            }

            csvData.push(row);
        }

        // Transform data for CSV flattening
        const flattenedData = [];

        for (const employee of csvData) {
            const baseRow = {
                "Emp Code": employee["Emp Code"],
                "Emp Name": employee["Emp Name"],
                "Department": employee["Department"]
            };

            // Add each date's data as separate columns
            for (const date of formattedDates) {
                const dateData = employee[date];
                if (dateData) {
                    flattenedData.push({
                        ...baseRow,
                        "Date": date,
                        "Punch In Time": dateData["Punch In Time"],
                        "Punch Out Time": dateData["Punch Out Time"],
                        "Working Hours": dateData["Working Hours"],
                        "Status": dateData["Status"]
                    });
                }
            }
        }

        // Define CSV fields in exact order
        const fields = [
            "Emp Code",
            "Emp Name",
            "Department",
            "Date",
            "Punch In Time",
            "Punch Out Time",
            "Working Hours",
            "Status"
        ];

        // Create CSV parser
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(flattenedData);

        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${startDate}_to_${endDate}.csv`);

        // Send CSV
        return res.status(200).send(csv);

    } catch (error) {
        console.error("Error generating attendance CSV:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate attendance report",
            error: error.message
        });
    }
};

/**
 * Alternative method to generate CSV in the exact matrix format with dates as headers
 */
export const generateAttendanceMatrixCSV = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            department,
            employeeCode
        } = req.query;
        const companyId = req.user._id
        // Validate required fields
        if (!companyId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "companyId, startDate, and endDate are required"
            });
        }

        // Parse dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Build employee filter
        const employeeFilter = { companyId, employmentStatus: "active" };
        if (department) employeeFilter["jobInfo.department"] = department;
        if (employeeCode) employeeFilter.empCode = employeeCode;

        // Fetch employees
        const employees = await Employee.find(employeeFilter)
            .populate("shift")
            .lean();

        if (!employees.length) {
            return res.status(404).json({
                success: false,
                message: "No employees found"
            });
        }

        // Fetch attendance records
        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map(emp => emp._id) },
            date: { $gte: start, $lte: end }
        }).lean();

        // Create attendance map
        const attendanceMap = new Map();
        attendanceRecords.forEach(record => {
            const key = `${record.employeeId}_${record.date.toISOString().split('T')[0]}`;
            attendanceMap.set(key, record);
        });

        // Get all dates in range
        const dateRange = [];
        let currentDate = new Date(start);
        while (currentDate <= end) {
            dateRange.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Prepare matrix data
        const matrixData = [];

        for (const employee of employees) {
            const weeklyOffDays = employee.weeklyOff || ["Sunday"];
            const row = {
                "Emp Code": employee.empCode,
                "Emp Name": employee.user_name || employee.userId?.name || "N/A",
                "Department": employee.jobInfo?.department || "N/A"
            };

            // Add data for each date
            for (const date of dateRange) {
                const dateKey = date.toISOString().split('T')[0];
                const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
                const attendanceKey = `${employee._id}_${dateKey}`;
                const attendance = attendanceMap.get(attendanceKey);
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                let punchInTime = "";
                let punchOutTime = "";
                let workingHours = "";
                let status = "";

                if (isWeeklyOff) {
                    punchInTime = "Weekly Off";
                    punchOutTime = "Weekly Off";
                    workingHours = "0:00";
                    status = "Week Off";
                }
                else if (attendance) {
                    switch (attendance.status) {
                        case "leave":
                            punchInTime = attendance.remarks || "Leave";
                            punchOutTime = attendance.remarks || "Leave";
                            workingHours = "0:00";
                            status = "Leave";
                            break;
                        case "half_day":
                            punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "N/A";
                            punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "N/A";
                            workingHours = formatWorkingHours(attendance.workSummary?.totalMinutes || 0);
                            status = "Half Day";
                            break;
                        default:
                            punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "N/A";
                            punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "N/A";
                            workingHours = formatWorkingHours(attendance.workSummary?.totalMinutes || 0);
                            status = attendance.status === "present" ? "Present" : "Present";
                    }
                }
                else {
                    punchInTime = "Absent";
                    punchOutTime = "Absent";
                    workingHours = "0:00";
                    status = "Absent";
                }

                // Add combined data for the date
                row[dateKey] = `${punchInTime}|${punchOutTime}|${workingHours}|${status}`;
            }

            matrixData.push(row);
        }

        // Build CSV headers
        const headers = ["Emp Code", "Emp Name", "Department"];
        dateRange.forEach(date => {
            headers.push(date.toISOString().split('T')[0]);
        });

        // Build CSV rows
        const csvRows = [];
        csvRows.push(headers.join(','));

        for (const row of matrixData) {
            const csvRow = [];
            csvRow.push(`"${row["Emp Code"]}"`);
            csvRow.push(`"${row["Emp Name"]}"`);
            csvRow.push(`"${row["Department"]}"`);

            dateRange.forEach(date => {
                const dateKey = date.toISOString().split('T')[0];
                const value = row[dateKey] || "N/A|N/A|0:00|Absent";
                const [punchIn, punchOut, hours, status] = value.split('|');
                // Format as per your requirement - you can customize this
                csvRow.push(`"${punchIn}"`);
            });

            csvRows.push(csvRow.join(','));
        }

        const csv = csvRows.join('\n');

        // Send response
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_matrix_${startDate}_to_${endDate}.csv`);
        return res.status(200).send(csv);

    } catch (error) {
        console.error("Error generating attendance matrix CSV:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate attendance matrix report",
            error: error.message
        });
    }
};

// Helper function to format time from Date object
function formatTime(date) {
    if (!date) return "N/A";
    const d = new Date(date);
    return d.toTimeString().split(' ')[0];
}

// Helper function to format working hours
function formatWorkingHours(minutes) {
    if (!minutes || minutes === 0) return "0:00";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
}