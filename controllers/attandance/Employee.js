import User from "../../models/userModel.js";
import Employee from "../../models/Attandance/Employee.js";
import Attendance from "../../models/Attandance/Attendance.js";
import Holiday from "../../models/Attandance/Holiday.js";
import Payroll from "../../models/Attandance/Payroll.js";
import mongoose from "mongoose";
import PatnerProfile from "../../models/PatnerProfile.js";
import Shift from "../../models/Attandance/Shift.js";


// controllers/companyController.js

export const getCompanyByUser = async (req, res) => {
    try {
        const { userType } = req.params; // or from req.body
        const userId = req.user?._id || req.user?.id;

        // Validate input
        if (!userId || !userType) {
            return res.status(400).json({
                success: false,
                message: 'userId and userType are required'
            });
        }

        let companyDetails = null;

        // CASE 1: User is PARTNER - directly get their company profile
        if (userType === 'partner' || userType === 'admin' || userType === 'super_admin') {
            const partnerProfile = await PatnerProfile.findOne({ User_id: userId })
                .select('firm_name logo email address isIndependent')
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

        // CASE 2: User is EMPLOYEE - find company they're associated with
        else if (userType === 'user') {
            const employee = await Employee.findOne({ userId: userId })
                .populate({
                    path: 'companyId',
                    select: 'name email' // Get admin user info
                })
                .lean();

            if (employee && employee.companyId) {
                // Get company details from partner profile
                const partnerProfile = await PatnerProfile.findOne({
                    User_id: employee.companyId._id
                })
                    .select('firm_name logo email address isIndependent')
                    .lean();

                if (partnerProfile) {
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
            }
        }

        // If no company found
        if (!companyDetails) {
            return res.status(404).json({
                success: false,
                message: `No company found for this ${userType}`
            });
        }

        // Return success response
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
export const createEmployee = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        /* ---------------------------------------------
           1. Authorization
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
           2. Validation
        ---------------------------------------------- */
        const {
            userId,
            role,
            empCode,
            user_name,
            jobInfo,
            shift,
            weeklyOff,
            salaryStructure,
            bankDetails,
            officeLocation,
        } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required",
            });
        }

        /* ---------------------------------------------
           3. Check User Exists
        ---------------------------------------------- */
        const user = await User.findById(userId).session(session);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const sh = await Shift.findById(shift)
        if (!sh) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }
        /* ---------------------------------------------
           4. Prevent Duplicate Employee
        ---------------------------------------------- */
        const alreadyExists = await Employee.findOne({
            companyId,
            userId,
        }).session(session);

        if (alreadyExists) {
            return res.status(409).json({
                success: false,
                message: "Employee already exists",
            });
        }



        /* ---------------------------------------------
           6. Build Employee Object
        ---------------------------------------------- */
        const employeePayload = {
            companyId,
            userId,
            weeklyOff,
            empCode,
            user_name,
            role: role || "employee",
            shift,
            jobInfo: {
                designation: jobInfo?.designation,
                department: jobInfo?.department,
                joiningDate: jobInfo?.joiningDate || new Date(),
                reportingManager: jobInfo?.reportingManager,
            },

            salaryStructure: {
                basic: salaryStructure?.basic || 0,
                hra: salaryStructure?.hra || 0,
                da: salaryStructure?.da || 0,
                bonus: salaryStructure?.bonus || 0,
                perDay: salaryStructure?.perDay || 0,
                perHour: salaryStructure?.perHour || 0,
                overtimeRate: salaryStructure?.overtimeRate || 0,
            },

            bankDetails: {
                accountNo: bankDetails?.accountNo,
                ifsc: bankDetails?.ifsc,
                bankName: bankDetails?.bankName,
            },

            officeLocation: officeLocation
                ? {
                    type: "Point",
                    coordinates: officeLocation.coordinates,
                    radius: officeLocation.radius || 100,
                    manual: officeLocation.manual,
                    locationtype: officeLocation.locationtype,

                }
                : undefined,

            employmentStatus: "active",
        };

        /* ---------------------------------------------
           7. Save Employee
        ---------------------------------------------- */
        const employee = await Employee.create(
            [employeePayload],
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
            data: employee[0],
        });
    } catch (error) {
        /* ---------------------------------------------
           Rollback
        ---------------------------------------------- */
        await session.abortTransaction();
        session.endSession();

        console.error("CreateEmployee Error:", error);

        /* ---------------------------------------------
           Duplicate Key Handling
        ---------------------------------------------- */
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate employee detected",
            });
        }

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
                coordinates: officeLocation.coordinates||existingEmployee.officeLocation?.coordinates,
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

