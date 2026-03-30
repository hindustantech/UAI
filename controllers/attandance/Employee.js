import User from "../../models/userModel.js";
import Employee from "../../models/Attandance/Employee.js";
import Attendance from "../../models/Attandance/Attendance.js";
import Holiday from "../../models/Attandance/Holiday.js";
import Payroll from "../../models/Attandance/Payroll.js";
import mongoose from "mongoose";
import PatnerProfile from "../../models/PatnerProfile.js";
import Shift from "../../models/Attandance/Shift.js";
import { getActiveSubscription } from "../../services/subscription.service.js";
import { hasFeatureAccess } from "../../services/featureAccess.service.js";
import { Subscription } from "../../models/Attandance/subscration/Subscription.js";
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

            const companyUserId = employee.companyId?._id || employee.companyId;

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

// ?   CREATE EMPLOYEE (ENTERPRISE LEVEL)
// ---------------------------------------------- */
// export const createEmployee = async (req, res) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//         /* ---------------------------------------------
//            1. Authorization
//         ---------------------------------------------- */
//         const companyId = req.user?._id || req.user?.id;
//         const userRole = req.user?.role || req.user?.type;

//         if (!companyId) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Unauthorized",
//             });
//         }

//         if (!['partner', 'admin', 'super_admin'].includes(userRole)) {
//             return res.status(403).json({
//                 success: false,
//                 message: "Access denied",
//             });
//         }

//         /* ---------------------------------------------
//            2. Validation
//         ---------------------------------------------- */
//         const {
//             userId,
//             role,
//             empCode,
//             user_name,
//             jobInfo,
//             shift,
//             weeklyOff,
//             salaryStructure,
//             bankDetails,
//             officeLocation,
//         } = req.body;

//         if (!userId) {
//             return res.status(400).json({
//                 success: false,
//                 message: "userId is required",
//             });
//         }

//         /* ---------------------------------------------
//            3. Check User Exists
//         ---------------------------------------------- */
//         const user = await User.findById(userId).session(session);

//         if (!user) {
//             return res.status(404).json({
//                 success: false,
//                 message: "User not found",
//             });
//         }

//         const sh = await Shift.findById(shift)
//         if (!sh) {
//             return res.status(404).json({
//                 success: false,
//                 message: "User not found",
//             });
//         }
//         /* ---------------------------------------------
//            4. Prevent Duplicate Employee
//         ---------------------------------------------- */
//         const alreadyExists = await Employee.findOne({
//             companyId,
//             userId,
//         }).session(session);

//         if (alreadyExists) {
//             return res.status(409).json({
//                 success: false,
//                 message: "Employee already exists",
//             });
//         }



//         /* ---------------------------------------------
//            6. Build Employee Object
//         ---------------------------------------------- */
//         const employeePayload = {
//             companyId,
//             userId,
//             weeklyOff,
//             empCode,
//             user_name,
//             role: role || "employee",
//             shift,
//             jobInfo: {
//                 designation: jobInfo?.designation,
//                 department: jobInfo?.department,
//                 joiningDate: jobInfo?.joiningDate || new Date(),
//                 reportingManager: jobInfo?.reportingManager,
//             },

//             salaryStructure: {
//                 basic: salaryStructure?.basic || 0,
//                 hra: salaryStructure?.hra || 0,
//                 da: salaryStructure?.da || 0,
//                 bonus: salaryStructure?.bonus || 0,
//                 perDay: salaryStructure?.perDay || 0,
//                 perHour: salaryStructure?.perHour || 0,
//                 overtimeRate: salaryStructure?.overtimeRate || 0,
//             },

//             bankDetails: {
//                 accountNo: bankDetails?.accountNo,
//                 ifsc: bankDetails?.ifsc,
//                 bankName: bankDetails?.bankName,
//             },

//             officeLocation: officeLocation
//                 ? {
//                     type: "Point",
//                     coordinates: officeLocation.coordinates,
//                     radius: officeLocation.radius || 100,
//                     manual: officeLocation.manual,
//                     locationtype: officeLocation.locationtype,

//                 }
//                 : undefined,

//             employmentStatus: "active",
//         };

//         /* ---------------------------------------------
//            7. Save Employee
//         ---------------------------------------------- */
//         const employee = await Employee.create(
//             [employeePayload],
//             { session }
//         );

//         /* ---------------------------------------------
//            8. Commit Transaction
//         ---------------------------------------------- */
//         await session.commitTransaction();
//         session.endSession();

//         return res.status(201).json({
//             success: true,
//             message: "Employee created successfully",
//             data: employee[0],
//         });
//     } catch (error) {
//         /* ---------------------------------------------
//            Rollback
//         ---------------------------------------------- */
//         await session.abortTransaction();
//         session.endSession();

//         console.error("CreateEmployee Error:", error);

//         /* ---------------------------------------------
//            Duplicate Key Handling
//         ---------------------------------------------- */
//         if (error.code === 11000) {
//             return res.status(409).json({
//                 success: false,
//                 message: "Duplicate employee detected",
//             });
//         }

//         return res.status(500).json({
//             success: false,
//             message: "Internal server error",
//             error: error.message,
//         });
//     }
// };


// controllers/employee.controller.js


export const createEmployee = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        /* ---------------------------------------------
           1. Auth & Role Validation
        ---------------------------------------------- */
        const companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;

        if (!companyId) throw new Error("Unauthorized");

        const allowedRoles = ["partner", "admin", "super_admin"];
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
           5. Subscription Validation (SOURCE OF TRUTH)
        ---------------------------------------------- */
        const subscription = await getActiveSubscription(companyId, session);
        if (!subscription) throw new Error("No active subscription");

        const limitFeature = hasFeatureAccess(subscription, "MAXEMPLOYEES");
        if (!limitFeature) {
            throw new Error("Employee feature not available in your plan");
        }

        const limit = limitFeature.value;

        // ✅ REAL COUNT CHECK (CRITICAL FIX)
        if (limit !== -1) {
            const employeeCount = await Employee.countDocuments({
                companyId,
                employmentStatus: "active"
            }).session(session);

            if (employeeCount >= limit) {
                throw new Error("Employee limit reached. Upgrade your plan.");
            }
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
           7. Usage Tracking (Optional - Analytics Only)
        ---------------------------------------------- */
        await Subscription.updateOne(
            { _id: subscription._id },
            { $inc: { "usage.employeesUsed": 1 } },
            { session }
        );

        /* ---------------------------------------------
           8. Commit Transaction
        ---------------------------------------------- */
        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
            success: true,
            message: "Employee created successfully",
            data: employee
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        return res.status(400).json({
            success: false,
            message: error.message
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
        const companyId = req.user?._id || req.user?.id;
        const userRole = req.user?.role || req.user?.type;

        if (!companyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        if (!['partner', 'admin', 'super_admin'].includes(userRole)) {
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
        const companyId = req.user?._id;

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

export const delteEmployee = async (req, res) => {
    const { empId } = req.params;
    try {
        const employee = await Employee.findByIdAndDelete(empId);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Employee deleted successfully",
            data: employee
        })
    }
    catch (error) {
        console.error("deleteEmployee Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
}

