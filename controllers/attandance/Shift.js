import Shift from "../../models/Attandance/Shift.js";
import mongoose from "mongoose";


/**
 * @desc Create Shift
 * @route POST /api/shifts
 * @access Private (Company)
 */
export const createShift = async (req, res) => {
    try {
        const companyId = req.user._id;

        const {
            shiftName,
            shiftCode,
            startTime,
            endTime,
            shiftType,
            weeklyOff,
            breaks,
            gracePeriod,
            overtime,
            isNightShift
        } = req.body;

        // Basic validation
        if (!shiftName || !shiftCode || !startTime || !endTime) {
            return res.status(400).json({
                success: false,
                message: "Required fields missing"
            });
        }

        // Unique check (important for enterprise)
        const existing = await Shift.findOne({
            companyId,
            shiftCode: shiftCode.toUpperCase()
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                message: "Shift code already exists"
            });
        }

        const shift = await Shift.create({
            companyId,
            shiftName,
            shiftCode: shiftCode.toUpperCase(),
            startTime,
            endTime,
            shiftType,
            weeklyOff,
            breaks,
            gracePeriod,
            overtime,
            isNightShift
        });

        return res.status(201).json({
            success: true,
            data: shift
        });

    } catch (error) {
        console.error("Create Shift Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


/**
 * @desc Update Shift
 * @route PUT /api/shifts/:id
 */
export const updateShift = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Shift ID"
            });
        }

        const updateData = { ...req.body };

        // Prevent critical overwrite
        delete updateData.companyId;

        if (updateData.shiftCode) {
            updateData.shiftCode = updateData.shiftCode.toUpperCase();

            const existing = await Shift.findOne({
                companyId,
                shiftCode: updateData.shiftCode,
                _id: { $ne: id }
            });

            if (existing) {
                return res.status(409).json({
                    success: false,
                    message: "Shift code already exists"
                });
            }
        }

        const shift = await Shift.findOneAndUpdate(
            { _id: id, companyId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!shift) {
            return res.status(404).json({
                success: false,
                message: "Shift not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: shift
        });

    } catch (error) {
        console.error("Update Shift Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


/**
 * @desc Delete Shift (Soft Delete)
 * @route DELETE /api/shifts/:id
 */
export const deleteShift = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user._id;

        const shift = await Shift.findOneAndUpdate(
            { _id: id, companyId },
            {
                isDeleted: true,
                deletedAt: new Date()
            },
            { new: true }
        );

        if (!shift) {
            return res.status(404).json({
                success: false,
                message: "Shift not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Shift deleted successfully"
        });

    } catch (error) {
        console.error("Delete Shift Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};



export const toggleNightShift = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user._id;

        const shift = await Shift.findOne({ _id: id, companyId });

        if (!shift) {
            return res.status(404).json({
                success: false,
                message: "Shift not found"
            });
        }

        shift.isNightShift = !shift.isNightShift;
        await shift.save();

        return res.status(200).json({
            success: true,
            data: shift
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};


export const toggleOvertime = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user._id;

        const shift = await Shift.findOne({ _id: id, companyId });

        if (!shift) {
            return res.status(404).json({
                success: false,
                message: "Shift not found"
            });
        }

        shift.overtime.allowed = !shift.overtime.allowed;
        await shift.save();

        return res.status(200).json({
            success: true,
            data: shift
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};


export const toggleWeeklyOff = async (req, res) => {
    try {
        const { id } = req.params;
        const { day } = req.body;
        const companyId = req.user._id;

        const shift = await Shift.findOne({ _id: id, companyId });

        if (!shift) {
            return res.status(404).json({
                success: false,
                message: "Shift not found"
            });
        }

        const exists = shift.weeklyOff.includes(day);

        if (exists) {
            shift.weeklyOff = shift.weeklyOff.filter(d => d !== day);
        } else {
            shift.weeklyOff.push(day);
        }

        await shift.save();

        return res.status(200).json({
            success: true,
            data: shift
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};


export const getAllShifts = async (req, res) => {
    try {
        const companyId = req.user._id;

        const {
            page = 1,
            limit = 10,
            search = ""
        } = req.query;

        const query = {
            companyId,
            $or: [
                { shiftName: { $regex: search, $options: "i" } },
                { shiftCode: { $regex: search, $options: "i" } }
            ]
        };

        const shifts = await Shift.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .lean();

        const total = await Shift.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: shifts,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};  