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
import {
    canCreateEmployee,
    getEmployeeLimit,
    getRemainingEmployeeSlots,
    getEmployeeBreakdown,
    isNearingEmployeeLimit,
    getCurrentEmployeeCount
} from "../../services/featureAccess.service.js";
// controllers/companyController.js
import { hasPlanType } from "../../services/featureAccess.service.js";


export const activateEmployee = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const { empId } = req.params;
        const adminId = req.user._id;

        /* ===========================
           FETCH EMPLOYEE (SECURE)
        ============================ */

        const employee = await Employee.findOne({
            _id: empId,
            companyId: adminId
        }).session(session);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        /* ===========================
           ONLY INACTIVE → ACTIVE
        ============================ */

        if (employee.employmentStatus === "active") {
            return res.status(200).json({
                success: true,
                message: "Employee already active",
                data: {
                    employeeId: employee._id,
                    status: employee.employmentStatus
                }
            });
        }

        /* ===========================
           ACTIVATE
        ============================ */

        employee.employmentStatus = "active";
        employee.deactivatedAt = null;
        employee.deactivatedBy = null;
        employee.deactivationReason = null;

        await employee.save({ session });

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "Employee activated successfully",
            data: {
                employeeId: employee._id,
                status: employee.employmentStatus
            }
        });

    } catch (error) {
        await session.abortTransaction();

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });

    } finally {
        session.endSession();
    }
};


export const getSalesEmployeesByCompanyPaginated = async (req, res) => {
    try {
        let { page = 1, limit = 10, employeeType } = req.query;

        const companyId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID"
            });
        }

        page = Math.max(1, Number(page));
        limit = Math.min(50, Number(limit));

        const skip = (page - 1) * limit;

        const filter = {
            companyId,
            employmentStatus: "active"
        };

        // ================= EMPLOYEE TYPE FILTER =================

        // Default -> sales + pro_sales
        let employeeTypes = ["sales", "pro_sales"];

        // If user passes query param
        if (employeeType && employeeType.trim() !== "") {
            employeeTypes = employeeType
                .split(",")
                .map(type => type.trim())
                .filter(Boolean);
        }

        filter.employeeType = {
            $in: employeeTypes
        };

        const projection = {
            _id: 0,
            userId: 1,
            user_name: 1,
            empCode: 1,
            role: 1,
            employeeType: 1,
            "jobInfo.designation": 1
        };

        const [data, total] = await Promise.all([
            Employee.find(filter, projection)
                .skip(skip)
                .limit(limit)
                .lean(),

            Employee.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            },
            data
        });

    } catch (error) {
        console.error("getEmployees error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

export const getEmployees = async (req, res) => {
    try {
        const companyId = req.user?._id || req.user?.id;

        const status = req.query.status || "all";

        const filter = { companyId };

        if (status !== "all") {
            filter.employmentStatus = status;
        }

        const employees = await Employee.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            data: employees
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};
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
        /* =============================================
           1. AUTH & COMPANY RESOLUTION
        ============================================= */
        let companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (role === "user") {
            companyId = req.user?.companyId;
        }

        if (!companyId) {
            throw new Error("Unauthorized");
        }

        // Validate role
        const allowedRoles = ["partner", "user", "admin", "super_admin"];
        if (!allowedRoles.includes(role)) {
            throw new Error("Access denied");
        }

        /* =============================================
           2. INPUT VALIDATION
        ============================================= */
        const {
            userId,
            shift,
            empCode,
            user_name,
            jobInfo,
            weeklyOff,
            salaryStructure,
            bankDetails,
            officeLocation,
            employeeType = "non_sales",
            referalCode
        } = req.body;

        // Required fields
        if (!userId) throw new Error("userId is required");
        if (!["sales", "pro_sales", "non_sales"].includes(employeeType)) {
            throw new Error("Invalid employeeType. Must be: sales, pro_sales, or non_sales");
        }

        /* =============================================
           3. VALIDATE DEPENDENCIES
        ============================================= */
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error("User not found");

        if (shift) {
            const shiftExists = await Shift.findById(shift).session(session);
            if (!shiftExists) throw new Error("Shift not found");
        }

        /* =============================================
           4. PREVENT DUPLICATE EMPLOYEE
        ============================================= */
        const existing = await Employee.findOne({
            companyId,
            userId
        }).session(session);

        if (existing) {
            throw new Error("Employee already exists for this user");
        }

        /* =============================================
           5. GET ACTIVE SUBSCRIPTION
        ============================================= */
        const subscription = await Subscription.findOne({
            company: companyId,
            status: "ACTIVE",
            isActive: true,
            endDate: { $gte: new Date() }
        }).session(session);

        if (!subscription) {
            throw new Error("No active subscription found");
        }

        /* =============================================
           6. TYPE-AWARE LIMIT VALIDATION
        ============================================= */
        const validationResult = canCreateEmployee(subscription, employeeType);

        if (!validationResult.canCreate) {
            throw new Error(validationResult.message);
        }

        /* =============================================
           7. CREATE EMPLOYEE RECORD
        ============================================= */
        const employeeData = {
            userId,
            companyId,
            empCode: empCode || `EMP-${Date.now()}`,
            employeeType,
            referalCode,
            user_name: user_name || user.name,
            jobInfo,
            shift,
            weeklyOff,
            salaryStructure,
            bankDetails,
            officeLocation,
            employmentStatus: "active"
        };

        const [employee] = await Employee.create([employeeData], { session });

        /* =============================================
           8. UPDATE SUBSCRIPTION USAGE (TYPE-AWARE)
        ============================================= */
        // Always increment total
        let incQuery = {
            "usage.employeesUsed": 1
        };

        // Also increment type-specific counter
        if (employeeType === "sales") {
            incQuery["usage.no_of_sales_person_employeesUsed"] = 1;
        } else if (employeeType === "pro_sales") {
            incQuery["usage.no_of_pro_sales_person_employeesUsed"] = 1;
        }
        // non_sales → only total increments

        await Subscription.updateOne(
            { _id: subscription._id },
            { $inc: incQuery },
            { session }
        );

        /* =============================================
           9. COMMIT TRANSACTION
        ============================================= */
        await session.commitTransaction();

        /* =============================================
           10. PREPARE RESPONSE WITH QUOTA INFO
        ============================================= */
        // Fetch updated usage for response
        const breakdown = getEmployeeBreakdown({
            usage: {
                employeesUsed: (subscription.usage.employeesUsed || 0) + 1,
                no_of_sales_person_employeesUsed:
                    (subscription.usage.no_of_sales_person_employeesUsed || 0) +
                    (employeeType === "sales" ? 1 : 0),
                no_of_pro_sales_person_employeesUsed:
                    (subscription.usage.no_of_pro_sales_person_employeesUsed || 0) +
                    (employeeType === "pro_sales" ? 1 : 0)
            }
        });

        const updatedSubscription = {
            ...subscription.usage,
            employeesUsed: (subscription.usage.employeesUsed || 0) + 1,
            no_of_sales_person_employeesUsed:
                (subscription.usage.no_of_sales_person_employeesUsed || 0) +
                (employeeType === "sales" ? 1 : 0),
            no_of_pro_sales_person_employeesUsed:
                (subscription.usage.no_of_pro_sales_person_employeesUsed || 0) +
                (employeeType === "pro_sales" ? 1 : 0)
        };

        const salesWarning = isNearingEmployeeLimit(
            { usage: updatedSubscription },
            "sales",
            80
        );
        const proSalesWarning = isNearingEmployeeLimit(
            { usage: updatedSubscription },
            "pro_sales",
            80
        );
        const nonSalesWarning = isNearingEmployeeLimit(
            { usage: updatedSubscription },
            "non_sales",
            80
        );

        const response = {
            success: true,
            message: "Employee created successfully",
            data: {
                _id: employee._id,
                userId: employee.userId,
                empCode: employee.empCode,
                user_name: employee.user_name,
                employeeType: employee.employeeType,
                employmentStatus: employee.employmentStatus,
                createdAt: employee.createdAt
            },
            quota: {
                breakdown: {
                    total: breakdown.total,
                    sales: breakdown.sales,
                    proSales: breakdown.proSales,
                    nonSales: breakdown.nonSales
                },
                limits: {
                    sales: getEmployeeLimit({ usage: updatedSubscription }, "sales"),
                    proSales: getEmployeeLimit({ usage: updatedSubscription }, "pro_sales"),
                    nonSales: getEmployeeLimit({ usage: updatedSubscription }, "non_sales")
                },
                remaining: {
                    sales: getRemainingEmployeeSlots(
                        { usage: updatedSubscription },
                        "sales"
                    ),
                    proSales: getRemainingEmployeeSlots(
                        { usage: updatedSubscription },
                        "pro_sales"
                    ),
                    nonSales: getRemainingEmployeeSlots(
                        { usage: updatedSubscription },
                        "non_sales"
                    )
                }
            },
            warnings: []
        };

        // Add warnings if nearing limits
        if (salesWarning.isNearing) {
            response.warnings.push({
                type: "SALES_LIMIT_WARNING",
                message: `Sales employees: ${breakdown.sales}/${getEmployeeLimit(
                    { usage: updatedSubscription },
                    "sales"
                )} (${salesWarning.percentage}%)`
            });
        }

        if (proSalesWarning.isNearing) {
            response.warnings.push({
                type: "PRO_SALES_LIMIT_WARNING",
                message: `Pro Sales employees: ${breakdown.proSales}/${getEmployeeLimit(
                    { usage: updatedSubscription },
                    "pro_sales"
                )} (${proSalesWarning.percentage}%)`
            });
        }

        if (nonSalesWarning.isNearing) {
            response.warnings.push({
                type: "NON_SALES_LIMIT_WARNING",
                message: `Non-Sales employees: ${breakdown.nonSales}/${getEmployeeLimit(
                    { usage: updatedSubscription },
                    "non_sales"
                )} (${nonSalesWarning.percentage}%)`
            });
        }

        return res.status(201).json(response);

    } catch (error) {
        // Abort transaction if still active
        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        console.error("Create Employee Error:", error.message);

        // Determine status code and error type
        let statusCode = 400;
        const errorResponse = {
            success: false,
            message: error.message,
            code: "CREATE_EMPLOYEE_ERROR"
        };

        if (error.message.includes("limit reached") || error.message.includes("Limit reached")) {
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
        } else if (error.message.includes("Invalid")) {
            statusCode = 400;
            errorResponse.code = "VALIDATION_ERROR";
        } else if (error.message.includes("already exists")) {
            statusCode = 409;
            errorResponse.code = "DUPLICATE_EMPLOYEE";
        }

        return res.status(statusCode).json(errorResponse);

    } finally {
        await session.endSession();
    }
};


export const changeEmployeeRole = async (req, res) => {
    try {
        const { empId } = req.params;
        const { newRole } = req.body;
        const allowedRoles = ['employee', 'manager', 'hr', 'admin', 'super_admin', 'sales'];
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
        let companyId = req.user?._id || req.user?.id;
        const userRole = req.user?.role || req.user?.type;

        if (userRole === "user") {
            companyId = req.user?.companyId;
        }

        if (!companyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        if (!["partner", "admin", "super_admin", "user"].includes(userRole)) {
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
            employeeType,
            shift,
            weeklyOff,
            referalCode,
            officeLocation,
            employmentStatus
        } = req.body;

        const updatePayload = {};

        /* ---------------------------------------------
           4. Basic Fields
        ---------------------------------------------- */
        if (user_name !== undefined) {
            updatePayload.user_name = user_name;
        }

        if (role && ["employee", "manager", "hr", "admin", "super_admin"].includes(role)) {
            updatePayload.role = role;
        }

        /* ---------------------------------------------
           5. REFERAL CODE (🔥 FIXED)
        ---------------------------------------------- */
        if (referalCode !== undefined) {

            if (typeof referalCode !== "string" || !referalCode.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid referalCode",
                });
            }

            const normalizedCode = referalCode.trim().toUpperCase();

            // 🔥 duplicate check (company scoped)
            const duplicate = await Employee.findOne({
                companyId,
                referalCode: normalizedCode,
                _id: { $ne: employeeId }
            }).session(session);

            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: "Referral code already in use",
                });
            }

            updatePayload.referalCode = normalizedCode;
        }

        /* ---------------------------------------------
           6. SHIFT VALIDATION
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
           7. WEEKLY OFF VALIDATION
        ---------------------------------------------- */
        if (weeklyOff !== undefined) {
            if (!Array.isArray(weeklyOff)) {
                return res.status(400).json({
                    success: false,
                    message: "weeklyOff must be an array",
                });
            }

            const VALID_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

            const normalizedDays = weeklyOff.map(day => {
                return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
            });

            const invalidDays = normalizedDays.filter(day => !VALID_DAYS.includes(day));

            if (invalidDays.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid weeklyOff values: ${invalidDays.join(", ")}`,
                });
            }

            updatePayload.weeklyOff = [...new Set(normalizedDays)];
        }

        /* ---------------------------------------------
           8. Nested Objects Merge
        ---------------------------------------------- */
        if (jobInfo) {
            updatePayload.jobInfo = {
                ...existingEmployee.jobInfo?.toObject(),
                ...jobInfo
            };
        }

        if (salaryStructure) {
            updatePayload.salaryStructure = {
                ...existingEmployee.salaryStructure?.toObject(),
                ...salaryStructure
            };
        }

        if (bankDetails) {
            updatePayload.bankDetails = {
                ...existingEmployee.bankDetails?.toObject(),
                ...bankDetails
            };
        }

        /* ---------------------------------------------
           9. GEO LOCATION
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
                coordinates: officeLocation.coordinates,
                radius: officeLocation.radius || 100,
                manual: officeLocation.manual || "IND",
                locationtype: officeLocation.locationtype || "employee",
            };
        }

        /* ---------------------------------------------
           10. Employment Status
        ---------------------------------------------- */
        if (employmentStatus) {
            updatePayload.employmentStatus = employmentStatus;
        }

        if (employeeType) {
            if (!["non_sales", "sales", 'pro_sales'].includes(employeeType)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid employeeType value",
                });
            }
            updatePayload.employeeType = employeeType;
        }


        /* ---------------------------------------------
           11. Atomic Update
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
           12. Commit Transaction
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

        // Handle duplicate index error (DB level safety)
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate value (referalCode may already exist)",
            });
        }

        console.error("UpdateEmployee Error:", error);

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
                .populate("userId", "name email phone profileImage")
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

