import User from "../../models/userModel.js";
import Employee from "../../models/Attandance/Employee.js";
import Attendance from "../../models/Attandance/Attendance.js";
import Holiday from "../../models/Attandance/Holiday.js";
import Payroll from "../../models/Attandance/Payroll.js";
import mongoose from "mongoose";
import PatnerProfile from "../../models/PatnerProfile.js";
import Shift from "../../models/Attandance/Shift.js";
import { getActiveSubscription } from "../../services/subscription.service.js";
import { Subscription } from "../../models/Attandance/subscration/Subscription.js";
import { validateSubscription, canCreateEmployee, getEmployeeLimit, isNearingEmployeeLimit, getRemainingEmployeeSlots } from "../../services/featureAccess.service.js";
// controllers/companyController.js



// controllers/subscription.controller.js


export const getLatestSubscription = async (req, res) => {
    try {
        /* -----------------------------------------
           1. Resolve Company ID (multi-source safe)
        ------------------------------------------ */
        let companyId =
            req.params.companyId ||
            req.query.companyId ||
            req.user?._id ||
            req.user?.id;

        if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing companyId",
            });
        }

        const now = new Date();

        /* -----------------------------------------
           2. Try ACTIVE subscription (strict)
           - status ACTIVE
           - endDate in future
        ------------------------------------------ */
        let subscription = await Subscription.findOne({
            company: companyId,
            status: "ACTIVE",
            endDate: { $gt: now },
            isActive: true,
        })
            .sort({ endDate: -1 }) // latest valid
            .lean();

        /* -----------------------------------------
           3. Fallback: Latest ANY subscription
        ------------------------------------------ */
        if (!subscription) {
            subscription = await Subscription.findOne({
                company: companyId,
                isActive: true,
            })
                .sort({ endDate: -1 }) // most recent
                .lean();
        }

        /* -----------------------------------------
           4. No subscription case
        ------------------------------------------ */
        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: "No subscription found",
            });
        }

        /* -----------------------------------------
           5. Normalize Status (REAL-TIME)
           Avoid relying only on DB stored value
        ------------------------------------------ */
        let computedStatus = subscription.status;

        if (subscription.endDate < now) {
            computedStatus = "EXPIRED";
        } else if (subscription.status === "ACTIVE") {
            computedStatus = "ACTIVE";
        } else if (subscription.status === "PENDING") {
            computedStatus = "PENDING";
        }

        /* -----------------------------------------
           6. Extract Feature Map (FAST ACCESS)
        ------------------------------------------ */
        const featureMap = {};
        if (subscription.planSnapshot?.features) {
            for (const f of subscription.planSnapshot.features) {
                featureMap[f.key] = f.value;
            }
        }

        /* -----------------------------------------
           7. Response (Clean + Structured)
        ------------------------------------------ */
        return res.status(200).json({
            success: true,
            message: "Subscription fetched successfully",
            data: {
                _id: subscription._id,
                company: subscription.company,

                plan: {
                    id: subscription.plan,
                    name: subscription.planSnapshot?.name,
                    price: subscription.planSnapshot?.price,
                    finalPrice: subscription.planSnapshot?.finalPrice,
                    validityDays: subscription.planSnapshot?.validityDays,
                },

                status: computedStatus,
                isActive: subscription.isActive,

                timeline: {
                    startDate: subscription.startDate,
                    endDate: subscription.endDate,
                    isExpired: subscription.endDate < now,
                    daysLeft: Math.max(
                        0,
                        Math.ceil(
                            (new Date(subscription.endDate) - now) /
                            (1000 * 60 * 60 * 24)
                        )
                    ),
                },

                payment: subscription.payment,

                usage: subscription.usage,

                features: featureMap,

                autoRenew: subscription.autoRenew,
                renewalHistory: subscription.renewalHistory,
            },
        });
    } catch (error) {
        console.error("GET SUBSCRIPTION ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
        });
    }
};



export const getCompanyByUser = async (req, res) => {
    try {
        const { userType } = req.params;
        const userId = req.user?._id || req.user?.id;
        if (!userId || !userType) {
            return res.status(400).json({
                success: false,
                message: 'userId and userType are required'
            });
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        let companyDetails = null;

        // ================= PARTNER =================
        if (['partner', 'admin', 'super_admin'].includes(userType)) {

            const partnerProfile = await PatnerProfile.findOne({ User_id: userObjectId })
                .populate('User_id', 'name email')
                .lean();

            if (partnerProfile) {
                companyDetails = {
                    companyId: partnerProfile.User_id,
                    companyName: partnerProfile.firm_name,
                    companyLogo: partnerProfile.logo,
                    email: partnerProfile.email,
                    address: partnerProfile.address || { city: '', state: '' },
                    isIndependent: partnerProfile.isIndependent,
                    adminName: partnerProfile.User_id?.name,
                    userType: 'partner'
                };
            }
        }

        // ================= EMPLOYEE =================
        else if (userType === 'user') {

            const employee = await Employee.findOne({ userId: userObjectId })
                .populate('companyId', 'name email')
                .lean();

            if (!employee) {
                return res.status(404).json({
                    success: false,
                    message: 'Employee mapping not found'
                });
            }

            console.log("Employee found:", employee);
            const companyUserId = employee.companyId?._id || employee.companyId;
            console.log("Employee found, companyUserId:", companyUserId);
            const partnerProfile = await PatnerProfile.findOne({
                User_id: companyUserId
            }).lean();

            if (!partnerProfile) {
                return res.status(404).json({
                    success: false,
                    message: 'Company profile not found'
                });
            }

            companyDetails = {
                companyId: employee.companyId,
                companyName: partnerProfile.firm_name,
                companyLogo: partnerProfile.logo,
                email: partnerProfile.email,
                address: partnerProfile.address || { city: '', state: '' },
                isIndependent: partnerProfile.isIndependent,
                employeeInfo: {
                    empCode: employee.empCode,
                    designation: employee.jobInfo?.designation,
                    department: employee.jobInfo?.department
                },
                userType: 'employee'
            };
        }

        if (!companyDetails) {
            return res.status(404).json({
                success: false,
                message: `No company found for this ${userType}`
            });
        }

        return res.status(200).json({
            success: true,
            data: companyDetails
        });

    } catch (error) {
        console.error('Error in getCompanyByUser:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/* --------------------------------------------------   */

export const createEmployee = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        /* ---------------------------------------------
           1. Auth & Role Validation
        ---------------------------------------------- */
        // Multi-tenant resolution
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        if (!companyId) throw new Error("Unauthorized");

        const allowedRoles = ["partner", 'user', "admin", "super_admin"];
        if (!allowedRoles.includes(role)) {
            throw new Error("Access denied");
        }

        /* ---------------------------------------------
           2. Input Validation
        ---------------------------------------------- */
        const {
            userId,
            shift,
            empCode,
            user_name,
            jobInfo,
            weeklyOff,
            salaryStructure,
            bankDetails,
            officeLocation
        } = req.body;

        if (!userId) throw new Error("userId is required");

        /* ---------------------------------------------
           3. Dependency Validation
        ---------------------------------------------- */
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error("User not found");

        if (shift) {
            const shiftExists = await Shift.findById(shift).session(session);
            if (!shiftExists) throw new Error("Shift not found");
        }

        /* ---------------------------------------------
           4. Duplicate Employee Check
        ---------------------------------------------- */
        const existingEmployee = await Employee.findOne({
            companyId,
            userId
        }).session(session);

        if (existingEmployee) {
            throw new Error("Employee already exists");
        }

        /* ---------------------------------------------
           5. Subscription Validation (USING FEATURE SERVICE)
        ---------------------------------------------- */
        const subscription = await getActiveSubscription(companyId, session);

        // Use the feature service to validate subscription
        const subscriptionStatus = validateSubscription(subscription);
        if (!subscriptionStatus.valid) {
            throw new Error(subscriptionStatus.message);
        }

        // Check if can create employee using the service
        const canCreate = canCreateEmployee(subscription);
        if (!canCreate) {
            const remaining = getRemainingEmployeeSlots(subscription);
            if (remaining === 0) {
                throw new Error("Employee limit reached. Please upgrade your plan to add more employees.");
            }
            throw new Error("Cannot create employee due to subscription restrictions");
        }

        // Get real-time employee count (additional safety check)
        const currentCount = await Employee.countDocuments({
            companyId,
            employmentStatus: "active"
        }).session(session);

        const employeeLimit = getEmployeeLimit(subscription);

        if (currentCount >= employeeLimit) {
            throw new Error(`Employee limit of ${employeeLimit} reached. Please upgrade your plan.`);
        }

        // Check if nearing limit for warning (optional)
        const nearingLimit = isNearingEmployeeLimit(subscription, 80);
        if (nearingLimit) {
            // You can add a warning header or log this
            console.warn(`Company ${companyId} is nearing employee limit: ${currentCount}/${employeeLimit}`);
        }

        /* ---------------------------------------------
           6. Create Employee
        ---------------------------------------------- */
        const employeeData = {
            userId,
            companyId,
            empCode,
            user_name,
            jobInfo,
            shift,
            weeklyOff,
            salaryStructure,
            bankDetails,
            officeLocation,
            employmentStatus: "active"
        };

        const [employee] = await Employee.create([employeeData], { session });

        /* ---------------------------------------------
           7. Update Usage Tracking
        ---------------------------------------------- */
        // Use direct update instead of subscription.save()
        await Subscription.updateOne(
            { _id: subscription._id },
            { $inc: { 'usage.employeesUsed': 1 } },
            { session }
        );

        // Update local subscription object for response
        subscription.usage.employeesUsed = (subscription.usage?.employeesUsed || 0) + 1;

        /* ---------------------------------------------
           8. Commit Transaction
        ---------------------------------------------- */
        await session.commitTransaction();

        // Prepare response with subscription info
        const response = {
            success: true,
            message: "Employee created successfully",
            data: employee,
            subscription: {
                employeesUsed: subscription.usage?.employeesUsed || 0,
                employeeLimit: getEmployeeLimit(subscription),
                remainingSlots: getRemainingEmployeeSlots(subscription),
                nearingLimit: isNearingEmployeeLimit(subscription, 80)
            }
        };

        // Add warning if nearing limit
        if (isNearingEmployeeLimit(subscription, 80)) {
            response.warning = `You have used ${subscription.usage?.employeesUsed || 0} out of ${getEmployeeLimit(subscription)} employee slots. Consider upgrading your plan.`;
        }

        return res.status(201).json(response);

    } catch (error) {
        // Only abort transaction if session is still active and transaction is in progress
        if (session && session.inTransaction()) {
            await session.abortTransaction();
        }

        // Handle specific error cases
        let statusCode = 400;
        let errorResponse = {
            success: false,
            message: error.message
        };

        if (error.message.includes("limit reached")) {
            statusCode = 403;
            errorResponse.code = "EMPLOYEE_LIMIT_REACHED";
        } else if (error.message.includes("subscription")) {
            statusCode = 403;
            errorResponse.code = "SUBSCRIPTION_ERROR";
        } else if (error.message.includes("Unauthorized") || error.message.includes("Access denied")) {
            statusCode = 401;
            errorResponse.code = "UNAUTHORIZED";
        } else if (error.message.includes("not found")) {
            statusCode = 404;
            errorResponse.code = "NOT_FOUND";
        }

        return res.status(statusCode).json(errorResponse);
    } finally {
        // Always end the session
        if (session) {
            session.endSession();
        }
    }
};


export const changeEmployeeRole = async (req, res) => {
    try {
        const { empId } = req.params;
        const { newRole } = req.body;
        const allowedRoles = ['employee', 'manager', 'hr', 'admin', 'super_admin'];
        if (!allowedRoles.includes(newRole)) {
            return res.status(400).json({
                success: false,
                message: "Invalid role provided",
            });
        }

        const employee = await Employee
            .findById(empId)
            .populate("userId", "name email phone");
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        employee.role = newRole;
        await employee.save();
        return res.status(200).json({
            success: true,
            message: "Employee role updated successfully",
            data: employee
        });
    } catch (error) {
        console.error("changeEmployeeRole Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

/* ---------------------------------------------
   Update EMPLOYEE (ENTERPRISE LEVEL)
---------------------------------------------- */



const VALID_DAYS = [
    "Sunday", "Monday", "Tuesday",
    "Wednesday", "Thursday", "Friday", "Saturday"
];

const normalizeDay = (day) => {
    if (!day) return null;
    return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
};

export const updateEmployee = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        /* ---------------------------------------------
           1. Authorization (Multi-Tenant Security)
        ---------------------------------------------- */

        let companyId;
        companyId = req.user?._id || req.user?.id;
        const userRole = req.user?.role || req.user?.type;

        if (userRole === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }


        if (!companyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        if (!['partner', 'admin', 'super_admin', 'user'].includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        /* ---------------------------------------------
           2. Params Validation
        ---------------------------------------------- */
        const { employeeId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid employeeId",
            });
        }

        const existingEmployee = await Employee.findOne({
            _id: employeeId,
            companyId
        }).session(session);

        if (!existingEmployee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found",
            });
        }

        /* ---------------------------------------------
           3. Extract Input
        ---------------------------------------------- */
        const {
            user_name,
            role,
            jobInfo,
            salaryStructure,
            bankDetails,
            shift,
            weeklyOff,
            officeLocation,
            employmentStatus
        } = req.body;

        const updatePayload = {};

        /* ---------------------------------------------
           4. Basic Fields
        ---------------------------------------------- */
        if (user_name !== undefined) updatePayload.user_name = user_name;

        if (role && ['employee', 'manager', 'hr', 'admin', 'super_admin'].includes(role)) {
            updatePayload.role = role;
        }

        /* ---------------------------------------------
           5. SHIFT (Critical Validation)
        ---------------------------------------------- */
        if (shift !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(shift)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid shift ID",
                });
            }

            const shiftDoc = await Shift.findOne({
                _id: shift,
                companyId
            }).session(session);

            if (!shiftDoc) {
                return res.status(404).json({
                    success: false,
                    message: "Shift not found or not belongs to your company",
                });
            }

            updatePayload.shift = shift;
        }

        /* ---------------------------------------------
           6. WEEKLY OFF (Strict Enum Validation)
        ---------------------------------------------- */
        if (weeklyOff !== undefined) {
            if (!Array.isArray(weeklyOff)) {
                return res.status(400).json({
                    success: false,
                    message: "weeklyOff must be an array",
                });
            }

            const normalizedDays = weeklyOff.map(normalizeDay);

            const invalidDays = normalizedDays.filter(day => !VALID_DAYS.includes(day));

            if (invalidDays.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid weeklyOff values: ${invalidDays.join(", ")}`,
                });
            }

            // remove duplicates
            updatePayload.weeklyOff = [...new Set(normalizedDays)];
        }

        /* ---------------------------------------------
           7. Nested Structures (Safe Merge)
        ---------------------------------------------- */
        if (jobInfo) {
            updatePayload.jobInfo = {
                ...existingEmployee.jobInfo.toObject(),
                ...jobInfo
            };
        }

        if (salaryStructure) {
            updatePayload.salaryStructure = {
                ...existingEmployee.salaryStructure.toObject(),
                ...salaryStructure
            };
        }

        if (bankDetails) {
            updatePayload.bankDetails = {
                ...existingEmployee.bankDetails.toObject(),
                ...bankDetails
            };
        }

        /* ---------------------------------------------
           8. GEO LOCATION
        ---------------------------------------------- */
        if (officeLocation?.coordinates) {
            if (!Array.isArray(officeLocation.coordinates) || officeLocation.coordinates.length !== 2) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid coordinates format",
                });
            }

            updatePayload.officeLocation = {
                type: "Point",
                coordinates: officeLocation.coordinates || existingEmployee.officeLocation?.coordinates,
                radius: officeLocation.radius || existingEmployee.officeLocation?.radius || 100,
                manual: officeLocation.manual || existingEmployee.officeLocation?.manual || 'IND',
                locationtype: officeLocation.locationtype || existingEmployee.officeLocation?.locationtype || 'IND',
            };
        }

        if (employmentStatus) {
            updatePayload.employmentStatus = employmentStatus;
        }

        /* ---------------------------------------------
           9. Atomic Update
        ---------------------------------------------- */
        const updatedEmployee = await Employee.findOneAndUpdate(
            { _id: employeeId, companyId },
            { $set: updatePayload },
            {
                new: true,
                runValidators: true,
                session
            }
        );

        /* ---------------------------------------------
           10. Commit
        ---------------------------------------------- */
        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({
            success: true,
            message: "Employee updated successfully",
            data: updatedEmployee
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        console.error("UpdateEmployee Error:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate constraint violation",
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};



export const findbyPhone = async (req, res) => {
    const { phone } = req.body;
    try {
        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            })
        }

        return res.status(200).json({
            success: true,
            message: "Employee found",
            data: user
        })
    } catch (error) {
        console.error("FindByPhone Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
}

export const findbyReferralCode = async (req, res) => {
    const { referalCode } = req.body;
    try {

        const user = await User.findOne({ referalCode });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            })
        }

        return res.status(200).json({
            success: true,
            message: "Employee found",
            data: user
        })
    }
    catch (error) {
        console.error("FindByReferralCode Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
}



/* --------------------------------------------------
   GET ALL EMPLOYEES WITH PAGINATION
--------------------------------------------------- */
export const getAllEmployees = async (req, res) => {
    try {
        /* ---------------------------------------------
           1. Auth Validation
           ---------------------------------------------- */
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const roles = req.user?.role || req.user?.type;

        if (roles === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }



        if (!companyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        /* ---------------------------------------------
           2. Read Query Params
        ---------------------------------------------- */
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 10, 100); // max 100

        const skip = (page - 1) * limit;

        /* ---------------------------------------------
           3. Optional Filters (Scalable)
        ---------------------------------------------- */
        const {
            role,
            department,
            status,
            search,
        } = req.query;

        const filter = {
            companyId,
        };

        if (role) filter.role = role;

        if (status) filter.employmentStatus = status;

        if (department) {
            filter["jobInfo.department"] = department;
        }

        if (search) {
            filter.$or = [
                { empCode: { $regex: search, $options: "i" } },
            ];
        }

        /* ---------------------------------------------
           4. Execute Queries in Parallel
        ---------------------------------------------- */
        const [employees, total] = await Promise.all([

            Employee.find(filter)
                .populate("userId", "name email phone")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            Employee.countDocuments(filter)

        ]);

        /* ---------------------------------------------
           5. Pagination Meta
        ---------------------------------------------- */
        const totalPages = Math.ceil(total / limit);

        /* ---------------------------------------------
           6. Response
        ---------------------------------------------- */
        return res.status(200).json({
            success: true,
            message: "Employees fetched successfully",

            meta: {
                totalRecords: total,
                totalPages,
                currentPage: page,
                pageSize: limit,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },

            data: employees,
        });

    } catch (error) {

        console.error("getAllEmployees Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

export const getEmpDetails = async (req, res) => {
    const { empId } = req.params;
    try {
        const employee = await Employee.findById(empId);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Employee details fetched successfully",
            data: employee
        })
    } catch (error) {
        console.error("getEmpDetails Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
}

export const getEmpByUserId = async (req, res) => {
    const userId = req.user?._id;
    try {
        const employee = await Employee.findOne({ userId }).populate("userId", "name email phone");
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Employee details fetched successfully",
            data: employee
        })
    } catch (error) {
        console.error("getEmpByUserId Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
}


export const checkEmpButton = async (req, res) => {
    const userId = req.user?._id;
    try {
        const employee = await Employee.findOne({ userId, employmentStatus: "active" });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Employee found",
            data: {
                showButton: true
            }
        })
    }
    catch (error) {
        console.error("checkEmpButton Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
}



export const deactivateEmployee = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        await session.startTransaction();

        const { empId } = req.params;
        const { reason } = req.body;

        const adminId = req.user._id;

        /* ===========================
           VALIDATE ADMIN
        ============================ */

        const admin = await User.findById(adminId).session(session);
        if (!admin) throw new Error("ADMIN_NOT_FOUND");

        /* ===========================
           FETCH EMPLOYEE (MULTI-TENANT SAFE)
        ============================ */

        const employee = await Employee.findOne({
            _id: empId,
            companyId: admin._id // 🔒 company isolation
        }).session(session);

        if (!employee) {
            throw new Error("EMPLOYEE_NOT_FOUND");
        }

        /* ===========================
           IDEMPOTENCY CHECK
        ============================ */

        if (employee.employmentStatus === "inactive") {
            return res.status(200).json({
                success: true,
                message: "Employee already inactive",
                data: employee
            });
        }

        /* ===========================
           BUSINESS RULES
        ============================ */

        // Prevent self-deactivation (optional)
        if (employee.userId.toString() === adminId.toString()) {
            throw new Error("CANNOT_DEACTIVATE_SELF");
        }

        /* ===========================
           UPDATE (SOFT DELETE)
        ============================ */

        employee.employmentStatus = "inactive";
        employee.deactivatedAt = new Date();
        employee.deactivatedBy = adminId;
        employee.deactivationReason = reason || "No reason provided";

        await employee.save({ session });

        /* ===========================
           OPTIONAL: CASCADE EFFECTS
        ============================ */

        // Example:
        // - Disable login
        // - Remove active sessions
        // - Stop attendance marking
        // - Remove from active shifts

        /* ===========================
           COMMIT
        ============================ */

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "Employee deactivated successfully",
            data: {
                employeeId: employee._id,
                status: employee.employmentStatus,
                deactivatedAt: employee.deactivatedAt
            }
        });

    } catch (error) {
        await session.abortTransaction();

        return res.status(400).json({
            success: false,
            error: error.message
        });

    } finally {
        session.endSession();
    }
};

