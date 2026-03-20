import Plan from "../../../models/Attandance/subscration/plan.js";
import mongoose from "mongoose";

/**
 * @desc Create Plan
 * @route POST /api/plan
 */
export const createPlan = async (req, res) => {
    try {
        const { name, price, discount = 0, validityDays, features = [], planType = "BASIC" } = req.body;

        if (!name || !price || !validityDays) {
            return res.status(400).json({
                success: false,
                message: "Name, price, and validityDays are required"
            });
        }

        // Check duplicate (case insensitive)
        const existing = await Plan.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: "Plan with this name already exists"
            });
        }

        // Convert simple string features to schema format
        const formattedFeatures = features.map((feature, index) => ({
            key: `FEATURE_${index + 1}`,
            value: feature,
            description: feature
        }));

        const plan = await Plan.create({
            name: name.trim(),
            price: Number(price),
            discount: Number(discount),
            validityDays: Number(validityDays),
            features: formattedFeatures,
            planType: planType.toUpperCase(),
        });

        return res.status(201).json({
            success: true,
            message: "Plan created successfully",
            data: plan
        });

    } catch (error) {
        console.error("Create Plan Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


/**
 * @desc Get Plan By ID
 * @route GET /api/plan/:id
 */
export const getPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Plan ID"
            });
        }

        const plan = await Plan.findById(id);

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: "Plan not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: plan
        });

    } catch (error) {
        console.error("Get Plan By ID Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};
/**
 * @desc Update Plan
 * @route PUT /api/plan/:id
 */
export const updatePlan = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Plan ID"
            });
        }

        const { features = [], planType, ...rest } = req.body;

        const formattedFeatures = features.map((feature, index) => ({
            key: `FEATURE_${index + 1}`,
            value: feature,
            description: feature
        }));

        const updatedPlan = await Plan.findByIdAndUpdate(
            id,
            {
                ...rest,
                features: formattedFeatures,
                planType: planType ? planType.toUpperCase() : undefined,
            },
            { new: true, runValidators: true }
        );

        if (!updatedPlan) {
            return res.status(404).json({
                success: false,
                message: "Plan not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Plan updated successfully",
            data: updatedPlan
        });

    } catch (error) {
        console.error("Update Plan Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

/**
 * @desc Delete Plan
 * @route DELETE /api/plan/:id
 */
export const deletePlan = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Plan ID" });
        }

        const deleted = await Plan.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Plan not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Plan deleted successfully"
        });

    } catch (error) {
        console.error("Delete Plan Error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * @desc Toggle Plan Status
 * @route PATCH /api/plan/toggle/:id
 */
export const togglePlanStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await Plan.findById(id);
        if (!plan) {
            return res.status(404).json({ success: false, message: "Plan not found" });
        }

        plan.isActive = !plan.isActive;
        await plan.save();

        return res.status(200).json({
            success: true,
            message: `Plan is now ${plan.isActive ? "Active" : "Inactive"}`,
            data: plan
        });

    } catch (error) {
        console.error("Toggle Plan Error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * @desc Get All Plans
 * @route GET /api/plan
 */
export const getAllPlans = async (req, res) => {
    try {
        let { page = 1, limit = 15, search, isActive, planType } = req.query;

        page = parseInt(page);
        limit = parseInt(limit);

        const query = {};

        if (search) {
            query.name = { $regex: search, $options: "i" };
        }
        if (isActive !== undefined) {
            query.isActive = isActive === "true";
        }
        if (planType) {
            query.planType = planType.toUpperCase();
        }

        const plans = await Plan.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Plan.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: plans,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Get All Plans Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};