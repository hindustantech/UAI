// controllers/todayAttendanceController.js

import mongoose from "mongoose";
import Attendance from '../../models/Attandance/Attendance.js';
import Employee from '../../models/Attandance/Employee.js';
import User from '../../models/userModel.js';


class TodayAttendanceController {

    /**
     * Get today's attendance dashboard with pie chart and employee lists
     * GET /api/attendance/today/dashboard
     * Query params: 
     *   - companyId (required)
     *   - date (optional, format: YYYY-MM-DD, defaults to today)
     *   - department (optional)
     *   - employeeType (optional: non_sales, sales, pro_sales)
     */
    async getTodayDashboard(req, res) {
        try {
            const {
                companyId,
                date,
                department,
                employeeType
            } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Set date (default to today)
            let targetDate;
            if (date) {
                targetDate = new Date(date);
                targetDate.setHours(0, 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }

            const nextDate = new Date(targetDate);
            nextDate.setDate(nextDate.getDate() + 1);

            // Build employee filter
            const employeeFilter = {
                companyId: new mongoose.Types.ObjectId(companyId),
                employmentStatus: "active"
            };

            if (department) {
                employeeFilter["jobInfo.department"] = department;
            }

            if (employeeType) {
                employeeFilter.employeeType = employeeType;
            }

            // Get all active employees
            const employees = await Employee.find(employeeFilter)
                .populate("userId", "name email profileImage")
                .lean();

            if (employees.length === 0) {
                return res.status(200).json({
                    success: true,
                    data: {
                        date: targetDate,
                        summary: {
                            totalEmployees: 0,
                            present: 0,
                            absent: 0,
                            late: 0,
                            onTime: 0,
                            halfDay: 0,
                            presentRate: 0,
                            absentRate: 0,
                            lateRate: 0
                        },
                        pieChartData: [],
                        presentEmployees: [],
                        absentEmployees: [],
                        lateEmployees: [],
                        onTimeEmployees: []
                    }
                });
            }

            // Get attendance for target date
            const attendanceRecords = await Attendance.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                employeeId: { $in: employees.map(e => e._id) },
                date: { $gte: targetDate, $lt: nextDate }
            }).lean();

            // Create attendance map
            const attendanceMap = new Map();
            attendanceRecords.forEach(record => {
                attendanceMap.set(record.employeeId.toString(), record);
            });

            // Categorize employees
            const presentEmployees = [];
            const absentEmployees = [];
            const lateEmployees = [];
            const onTimeEmployees = [];
            const halfDayEmployees = [];

            for (const employee of employees) {
                const attendance = attendanceMap.get(employee._id.toString());
                const employeeData = {
                    employeeId: employee._id,
                    employeeName: employee.user_name || employee.userId?.name || "N/A",
                    empCode: employee.empCode || "N/A",
                    department: employee.jobInfo?.department || "N/A",
                    designation: employee.jobInfo?.designation || "N/A",
                    profileImage: employee.userId?.profileImage || null,
                    punchIn: null,
                    punchOut: null,
                    lateByMinutes: 0,
                    workingHours: 0,
                    status: "absent"
                };

                if (attendance) {
                    employeeData.status = attendance.status;
                    employeeData.punchIn = attendance.punchIn;
                    employeeData.punchOut = attendance.punchOut;
                    employeeData.lateByMinutes = attendance.lateByMinutes || 0;
                    employeeData.workingHours = attendance.totalWorkingHours || 0;

                    if (attendance.status === "present") {
                        presentEmployees.push(employeeData);

                        if (attendance.lateByMinutes > 0) {
                            lateEmployees.push(employeeData);
                        } else {
                            onTimeEmployees.push(employeeData);
                        }
                    } else if (attendance.status === "half_day") {
                        halfDayEmployees.push(employeeData);
                        presentEmployees.push(employeeData); // half day counts as present for rate calculation
                    } else if (attendance.status === "absent") {
                        absentEmployees.push(employeeData);
                    } else {
                        // For leave, holiday, week_off - treat as not present but not absent
                        absentEmployees.push(employeeData);
                    }
                } else {
                    absentEmployees.push(employeeData);
                }
            }

            // Calculate statistics
            const totalEmployees = employees.length;
            const presentCount = presentEmployees.length;
            const absentCount = absentEmployees.length;
            const lateCount = lateEmployees.length;
            const onTimeCount = onTimeEmployees.length;
            const halfDayCount = halfDayEmployees.length;

            const presentRate = totalEmployees > 0 ? ((presentCount / totalEmployees) * 100).toFixed(2) : 0;
            const absentRate = totalEmployees > 0 ? ((absentCount / totalEmployees) * 100).toFixed(2) : 0;
            const lateRate = totalEmployees > 0 ? ((lateCount / totalEmployees) * 100).toFixed(2) : 0;
            const onTimeRate = totalEmployees > 0 ? ((onTimeCount / totalEmployees) * 100).toFixed(2) : 0;

            // Prepare pie chart data
            const pieChartData = [
                { name: "Present", value: presentCount, color: "#4CAF50", rate: presentRate },
                { name: "Absent", value: absentCount, color: "#F44336", rate: absentRate },
                { name: "Late", value: lateCount, color: "#FFC107", rate: lateRate },
                { name: "On Time", value: onTimeCount, color: "#2196F3", rate: onTimeRate }
            ].filter(item => item.value > 0);

            // Sort employees by late minutes (highest first)
            lateEmployees.sort((a, b) => b.lateByMinutes - a.lateByMinutes);

            // Sort present employees by punch in time
            presentEmployees.sort((a, b) => {
                if (!a.punchIn) return 1;
                if (!b.punchIn) return -1;
                return new Date(a.punchIn) - new Date(b.punchIn);
            });

            // Sort absent employees by name
            absentEmployees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

            return res.status(200).json({
                success: true,
                data: {
                    date: targetDate,
                    dateFormatted: targetDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }),
                    summary: {
                        totalEmployees,
                        presentCount,
                        absentCount,
                        lateCount,
                        onTimeCount,
                        halfDayCount,
                        presentRate: parseFloat(presentRate),
                        absentRate: parseFloat(absentRate),
                        lateRate: parseFloat(lateRate),
                        onTimeRate: parseFloat(onTimeRate)
                    },
                    pieChartData,
                    lists: {
                        present: presentEmployees,
                        absent: absentEmployees,
                        late: lateEmployees,
                        onTime: onTimeEmployees,
                        halfDay: halfDayEmployees
                    }
                }
            });

        } catch (error) {
            console.error("Error in today's attendance dashboard:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get single employee today's attendance
     * GET /api/attendance/today/employee/:employeeId
     */
    async getEmployeeTodayAttendance(req, res) {
        try {
            const { employeeId } = req.params;
            const { companyId, date } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Set date
            let targetDate;
            if (date) {
                targetDate = new Date(date);
                targetDate.setHours(0, 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }

            const nextDate = new Date(targetDate);
            nextDate.setDate(nextDate.getDate() + 1);

            // Get employee details
            const employee = await Employee.findOne({
                _id: new mongoose.Types.ObjectId(employeeId),
                companyId: new mongoose.Types.ObjectId(companyId)
            }).populate("userId", "name email profileImage");

            if (!employee) {
                return res.status(404).json({
                    success: false,
                    error: "Employee not found"
                });
            }

            // Get attendance
            const attendance = await Attendance.findOne({
                companyId: mongoose.Types.ObjectId(companyId),
                employeeId: mongoose.Types.ObjectId(employeeId),
                date: { $gte: targetDate, $lt: nextDate }
            });

            const response = {
                success: true,
                data: {
                    employee: {
                        employeeId: employee._id,
                        employeeName: employee.user_name || employee.userId?.name,
                        empCode: employee.empCode,
                        department: employee.jobInfo?.department,
                        designation: employee.jobInfo?.designation,
                        profileImage: employee.userId?.profileImage,
                        shift: employee.shift
                    },
                    date: targetDate,
                    dateFormatted: targetDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }),
                    attendance: attendance ? {
                        status: attendance.status,
                        punchIn: attendance.punchIn,
                        punchOut: attendance.punchOut,
                        lateByMinutes: attendance.lateByMinutes,
                        totalWorkingHours: attendance.totalWorkingHours,
                        breaks: attendance.breaks,
                        workSummary: attendance.workSummary,
                        geoLocation: attendance.geoLocation,
                        remarks: attendance.remarks
                    } : {
                        status: "absent",
                        punchIn: null,
                        punchOut: null,
                        lateByMinutes: 0,
                        totalWorkingHours: 0,
                        breaks: [],
                        workSummary: null,
                        geoLocation: null,
                        remarks: null
                    }
                }
            };

            res.status(200).json(response);

        } catch (error) {
            console.error("Error fetching employee today's attendance:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get attendance for specific date range with filters
     * GET /api/attendance/date-range/dashboard
     */
    async getDateRangeDashboard(req, res) {
        try {
            const {
                companyId,
                fromDate,
                toDate,
                department,
                employeeType
            } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            if (!fromDate || !toDate) {
                return res.status(400).json({
                    success: false,
                    error: "fromDate and toDate are required"
                });
            }

            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);
            endDate.setHours(23, 59, 59, 999);

            // Build employee filter
            const employeeFilter = {
                companyId: mongoose.Types.ObjectId(companyId),
                employmentStatus: "active"
            };

            if (department) {
                employeeFilter["jobInfo.department"] = department;
            }

            if (employeeType) {
                employeeFilter.employeeType = employeeType;
            }

            // Get all active employees
            const employees = await Employee.find(employeeFilter)
                .populate("userId", "name email")
                .lean();

            // Get attendance records for date range
            const attendanceRecords = await Attendance.aggregate([
                {
                    $match: {
                        companyId: new mongoose.Types.ObjectId(companyId),
                        employeeId: { $in: employees.map(e => e._id) },
                        date: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: "$employeeId",
                        presentCount: {
                            $sum: {
                                $cond: [
                                    { $in: ["$status", ["present", "half_day"]] },
                                    1,
                                    0
                                ]
                            }
                        },
                        lateCount: {
                            $sum: {
                                $cond: [{ $gt: ["$lateByMinutes", 0] }, 1, 0]
                            }
                        },
                        totalWorkingMinutes: { $sum: "$workSummary.totalMinutes" },
                        totalLateMinutes: { $sum: "$lateByMinutes" },
                        attendanceRecords: { $push: "$$ROOT" }
                    }
                }
            ]);

            const attendanceMap = new Map();
            attendanceRecords.forEach(record => {
                attendanceMap.set(record._id.toString(), record);
            });

            // Calculate date range stats
            const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

            const employeeStats = [];
            let totalPresent = 0;
            let totalLate = 0;
            let totalPossibleAttendance = 0;

            for (const employee of employees) {
                const stats = attendanceMap.get(employee._id.toString()) || {
                    presentCount: 0,
                    lateCount: 0,
                    totalWorkingMinutes: 0,
                    totalLateMinutes: 0
                };

                const possibleDays = totalDays;
                const attendanceRate = possibleDays > 0
                    ? ((stats.presentCount / possibleDays) * 100).toFixed(2)
                    : 0;

                totalPresent += stats.presentCount;
                totalLate += stats.lateCount;
                totalPossibleAttendance += possibleDays;

                employeeStats.push({
                    employeeId: employee._id,
                    employeeName: employee.user_name || employee.userId?.name,
                    empCode: employee.empCode,
                    department: employee.jobInfo?.department,
                    presentDays: stats.presentCount,
                    lateDays: stats.lateCount,
                    absentDays: possibleDays - stats.presentCount,
                    attendanceRate: parseFloat(attendanceRate),
                    totalWorkingHours: (stats.totalWorkingMinutes / 60).toFixed(2),
                    totalLateHours: (stats.totalLateMinutes / 60).toFixed(2)
                });
            }

            const overallAttendanceRate = totalPossibleAttendance > 0
                ? ((totalPresent / totalPossibleAttendance) * 100).toFixed(2)
                : 0;

            // Prepare pie chart data
            const pieChartData = [
                {
                    name: "Present Days",
                    value: totalPresent,
                    color: "#4CAF50",
                    rate: ((totalPresent / totalPossibleAttendance) * 100).toFixed(2)
                },
                {
                    name: "Absent Days",
                    value: totalPossibleAttendance - totalPresent,
                    color: "#F44336",
                    rate: (((totalPossibleAttendance - totalPresent) / totalPossibleAttendance) * 100).toFixed(2)
                },
                {
                    name: "Late Days",
                    value: totalLate,
                    color: "#FFC107",
                    rate: ((totalLate / totalPossibleAttendance) * 100).toFixed(2)
                }
            ];

            res.status(200).json({
                success: true,
                data: {
                    dateRange: {
                        from: startDate,
                        to: endDate,
                        totalDays
                    },
                    summary: {
                        totalEmployees: employees.length,
                        totalPresentDays: totalPresent,
                        totalAbsentDays: totalPossibleAttendance - totalPresent,
                        totalLateDays: totalLate,
                        overallAttendanceRate: parseFloat(overallAttendanceRate),
                        totalPossibleAttendance
                    },
                    pieChartData,
                    employeeStats: employeeStats.sort((a, b) => b.attendanceRate - a.attendanceRate)
                }
            });

        } catch (error) {
            console.error("Error fetching date range dashboard:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get attendance summary by department
     * GET /api/attendance/today/by-department
     */
    async getAttendanceByDepartment(req, res) {
        try {
            const { companyId, date } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Set date
            let targetDate;
            if (date) {
                targetDate = new Date(date);
                targetDate.setHours(0, 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }

            const nextDate = new Date(targetDate);
            nextDate.setDate(nextDate.getDate() + 1);

            // Get all employees grouped by department
            const employeesByDepartment = await Employee.aggregate([
                {
                    $match: {
                        companyId: mongoose.Types.ObjectId(companyId),
                        employmentStatus: "active"
                    }
                },
                {
                    $group: {
                        _id: "$jobInfo.department",
                        employees: { $push: "$$ROOT" },
                        totalEmployees: { $sum: 1 }
                    }
                }
            ]);

            // Get attendance for target date
            const allEmployeeIds = employeesByDepartment.flatMap(dept =>
                dept.employees.map(emp => emp._id)
            );

            const attendanceRecords = await Attendance.find({
                companyId: mongoose.Types.ObjectId(companyId),
                employeeId: { $in: allEmployeeIds },
                date: { $gte: targetDate, $lt: nextDate }
            }).lean();

            const attendanceMap = new Map();
            attendanceRecords.forEach(record => {
                attendanceMap.set(record.employeeId.toString(), record);
            });

            // Calculate department-wise stats
            const departmentStats = [];

            for (const dept of employeesByDepartment) {
                const departmentName = dept._id || "Unassigned";
                let present = 0;
                let late = 0;
                let onTime = 0;

                for (const employee of dept.employees) {
                    const attendance = attendanceMap.get(employee._id.toString());
                    if (attendance && (attendance.status === "present" || attendance.status === "half_day")) {
                        present++;
                        if (attendance.lateByMinutes > 0) {
                            late++;
                        } else {
                            onTime++;
                        }
                    }
                }

                const attendanceRate = dept.totalEmployees > 0
                    ? ((present / dept.totalEmployees) * 100).toFixed(2)
                    : 0;

                departmentStats.push({
                    department: departmentName,
                    totalEmployees: dept.totalEmployees,
                    present,
                    absent: dept.totalEmployees - present,
                    late,
                    onTime,
                    attendanceRate: parseFloat(attendanceRate)
                });
            }

            // Sort by attendance rate descending
            departmentStats.sort((a, b) => b.attendanceRate - a.attendanceRate);

            res.status(200).json({
                success: true,
                data: {
                    date: targetDate,
                    dateFormatted: targetDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }),
                    departments: departmentStats,
                    totalDepartments: departmentStats.length
                }
            });

        } catch (error) {
            console.error("Error fetching attendance by department:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

export default new TodayAttendanceController();