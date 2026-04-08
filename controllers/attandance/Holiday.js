import Holiday from "../../models/Attandance/Holiday.js";
import Employee from "../../models/Attandance/Employee.js";
import mongoose from "mongoose";




export const getAllEmpHolidays = async (req, res) => {
    try {
        /* =========================================
           1. AUTH VALIDATION
        ========================================= */
        const userId = req.user?._id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        /* =========================================
           2. FETCH EMPLOYEE
        ========================================= */
        const employee = await Employee.findOne({ userId }).lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        const companyId = employee.companyId;

        /* =========================================
           3. FETCH ALL HOLIDAYS (NO FILTER)
        ========================================= */
        const holidays = await Holiday.find({
            companyId: new mongoose.Types.ObjectId(companyId)
        })
            .sort({ date: 1 })
            .lean();

        /* =========================================
           4. RESPONSE
        ========================================= */
        return res.status(200).json({
            success: true,
            count: holidays.length,
            data: holidays
        });

    } catch (error) {
        console.error("GetAllEmpHolidays Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch holidays"
        });
    }
};

/**
 * Create Holiday
 */
export const createHoliday = async (req, res) => {
    try {
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        const {
            name,
            date,
            type,
            isPaid,
            applicableTo
        } = req.body;

        // Prevent duplicate holiday
        const exists = await Holiday.findOne({
            companyId,
            date: new Date(date)
        });

        if (exists) {
            return res.status(409).json({
                success: false,
                message: "Holiday already exists on this date"
            });
        }

        const holiday = await Holiday.create({
            companyId,
            name,
            date,
            type,
            isPaid,
            applicableTo,
            createdBy: companyId
        });

        return res.status(201).json({
            success: true,
            message: "Holiday created successfully",
            data: holiday
        });

    } catch (error) {
        console.error("CreateHoliday Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create holiday"
        });
    }
};

/**
 * Update Holiday
 */
export const updateHoliday = async (req, res) => {
    try {
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }
        const holidayId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(holidayId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Holiday ID"
            });
        }

        const holiday = await Holiday.findOneAndUpdate(
            {
                _id: holidayId,
                companyId
            },
            req.body,
            { new: true, runValidators: true }
        );

        if (!holiday) {
            return res.status(404).json({
                success: false,
                message: "Holiday not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Holiday updated successfully",
            data: holiday
        });

    } catch (error) {
        console.error("UpdateHoliday Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update holiday"
        });
    }
};

/**
 * Delete Holiday
 */
export const deleteHoliday = async (req, res) => {
    try {
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }
        const holidayId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(holidayId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Holiday ID"
            });
        }

        const holiday = await Holiday.findOneAndDelete({
            _id: holidayId,
            companyId
        });

        if (!holiday) {
            return res.status(404).json({
                success: false,
                message: "Holiday not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Holiday deleted successfully"
        });

    } catch (error) {
        console.error("DeleteHoliday Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to delete holiday"
        });
    }
};

/**
 * Get All Holidays (Company Wise)
 */
export const getAllHolidays = async (req, res) => {
    try {
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        const {
            year,
            type,
            isPaid
        } = req.query;

        const filter = { companyId };

        // Filter by year
        if (year) {
            filter.date = {
                $gte: new Date(`${year}-01-01`),
                $lte: new Date(`${year}-12-31`)
            };
        }

        // Filter by type
        if (type) {
            filter.type = type;
        }

        // Filter by paid/unpaid
        if (isPaid !== undefined) {
            filter.isPaid = isPaid === "true";
        }

        const holidays = await Holiday.find(filter)
            .sort({ date: 1 })
            .lean();

        return res.status(200).json({
            success: true,
            count: holidays.length,
            data: holidays
        });

    } catch (error) {
        console.error("GetAllHolidays Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch holidays"
        });
    }
};


/**
 * Get Single Holiday
 */
export const getHolidayById = async (req, res) => {
    try {
        
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        const holidayId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(holidayId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Holiday ID"
            });
        }

        const holiday = await Holiday.findOne({
            _id: holidayId,
            companyId
        }).lean();

        if (!holiday) {
            return res.status(404).json({
                success: false,
                message: "Holiday not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: holiday
        });

    } catch (error) {
        console.error("GetHolidayById Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch holiday"
        });
    }
};
