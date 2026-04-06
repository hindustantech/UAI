// controllers/permissionController.js

import User from "../models/userModel.js";
import Permission from "../models/Permission.js";
import PermissionLog from "../models/PermissionLog.js";
/**
 * Assign permission to a user
 */
export const assignPermission = async (req, res) => {
  try {
    const { userId, permissionKey } = req.body;
    const performedBy = req.user._id; // admin performing this action

    const perm = await Permission.findOne({ key: permissionKey });
    if (!perm) return res.status(404).json({ message: 'Permission not found' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.permissions.includes(permissionKey)) {
      return res.status(400).json({ message: 'Permission already assigned' });
    }

    user.permissions.push(permissionKey);
    await user.save();

    await PermissionLog.create({ userId, permissionKey, actionType: 'ASSIGNED', performedBy });

    res.json({ success: true, message: 'Permission assigned', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Remove permission from a user
 */
export const removePermission = async (req, res) => {
  try {
    const { userId, permissionKey } = req.body;
    const performedBy = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.permissions.includes(permissionKey)) {
      return res.status(400).json({ message: 'Permission not assigned' });
    }

    user.permissions = user.permissions.filter(p => p !== permissionKey);
    await user.save();

    await PermissionLog.create({ userId, permissionKey, actionType: 'REMOVED', performedBy });

    res.json({ success: true, message: 'Permission removed', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get user permissions
 */
export const getUserPermissions = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ permissions: user.permissions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};







/**
 * Create a new permission
 */
export const createPermission = async (req, res) => {
  try {
    const { resource, action, name, description, system } = req.body;
    if (!resource || !action) {
      return res.status(400).json({ message: 'Resource and action are required' });
    }

    const existing = await Permission.findOne({ resource: resource.toLowerCase(), action: action.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'Permission already exists' });
    }

    const perm = new Permission({
      resource: resource.toLowerCase(),
      action: action.toLowerCase(),
      name: name || `${resource} ${action}`,
      description,
      system: !!system,
    });

    await perm.save();

    res.status(201).json({ success: true, message: 'Permission created', permission: perm });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get all permissions
 */
export const getAllPermissions = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const query = search ? { $or: [{ key: { $regex: search, $options: 'i' } }, { resource: { $regex: search, $options: 'i' } }] } : {};

    const permissions = await Permission.find(query)
      .sort({ key: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Permission.countDocuments(query);

    res.json({
      success: true,
      permissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get a single permission by ID
 */
export const getPermission = async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await Permission.findById(id);
    if (!perm) return res.status(404).json({ message: 'Permission not found' });

    res.json({ success: true, permission: perm });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Update a permission
 */
export const updatePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, system } = req.body;

    const perm = await Permission.findById(id);
    if (!perm) return res.status(404).json({ message: 'Permission not found' });

    if (name) perm.name = name;
    if (description !== undefined) perm.description = description;
    if (system !== undefined) perm.system = !!system;

    await perm.save();

    res.json({ success: true, message: 'Permission updated', permission: perm });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Delete a permission
 */
export const deletePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await Permission.findById(id);
    if (!perm) return res.status(404).json({ message: 'Permission not found' });
    if (perm.system) return res.status(403).json({ message: 'Cannot delete system permission' });

    // Remove from all users
    await User.updateMany(
      { permissions: perm.key },
      { $pull: { permissions: perm.key } }
    );

    // Optional: log removal if needed

    await perm.deleteOne();

    res.json({ success: true, message: 'Permission deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
