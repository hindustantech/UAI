// services/attendanceReportService.js

import mongoose from "mongoose";
import Attendance from "../models/Attandance/Attendance.js";
import Employee from '../models/Attandance/Employee.js';
import User from '../models/userModel.js';
class AttendanceReportService {

    /**
     * Get monthly attendance report with filters
     * @param {Object} params - Report parameters
     * @param {string} params.companyId - Company ID
     * @param {string} params.year - Year (YYYY)
     * @param {string} params.month - Month (1-12)
     * @param {string} params.fromDate - Optional custom from date
     * @param {string} params.toDate - Optional custom to date
     * @param {string} params.employeeId - Optional employee filter
     * @param {string} params.department - Optional department filter
     */
    async getMonthlyReport(params) {
        const {
            companyId,
            year,
            month,
            fromDate,
            toDate,
            employeeId,
            department
        } = params;

        let startDate, endDate;

        // Determine date range
        if (fromDate && toDate) {
            startDate = new Date(fromDate);
            endDate = new Date(toDate);
            endDate.setHours(23, 59, 59, 999);
        } else if (year && month) {
            startDate = new Date(year, month - 1, 1);
            endDate = new Date(year, month, 0);
            endDate.setHours(23, 59, 59, 999);
        } else {
            // Default to current month
            const now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            endDate.setHours(23, 59, 59, 999);
        }

        // Build employee filter
        const employeeFilter = { companyId: new mongoose.Types.ObjectId(companyId) };
        if (employeeId) {
            employeeFilter._id = new mongoose.Types.ObjectId(employeeId);
        }
        if (department) {
            employeeFilter['jobInfo.department'] = department;
        }

        // Get all employees
        const employees = await Employee.find(employeeFilter)
            .populate('userId', 'name email')
            .lean();

        if (employees.length === 0) {
            return this.getEmptyReport(startDate, endDate);
        }

        // Get attendance data for date range
        const attendanceData = await Attendance.aggregate([
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    date: { $gte: startDate, $lte: endDate },
                    ...(employeeId && { employeeId: new mongoose.Types.ObjectId(employeeId) })
                }
            },
            {
                $group: {
                    _id: {
                        employeeId: "$employeeId",
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }
                    },
                    status: { $first: "$status" },
                    lateByMinutes: { $first: "$lateByMinutes" },
                    workSummary: { $first: "$workSummary" },
                    punchIn: { $first: "$punchIn" },
                    punchOut: { $first: "$punchOut" },
                    totalWorkingHours: { $first: "$totalWorkingHours" }
                }
            }
        ]);

        // Create a map for quick lookup
        const attendanceMap = new Map();
        attendanceData.forEach(record => {
            const key = `${record._id.employeeId}_${record._id.date}`;
            attendanceMap.set(key, record);
        });

        // Calculate daily stats for each employee
        const employeeReports = [];
        const dateRange = this.getDateRangeArray(startDate, endDate);

        for (const employee of employees) {
            const dailyRecords = [];
            let present = 0;
            let absent = 0;
            let late = 0;
            let halfDay = 0;
            let holiday = 0;
            let weekOff = 0;
            let leave = 0;
            let totalWorkingMinutes = 0;
            let totalLateMinutes = 0;
            let totalOvertimeMinutes = 0;

            for (const date of dateRange) {
                const dateStr = this.formatDate(date);
                const key = `${employee._id}_${dateStr}`;
                const attendance = attendanceMap.get(key);

                const dayOfWeek = date.getDay();
                const isWeekend = employee.weeklyOff?.includes(this.getDayName(dayOfWeek));

                let record = {
                    date: dateStr,
                    day: this.getDayName(dayOfWeek),
                    status: 'absent',
                    punchIn: null,
                    punchOut: null,
                    lateByMinutes: 0,
                    workingHours: 0,
                    overtime: 0,
                    isWeekend: isWeekend
                };

                if (attendance) {
                    record.status = attendance.status;
                    record.punchIn = attendance.punchIn;
                    record.punchOut = attendance.punchOut;
                    record.lateByMinutes = attendance.lateByMinutes || 0;
                    record.workingHours = attendance.totalWorkingHours || 0;
                    record.overtime = attendance.workSummary?.overtimeMinutes || 0;

                    // Count statistics
                    switch (attendance.status) {
                        case 'present':
                            present++;
                            if ((attendance.lateByMinutes || 0) > 0) late++;
                            totalWorkingMinutes += (attendance.totalWorkingHours || 0) * 60;
                            totalLateMinutes += attendance.lateByMinutes || 0;
                            totalOvertimeMinutes += attendance.workSummary?.overtimeMinutes || 0;
                            break;
                        case 'absent':
                            absent++;
                            break;
                        case 'half_day':
                            halfDay++;
                            totalWorkingMinutes += (attendance.totalWorkingHours || 0) * 60;
                            break;
                        case 'holiday':
                            holiday++;
                            break;
                        case 'week_off':
                            weekOff++;
                            break;
                        case 'leave':
                            leave++;
                            break;
                    }
                } else {
                    if (isWeekend) {
                        record.status = 'week_off';
                        weekOff++;
                    } else {
                        absent++;
                    }
                }

                dailyRecords.push(record);
            }

            const totalDays = dateRange.length;
            const attendancePercentage = totalDays > 0 ? ((present + halfDay) / totalDays) * 100 : 0;

            employeeReports.push({
                employeeId: employee._id,
                employeeName: employee.user_name || employee.userId?.name || 'N/A',
                empCode: employee.empCode,
                department: employee.jobInfo?.department,
                designation: employee.jobInfo?.designation,
                summary: {
                    totalDays,
                    present,
                    absent,
                    late,
                    halfDay,
                    holiday,
                    weekOff,
                    leave,
                    attendancePercentage: attendancePercentage.toFixed(2),
                    totalWorkingHours: (totalWorkingMinutes / 60).toFixed(2),
                    totalLateHours: (totalLateMinutes / 60).toFixed(2),
                    totalOvertimeHours: (totalOvertimeMinutes / 60).toFixed(2)
                },
                dailyRecords
            });
        }

        // Calculate overall statistics for charts
        const overallStats = this.calculateOverallStats(employeeReports, dateRange.length);

        return {
            dateRange: {
                from: startDate,
                to: endDate,
                totalDays: dateRange.length
            },
            filters: {
                employeeId: employeeId || null,
                department: department || null
            },
            overallStats,
            employeeReports,
            chartData: this.generateChartData(employeeReports, dateRange)
        };
    }

    /**
     * Get monthly trend data for last 12 months
     */
    async getMonthlyTrend(companyId, employeeId = null) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 11);
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);

        const employeeFilter = { companyId: new mongoose.Types.ObjectId(companyId) };
        if (employeeId) {
            employeeFilter._id = new mongoose.Types.ObjectId(employeeId);
        }

        const employees = await Employee.find(employeeFilter).select('_id');
        const employeeIds = employees.map(emp => emp._id);

        const monthlyData = await Attendance.aggregate([
            {
                $match: {
                    companyId:new mongoose.Types.ObjectId(companyId),
                    date: { $gte: startDate, $lte: endDate },
                    ...(employeeId && { employeeId: new mongoose.Types.ObjectId(employeeId) })
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: "$date" },
                        month: { $month: "$date" },
                        status: "$status"
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: {
                        year: "$_id.year",
                        month: "$_id.month"
                    },
                    stats: {
                        $push: {
                            status: "$_id.status",
                            count: "$count"
                        }
                    },
                    totalPresent: {
                        $sum: {
                            $cond: [
                                { $in: ["$_id.status", ["present", "half_day"]] },
                                "$count",
                                0
                            ]
                        }
                    }
                }
            },
            {
                $sort: { "_id.year": 1, "_id.month": 1 }
            }
        ]);

        // Get total employees per month
        const monthlyEmployeeCount = await this.getMonthlyEmployeeCount(companyId, startDate, endDate);

        // Format data for last 12 months
        const trends = [];
        for (let i = 0; i < 12; i++) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;

            const monthKey = `${year}-${String(month).padStart(2, '0')}`;
            const monthData = monthlyData.find(m => m._id.year === year && m._id.month === month);

            const presentCount = monthData?.totalPresent || 0;
            const totalEmployees = monthlyEmployeeCount[monthKey] || 0;

            trends.unshift({
                month: monthKey,
                monthName: date.toLocaleString('default', { month: 'short' }),
                year,
                presentCount,
                absentCount: (totalEmployees * this.getDaysInMonth(year, month)) - presentCount,
                totalEmployees,
                attendanceRate: totalEmployees > 0 ? ((presentCount / (totalEmployees * this.getDaysInMonth(year, month))) * 100).toFixed(2) : 0
            });
        }

        return trends;
    }

    /**
     * Get dashboard summary for bar chart (present, absent, late, half-day)
     */
    async getDashboardChartData(companyId, year, month, department = null) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        endDate.setHours(23, 59, 59, 999);

        const employeeFilter = { companyId: new mongoose.Types.ObjectId(companyId) };
        if (department) {
            employeeFilter['jobInfo.department'] = department;
        }

        const employees = await Employee.find(employeeFilter).select('_id');
        const totalEmployees = employees.length;

        const attendanceStats = await Attendance.aggregate([
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    date: { $gte: startDate, $lte: endDate },
                    ...(department && {
                        employeeId: { $in: employees.map(e => e._id) }
                    })
                }
            },
            {
                $group: {
                    _id: {
                        status: "$status",
                        employeeId: "$employeeId"
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: "$_id.status",
                    total: { $sum: "$count" },
                    uniqueEmployees: { $addToSet: "$_id.employeeId" }
                }
            }
        ]);

        const lateCount = await Attendance.countDocuments({
            companyId: new mongoose.Types.ObjectId(companyId),
            date: { $gte: startDate, $lte: endDate },
            lateByMinutes: { $gt: 0 },
            ...(department && {
                employeeId: { $in: employees.map(e => e._id) }
            })
        });

        const chartData = {
            labels: ['Present', 'Absent', 'Late', 'Half Day', 'Holiday', 'Week Off', 'Leave'],
            datasets: [
                {
                    label: `${monthName} ${year} Attendance`,
                    data: [
                        this.getStatCount(attendanceStats, 'present'),
                        this.getStatCount(attendanceStats, 'absent'),
                        lateCount,
                        this.getStatCount(attendanceStats, 'half_day'),
                        this.getStatCount(attendanceStats, 'holiday'),
                        this.getStatCount(attendanceStats, 'week_off'),
                        this.getStatCount(attendanceStats, 'leave')
                    ],
                    backgroundColor: [
                        '#4CAF50', // Present - Green
                        '#F44336', // Absent - Red
                        '#FFC107', // Late - Yellow
                        '#FF9800', // Half Day - Orange
                        '#2196F3', // Holiday - Blue
                        '#9E9E9E', // Week Off - Grey
                        '#9C27B0'  // Leave - Purple
                    ]
                }
            ],
            totalEmployees,
            totalDays: this.getDaysInMonth(year, month)
        };

        return chartData;
    }

    /**
     * Get detailed daily breakdown for heatmap
     */
    async getDailyBreakdown(companyId, year, month, employeeId = null) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        endDate.setHours(23, 59, 59, 999);

        const matchStage = {
            companyId:new mongoose.Types.ObjectId(companyId),
            date: { $gte: startDate, $lte: endDate }
        };

        if (employeeId) {
            matchStage.employeeId = new mongoose.Types.ObjectId(employeeId);
        }

        const dailyBreakdown = await Attendance.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                        status: "$status"
                    },
                    count: { $sum: 1 },
                    lateCount: {
                        $sum: { $cond: [{ $gt: ["$lateByMinutes", 0] }, 1, 0] }
                    }
                }
            },
            {
                $group: {
                    _id: "$_id.date",
                    stats: {
                        $push: {
                            status: "$_id.status",
                            count: "$count",
                            lateCount: "$lateCount"
                        }
                    },
                    totalPresent: {
                        $sum: {
                            $cond: [
                                { $in: ["$_id.status", ["present", "half_day"]] },
                                "$count",
                                0
                            ]
                        }
                    },
                    totalLate: { $sum: "$lateCount" }
                }
            },
            { $sort: { "_id": 1 } }
        ]);

        return dailyBreakdown;
    }

    // Helper Methods
    getDateRangeArray(startDate, endDate) {
        const dates = [];
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            dates.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return dates;
    }

    formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    getDayName(dayIndex) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[dayIndex];
    }

    getDaysInMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    getStatCount(stats, status) {
        const stat = stats.find(s => s._id === status);
        return stat ? stat.total : 0;
    }

    calculateOverallStats(employeeReports, totalDays) {
        let totalPresent = 0;
        let totalAbsent = 0;
        let totalLate = 0;
        let totalHalfDay = 0;
        let totalHoliday = 0;
        let totalWeekOff = 0;
        let totalLeave = 0;
        let totalWorkingHours = 0;

        employeeReports.forEach(emp => {
            totalPresent += emp.summary.present;
            totalAbsent += emp.summary.absent;
            totalLate += emp.summary.late;
            totalHalfDay += emp.summary.halfDay;
            totalHoliday += emp.summary.holiday;
            totalWeekOff += emp.summary.weekOff;
            totalLeave += emp.summary.leave;
            totalWorkingHours += parseFloat(emp.summary.totalWorkingHours);
        });

        const totalEmployees = employeeReports.length;
        const totalAttendanceDays = totalEmployees * totalDays;
        const overallAttendancePercentage = totalAttendanceDays > 0
            ? ((totalPresent + totalHalfDay) / totalAttendanceDays) * 100
            : 0;

        return {
            totalEmployees,
            totalAttendanceDays,
            totalPresent,
            totalAbsent,
            totalLate,
            totalHalfDay,
            totalHoliday,
            totalWeekOff,
            totalLeave,
            overallAttendancePercentage: overallAttendancePercentage.toFixed(2),
            averageWorkingHours: (totalWorkingHours / totalEmployees).toFixed(2),
            totalWorkingHours: totalWorkingHours.toFixed(2)
        };
    }

    generateChartData(employeeReports, dateRange) {
        const dates = dateRange.map(d => this.formatDate(d));

        return {
            dailyAttendance: dates.map(date => {
                let present = 0, absent = 0, late = 0, halfDay = 0;
                employeeReports.forEach(emp => {
                    const day = emp.dailyRecords.find(d => d.date === date);
                    if (day) {
                        switch (day.status) {
                            case 'present':
                                present++;
                                if (day.lateByMinutes > 0) late++;
                                break;
                            case 'absent':
                                absent++;
                                break;
                            case 'half_day':
                                halfDay++;
                                break;
                        }
                    }
                });
                return { date, present, absent, late, halfDay };
            }),
            summary: {
                totalPresent: employeeReports.reduce((sum, emp) => sum + emp.summary.present, 0),
                totalAbsent: employeeReports.reduce((sum, emp) => sum + emp.summary.absent, 0),
                totalLate: employeeReports.reduce((sum, emp) => sum + emp.summary.late, 0),
                totalHalfDay: employeeReports.reduce((sum, emp) => sum + emp.summary.halfDay, 0)
            }
        };
    }

    async getMonthlyEmployeeCount(companyId, startDate, endDate) {
        const monthlyCounts = {};

        for (let d = new Date(startDate); d <= endDate; d.setMonth(d.getMonth() + 1)) {
            const year = d.getFullYear();
            const month = d.getMonth() + 1;
            const monthKey = `${year}-${String(month).padStart(2, '0')}`;

            const count = await Employee.countDocuments({
                companyId: new mongoose.Types.ObjectId(companyId),
                createdAt: { $lte: new Date(year, month, 0) },
                employmentStatus: 'active'
            });

            monthlyCounts[monthKey] = count;
        }

        return monthlyCounts;
    }

    getEmptyReport(startDate, endDate) {
        return {
            dateRange: { from: startDate, to: endDate, totalDays: 0 },
            filters: {},
            overallStats: {
                totalEmployees: 0,
                totalAttendanceDays: 0,
                totalPresent: 0,
                totalAbsent: 0,
                totalLate: 0,
                totalHalfDay: 0,
                totalHoliday: 0,
                totalWeekOff: 0,
                totalLeave: 0,
                overallAttendancePercentage: 0,
                averageWorkingHours: 0,
                totalWorkingHours: 0
            },
            employeeReports: [],
            chartData: { dailyAttendance: [], summary: {} }
        };
    }
}

export default new AttendanceReportService();