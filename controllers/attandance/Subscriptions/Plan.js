import Plan from "../../../models/Attandance/subscration/plan.js";
import mongoose from "mongoose";

import crypto from "crypto";

export const normalizeFeatureKey = (key) =>
    key.toString().trim().toUpperCase().replace(/\s+/g, "_");

export const generateFeatureKey = () =>
    `FEATURE_${crypto.randomUUID().replace(/-/g, "_")}`;

export const formatFeatures = (features = []) => {
    return features.map((feature) => {
        if (
            typeof feature === "object" &&
            feature !== null &&
            feature.key &&
            feature.value !== undefined
        ) {
            return {
                key: normalizeFeatureKey(feature.key),
                value: feature.value,
                description:
                    feature.description || String(feature.value),
            };
        }

        return {
            key: generateFeatureKey(),
            value: feature,
            description: String(feature || ""),
        };
    });
};

export const calculateFinalPrice = (price, discount) => {
    if (discount > 0) {
        return Math.round(price * (1 - discount / 100));
    }
    return price;
};

export const buildFeatureVersion = (type) => {
    return {
        UAI_Pro: type === "PRO",
        UAI_Basic: type === "BASIC",
        UAI_Sales: type === "SALES",
    };
};


/**
 * @desc Create Plan
 * @route POST /api/plan
 */

export const createPlan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        let {
            name,
            price,
            discount = 0,
            validityDays,
            features = [],
            planType = "BASIC",
            data_export = false,
            data_see = false,
            isfree = false,
            Max_Employees = 0,
            feature_version_type = "BASIC", // NEW FIELD
        } = req.body;

        // ===== VALIDATION =====
        if (!name || price == null || !validityDays) {
            throw new Error("Name, price and validityDays are required");
        }

        // ===== DUPLICATE CHECK =====
        const existing = await Plan.findOne({
            name: new RegExp(`^${name.trim()}$`, "i"),
        }).session(session);

        if (existing) {
            throw new Error("Plan already exists");
        }

        // ===== TRANSFORM =====
        const formattedFeatures = formatFeatures(features);

        const finalPrice = calculateFinalPrice(price, discount);

        const features_version = buildFeatureVersion(
            feature_version_type.toUpperCase()
        );

        // ===== CREATE =====
        const plan = await Plan.create(
            [
                {
                    name: name.trim(),
                    price: Number(price),
                    discount: Number(discount),
                    finalPrice,
                    validityDays: Number(validityDays),
                    features: formattedFeatures,
                    planType: planType.toUpperCase(),
                    data_export: Boolean(data_export),
                    data_see: Boolean(data_see),
                    isfree: Boolean(isfree),
                    Max_Employees: Number(Max_Employees),
                    features_version,
                },
            ],
            { session }
        );

        await session.commitTransaction();

        return res.status(201).json({
            success: true,
            message: "Plan created successfully",
            data: plan[0],
        });
    } catch (error) {
        await session.abortTransaction();

        return res.status(400).json({
            success: false,
            message: error.message || "Create failed",
        });
    } finally {
        session.endSession();
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
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new Error("Invalid Plan ID");
        }

        let {
            features,
            price,
            discount,
            planType,
            data_export,
            data_see,
            isfree,
            Max_Employees,
            feature_version_type, // NEW
            ...rest
        } = req.body;

        const updateData = { ...rest };

        // ===== FEATURES =====
        if (features) {
            updateData.features = formatFeatures(features);
        }

        // ===== PRICING =====
        if (price !== undefined || discount !== undefined) {
            const existing = await Plan.findById(id).session(session);
            if (!existing) throw new Error("Plan not found");

            const newPrice = price ?? existing.price;
            const newDiscount = discount ?? existing.discount;

            updateData.price = Number(newPrice);
            updateData.discount = Number(newDiscount);
            updateData.finalPrice = calculateFinalPrice(
                newPrice,
                newDiscount
            );
        }

        // ===== ENUMS =====
        if (planType) {
            updateData.planType = planType.toUpperCase();
        }

        // ===== FLAGS =====
        if (data_export !== undefined)
            updateData.data_export = Boolean(data_export);

        if (data_see !== undefined)
            updateData.data_see = Boolean(data_see);

        if (isfree !== undefined)
            updateData.isfree = Boolean(isfree);

        if (Max_Employees !== undefined)
            updateData.Max_Employees = Number(Max_Employees);

        // ===== FEATURE VERSION TOGGLE =====
        if (feature_version_type) {
            updateData.features_version = buildFeatureVersion(
                feature_version_type.toUpperCase()
            );
        }

        // ===== UPDATE =====
        const updatedPlan = await Plan.findByIdAndUpdate(
            id,
            { $set: updateData },
            {
                new: true,
                runValidators: true,
                session,
            }
        );

        if (!updatedPlan) {
            throw new Error("Plan not found");
        }

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "Plan updated successfully",
            data: updatedPlan,
        });
    } catch (error) {
        await session.abortTransaction();

        return res.status(400).json({
            success: false,
            message: error.message || "Update failed",
        });
    } finally {
        session.endSession();
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