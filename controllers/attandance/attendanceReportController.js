// controllers/attendanceReportController.js

import AttendanceReportService from '../../services/attendanceReportService.js';

class AttendanceReportController {

    /**
     * Get monthly attendance report
     * GET /api/attendance/report/monthly
     * Query params: companyId, year, month, fromDate, toDate, employeeId, department
     */
    async getMonthlyReport(req, res) {
        try {
            const {
                companyId,
                year,
                month,
                fromDate,
                toDate,
                employeeId,
                department
            } = req.query;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            const report = await AttendanceReportService.getMonthlyReport({
                companyId,
                year: year ? parseInt(year) : null,
                month: month ? parseInt(month) : null,
                fromDate,
                toDate,
                employeeId,
                department
            });

            res.status(200).json({
                success: true,
                data: report
            });
        } catch (error) {
            console.error("Error generating monthly report:", error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Get monthly trend for last 12 months
     * GET /api/attendance/report/trend
     */
    async getMonthlyTrend(req, res) {
        try {
            const { companyId, employeeId } = req.query;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            const trend = await AttendanceReportService.getMonthlyTrend(companyId, employeeId);

            res.status(200).json({
                success: true,
                data: trend
            });
        } catch (error) {
            console.error("Error generating trend data:", error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Get dashboard chart data
     * GET /api/attendance/report/chart
     */
    async getDashboardChart(req, res) {
        try {
            const { companyId, year, month, department } = req.query;

            if (!companyId || !year || !month) {
                return res.status(400).json({ error: "companyId, year, and month are required" });
            }

            const chartData = await AttendanceReportService.getDashboardChartData(
                companyId,
                parseInt(year),
                parseInt(month),
                department
            );

            res.status(200).json({
                success: true,
                data: chartData
            });
        } catch (error) {
            console.error("Error generating chart data:", error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Get daily breakdown
     * GET /api/attendance/report/daily-breakdown
     */
    async getDailyBreakdown(req, res) {
        try {
            const { companyId, year, month, employeeId } = req.query;

            if (!companyId || !year || !month) {
                return res.status(400).json({ error: "companyId, year, and month are required" });
            }

            const breakdown = await AttendanceReportService.getDailyBreakdown(
                companyId,
                parseInt(year),
                parseInt(month),
                employeeId
            );

            res.status(200).json({
                success: true,
                data: breakdown
            });
        } catch (error) {
            console.error("Error generating daily breakdown:", error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Export report to CSV
     * GET /api/attendance/report/export
     */
    async exportReport(req, res) {
        try {
            const {
                companyId,
                year,
                month,
                fromDate,
                toDate,
                employeeId,
                department
            } = req.query;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            const report = await AttendanceReportService.getMonthlyReport({
                companyId,
                year: year ? parseInt(year) : null,
                month: month ? parseInt(month) : null,
                fromDate,
                toDate,
                employeeId,
                department
            });

            // Generate CSV
            let csv = "Employee Name,Emp Code,Department,Total Days,Present,Absent,Late,Half Day,Attendance %,Working Hours\n";

            report.employeeReports.forEach(emp => {
                csv += `"${emp.employeeName}",${emp.empCode || ""},"${emp.department || ""}",${emp.summary.totalDays},${emp.summary.present},${emp.summary.absent},${emp.summary.late},${emp.summary.halfDay},${emp.summary.attendancePercentage},${emp.summary.totalWorkingHours}\n`;
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=attendance-report-${Date.now()}.csv`);
            res.status(200).send(csv);
        } catch (error) {
            console.error("Error exporting report:", error);
            res.status(500).json({ error: error.message });
        }
    }
}

export default new AttendanceReportController();