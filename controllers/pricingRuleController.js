import PricingRule from "../models/Slab/SlabRule.js";

// @desc    Get all pricing rules
// @route   GET /api/pricing-rules
// @access  Public
export const getAllPricingRules = async (req, res) => {
    try {
        const pricingRules = await PricingRule.find();

        if (!pricingRules || pricingRules.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No pricing rules found",
            });
        }

        res.status(200).json({
            success: true,
            count: pricingRules.length,
            data: pricingRules,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pricing rules",
            error: error.message,
        });
    }
};

// @desc    Get single pricing rule by ID
// @route   GET /api/pricing-rules/:id
// @access  Public
export const getPricingRuleById = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate MongoDB ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: "Invalid pricing rule ID format",
            });
        }

        const pricingRule = await PricingRule.findById(id);

        if (!pricingRule) {
            return res.status(404).json({
                success: false,
                message: "Pricing rule not found",
            });
        }

        res.status(200).json({
            success: true,
            data: pricingRule,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pricing rule",
            error: error.message,
        });
    }
};

// @desc    Create new pricing rule
// @route   POST /api/pricing-rules
// @access  Private/Admin
export const createPricingRule = async (req, res) => {
    try {
        const { modules } = req.body;

        // Validate modules exists and is an array
        if (!modules || !Array.isArray(modules) || modules.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Modules array is required and must contain at least one module",
            });
        }

        // Validate each module
        for (const module of modules) {
            if (!module.module) {
                return res.status(400).json({
                    success: false,
                    message: "Module name is required for each module",
                });
            }

            const validModules = ["ATTENDANCE", "SALES", "PRO_SALES", "PAYROLL"];
            if (!validModules.includes(module.module)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid module type: ${module.module}. Must be one of: ${validModules.join(", ")}`,
                });
            }

            if (!module.slabs || !Array.isArray(module.slabs) || module.slabs.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `Module ${module.module} must have at least one slab`,
                });
            }

            // Validate each slab
            for (const slab of module.slabs) {
                if (typeof slab.minEmployees !== "number" || slab.minEmployees < 0) {
                    return res.status(400).json({
                        success: false,
                        message: `minEmployees in module ${module.module} must be a non-negative number`,
                    });
                }

                if (typeof slab.pricePerEmployeePerYear !== "number" || slab.pricePerEmployeePerYear < 0) {
                    return res.status(400).json({
                        success: false,
                        message: `pricePerEmployeePerYear in module ${module.module} must be a non-negative number`,
                    });
                }

                if (slab.maxEmployees !== null && slab.maxEmployees !== undefined) {
                    if (typeof slab.maxEmployees !== "number" || slab.maxEmployees <= slab.minEmployees) {
                        return res.status(400).json({
                            success: false,
                            message: `maxEmployees in module ${module.module} must be greater than minEmployees`,
                        });
                    }
                }
            }

            // Validate slabs don't overlap
            const sortedSlabs = [...module.slabs].sort((a, b) => a.minEmployees - b.minEmployees);
            for (let i = 0; i < sortedSlabs.length - 1; i++) {
                const currentSlab = sortedSlabs[i];
                const nextSlab = sortedSlabs[i + 1];
                
                if (currentSlab.maxEmployees !== null && currentSlab.maxEmployees >= nextSlab.minEmployees) {
                    return res.status(400).json({
                        success: false,
                        message: `Slabs in module ${module.module} have overlapping ranges. Slab ending at ${currentSlab.maxEmployees} overlaps with slab starting at ${nextSlab.minEmployees}`,
                    });
                }
            }
        }

        // Check for duplicate modules
        const moduleNames = modules.map((m) => m.module);
        if (new Set(moduleNames).size !== moduleNames.length) {
            return res.status(400).json({
                success: false,
                message: "Duplicate modules found. Each module can only appear once",
            });
        }

        // Create pricing rule
        const pricingRule = await PricingRule.create({ modules });

        res.status(201).json({
            success: true,
            message: "Pricing rule created successfully",
            data: pricingRule,
        });
    } catch (error) {
        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "A pricing rule with these modules already exists",
                error: error.message,
            });
        }

        // Handle validation errors
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: messages,
            });
        }

        res.status(500).json({
            success: false,
            message: "Error creating pricing rule",
            error: error.message,
        });
    }
};

// @desc    Update pricing rule
// @route   PUT /api/pricing-rules/:id
// @access  Private/Admin
export const updatePricingRule = async (req, res) => {
    try {
        const { id } = req.params;
        const { modules } = req.body;

        // Validate MongoDB ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: "Invalid pricing rule ID format",
            });
        }

        // Check if pricing rule exists
        const existingRule = await PricingRule.findById(id);
        if (!existingRule) {
            return res.status(404).json({
                success: false,
                message: "Pricing rule not found",
            });
        }

        // Validate modules if provided
        if (modules) {
            if (!Array.isArray(modules) || modules.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Modules array is required and must contain at least one module",
                });
            }

            // Validate each module
            for (const module of modules) {
                if (!module.module) {
                    return res.status(400).json({
                        success: false,
                        message: "Module name is required for each module",
                    });
                }

                const validModules = ["ATTENDANCE", "SALES", "PRO_SALES", "PAYROLL"];
                if (!validModules.includes(module.module)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid module type: ${module.module}. Must be one of: ${validModules.join(", ")}`,
                    });
                }

                if (!module.slabs || !Array.isArray(module.slabs) || module.slabs.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Module ${module.module} must have at least one slab`,
                    });
                }

                // Validate each slab
                for (const slab of module.slabs) {
                    if (typeof slab.minEmployees !== "number" || slab.minEmployees < 0) {
                        return res.status(400).json({
                            success: false,
                            message: `minEmployees in module ${module.module} must be a non-negative number`,
                        });
                    }

                    if (typeof slab.pricePerEmployeePerYear !== "number" || slab.pricePerEmployeePerYear < 0) {
                        return res.status(400).json({
                            success: false,
                            message: `pricePerEmployeePerYear in module ${module.module} must be a non-negative number`,
                        });
                    }

                    if (slab.maxEmployees !== null && slab.maxEmployees !== undefined) {
                        if (typeof slab.maxEmployees !== "number" || slab.maxEmployees <= slab.minEmployees) {
                            return res.status(400).json({
                                success: false,
                                message: `maxEmployees in module ${module.module} must be greater than minEmployees`,
                            });
                        }
                    }
                }

                // Validate slabs don't overlap
                const sortedSlabs = [...module.slabs].sort((a, b) => a.minEmployees - b.minEmployees);
                for (let i = 0; i < sortedSlabs.length - 1; i++) {
                    const currentSlab = sortedSlabs[i];
                    const nextSlab = sortedSlabs[i + 1];
                    
                    if (currentSlab.maxEmployees !== null && currentSlab.maxEmployees >= nextSlab.minEmployees) {
                        return res.status(400).json({
                            success: false,
                            message: `Slabs in module ${module.module} have overlapping ranges. Slab ending at ${currentSlab.maxEmployees} overlaps with slab starting at ${nextSlab.minEmployees}`,
                        });
                    }
                }
            }

            // Check for duplicate modules
            const moduleNames = modules.map((m) => m.module);
            if (new Set(moduleNames).size !== moduleNames.length) {
                return res.status(400).json({
                    success: false,
                    message: "Duplicate modules found. Each module can only appear once",
                });
            }
        }

        // Update pricing rule
        const updatedPricingRule = await PricingRule.findByIdAndUpdate(
            id,
            { modules },
            {
                new: true,
                runValidators: true,
            }
        );

        res.status(200).json({
            success: true,
            message: "Pricing rule updated successfully",
            data: updatedPricingRule,
        });
    } catch (error) {
        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "A pricing rule with these modules already exists",
                error: error.message,
            });
        }

        // Handle validation errors
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: messages,
            });
        }

        res.status(500).json({
            success: false,
            message: "Error updating pricing rule",
            error: error.message,
        });
    }
};

// @desc    Delete pricing rule
// @route   DELETE /api/pricing-rules/:id
// @access  Private/Admin
export const deletePricingRule = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate MongoDB ObjectId
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: "Invalid pricing rule ID format",
            });
        }

        // Find and delete pricing rule
        const pricingRule = await PricingRule.findByIdAndDelete(id);

        if (!pricingRule) {
            return res.status(404).json({
                success: false,
                message: "Pricing rule not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Pricing rule deleted successfully",
            data: {},
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting pricing rule",
            error: error.message,
        });
    }
};

// @desc    Get pricing by module name
// @route   GET /api/pricing-rules/module/:moduleName
// @access  Public
export const getPricingByModule = async (req, res) => {
    try {
        const { moduleName } = req.params;

        const validModules = ["ATTENDANCE", "SALES", "PRO_SALES", "PAYROLL"];
        if (!validModules.includes(moduleName.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Invalid module type: ${moduleName}. Must be one of: ${validModules.join(", ")}`,
            });
        }

        const pricingRule = await PricingRule.findOne({
            "modules.module": moduleName.toUpperCase(),
        });

        if (!pricingRule) {
            return res.status(404).json({
                success: false,
                message: `Pricing not found for module: ${moduleName}`,
            });
        }

        const moduleData = pricingRule.modules.find(
            (m) => m.module === moduleName.toUpperCase()
        );

        res.status(200).json({
            success: true,
            data: moduleData,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pricing by module",
            error: error.message,
        });
    }
};

// @desc    Calculate price based on module and employee count
// @route   POST /api/pricing-rules/calculate
// @access  Public
export const calculatePrice = async (req, res) => {
    try {
        const { module: moduleName, employeeCount } = req.body;

        // Validate inputs
        if (!moduleName) {
            return res.status(400).json({
                success: false,
                message: "Module name is required",
            });
        }

        if (!employeeCount || typeof employeeCount !== "number" || employeeCount < 0) {
            return res.status(400).json({
                success: false,
                message: "Employee count must be a non-negative number",
            });
        }

        const validModules = ["ATTENDANCE", "SALES", "PRO_SALES", "PAYROLL"];
        if (!validModules.includes(moduleName.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Invalid module type: ${moduleName}. Must be one of: ${validModules.join(", ")}`,
            });
        }

        // Find pricing rule for the module
        const pricingRule = await PricingRule.findOne({
            "modules.module": moduleName.toUpperCase(),
        });

        if (!pricingRule) {
            return res.status(404).json({
                success: false,
                message: `Pricing not found for module: ${moduleName}`,
            });
        }

        const moduleData = pricingRule.modules.find(
            (m) => m.module === moduleName.toUpperCase()
        );

        // Find applicable slab
        const applicableSlab = moduleData.slabs.find((slab) => {
            if (slab.maxEmployees === null) {
                return employeeCount >= slab.minEmployees;
            }
            return (
                employeeCount >= slab.minEmployees &&
                employeeCount <= slab.maxEmployees
            );
        });

        if (!applicableSlab) {
            return res.status(400).json({
                success: false,
                message: `No pricing slab found for ${employeeCount} employees in ${moduleName} module`,
            });
        }

        // Calculate total price
        const totalPrice = employeeCount * applicableSlab.pricePerEmployeePerYear;

        res.status(200).json({
            success: true,
            data: {
                module: moduleData.module,
                employeeCount,
                pricePerEmployee: applicableSlab.pricePerEmployeePerYear,
                totalPricePerYear: totalPrice,
                slab: {
                    minEmployees: applicableSlab.minEmployees,
                    maxEmployees: applicableSlab.maxEmployees,
                },
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error calculating price",
            error: error.message,
        });
    }
};