import Attendance from '../models/Attandance/Attendance.js';
import Employee from '../models/Attandance/Employee.js';
import Shift from '../models/Attandance/Shift.js';
import { convertMinutesToHHMM } from '../config/timehh.js';

export const startBreakController = async (req, res) => {

    try {

        const { breakType } = req.body;

        const employeeId = req.user._id;
        const companyId = req.user.companyId;
        /**
         * FIND TODAY ATTENDANCE
         */
        const attendance = await Attendance.findOne({
            employeeId,
            companyId,
            
            date: {
                $gte: new Date().setHours(0, 0, 0, 0),
                $lte: new Date().setHours(23, 59, 59, 999)
            }
        });

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance not found"
            });
        }

        /**
         * ACTIVE BREAK CHECK
         */
        const activeBreak = attendance.breaks.find(
            item => item.status === "active"
        );

        if (activeBreak) {
            return res.status(400).json({
                success: false,
                message: "Another break already active"
            });
        }

        /**
         * SHIFT VALIDATION
         */
        const employee = await Employee.findById(employeeId)
            .populate("shiftId");

        const shift = employee.shiftId;

        const shiftBreak = shift.breaks.find(
            item =>
                item.name.toLowerCase() === breakType.toLowerCase()
        );

        if (!shiftBreak) {
            return res.status(400).json({
                success: false,
                message: "Break not allowed"
            });
        }

        /**
         * CREATE BREAK
         */
        attendance.breaks.push({

            type: breakType.toLowerCase(),

            breakName: shiftBreak.name,

            startTime: new Date(),

            allowedMinutes: shiftBreak.duration,

            isPaid: shiftBreak.isPaid,

            status: "active"
        });

        await attendance.save();

        return res.status(200).json({
            success: true,
            message: "Break started successfully"
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};




export const endBreakController = async (req, res) => {

    try {

        const employeeId = req.user._id;
        const companyId = req.user.companyId;
        /**
         * FIND ATTENDANCE
         */
        const attendance = await Attendance.findOne({
            employeeId,
            companyId,
            date: {
                $gte: new Date().setHours(0, 0, 0, 0),
                $lte: new Date().setHours(23, 59, 59, 999)
            }
        });

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance not found"
            });
        }

        /**
         * FIND ACTIVE BREAK
         */
        const activeBreak = attendance.breaks.find(
            item => item.status === "active"
        );

        if (!activeBreak) {
            return res.status(400).json({
                success: false,
                message: "No active break found"
            });
        }

        /**
         * END BREAK
         */
        activeBreak.endTime = new Date();

        /**
         * CALCULATE DURATION
         */
        const durationMinutes = Math.floor(
            (activeBreak.endTime - activeBreak.startTime)
            / (1000 * 60)
        );

        activeBreak.durationMinutes = durationMinutes;

        /**
         * HH:MM FORMAT
         */
        activeBreak.durationHHMM =
            convertMinutesToHHMM(durationMinutes);

        /**
         * EXCEEDED MINUTES
         */
        activeBreak.exceededMinutes =
            Math.max(
                0,
                durationMinutes - activeBreak.allowedMinutes
            );

        activeBreak.status = "completed";

        /**
         * TOTAL BREAK MINUTES
         */
        attendance.workSummary.totalBreakMinutes =
            attendance.breaks.reduce((total, item) => {

                return total + item.durationMinutes;

            }, 0);

        await attendance.save();

        return res.status(200).json({
            success: true,
            message: "Break ended successfully",
            data: activeBreak
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}; 