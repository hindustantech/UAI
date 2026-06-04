import User from "../models/userModel.js";
import Employee from "../models/Attandance/Employee.js";
import AssingPermission from "../models/AssingPermission.js";

/**
 * permissionKey: the key required to access this route
 */
export const checkPermission = (permissionKey) => {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id || req.user?._id;
            const companyId = req.user.companyId || req.user.companyId;

            if (!userId) {
                return res.status(401).json({ message: 'Unauthorized' });
            }


            const user = await User.findById(userId)
                .select('type permissions');

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // 🔹 Global bypass
            if (['super_admin', 'partner'].includes(user.type)) {
                return next();
            }

            if (!companyId) {
                return res.status(400).json({ message: 'CompanyId required' });
            }

            // 🔹 Tenant check
            const employee = await Employee.findOne({
                userId: user._id,
                companyId
            }).select('role');

            if (!employee) {
                return res.status(403).json({
                    message: 'Access denied: not part of company'
                });
            }

            // 🔹 Role hierarchy
            if (['super_admin', 'admin'].includes(employee.role)) {
                return next();
            }

            // 🔹 Direct permission from AssingPermission
            const assignment = await AssingPermission.findOne({ 
                companyId, 
                userId: user._id 
            });
            if (assignment && assignment.permissions.includes(permissionKey)) {
                return next();
            }

            return res.status(403).json({
                message: 'Forbidden: insufficient permissions'
            });

        } catch (err) {
            return res.status(500).json({ message: err.message });
        }
    };
};