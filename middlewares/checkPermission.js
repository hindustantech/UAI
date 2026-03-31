import User from "../models/userModel.js";


/**
 * permissionKey: the key required to access this route
 */

export const checkPermission = (permissionKey) => {
    return async (req, res, next) => {
        try {   
            const userId = req.user.id || req.user._id; // JWT sets req.user

            if (!userId) return res.status(401).json({ message: 'Unauthorized' });

            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ message: 'User not found' });

            // Super admin bypass: always has access
            if (user.type === 'super_admin') return next();

            // Check assigned permission
            if (!user.permissions.includes(permissionKey)) {
                return res.status(403).json({ message: 'Forbidden: Permission denied' });
            }

            next();
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    };
};
