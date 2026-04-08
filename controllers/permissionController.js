// controllers/permissionController.js

import User from "../models/userModel.js";
import Permission from "../models/Permission.js";
import PermissionLog from "../models/PermissionLog.js";
import AssingPermission from "../models/AssingPermission.js";
/**
 * Assign permission to a user
 */
export const assignPermission = async (req, res) => {
  try {
    const { userId, permissionKey, companyId } = req.body;
    const performedBy = req.user._id;
    const company = companyId || req.user.companyId; // fallback to performer's company

    if (!company) return res.status(400).json({ message: 'companyId required' });

    const perm = await Permission.findOne({ key: permissionKey });
    if (!perm) return res.status(404).json({ message: 'Permission not found' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    await AssingPermission.assignToUser(company, userId, permissionKey, performedBy);

    await PermissionLog.create({ 
      companyId: company, 
      userId, 
      permissionKey, 
      actionType: 'ASSIGNED', 
      performedBy 
    });

    const assignment = await AssingPermission.findOne({ companyId: company, userId }).populate('assignedBy', 'name email');

    res.json({ success: true, message: 'Permission assigned', assignment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Remove permission from a user
 */
export const removePermission = async (req, res) => {
  try {
    const { userId, permissionKey, companyId } = req.body;
    const performedBy = req.user._id;
    const company = companyId || req.user.companyId;

    if (!company) return res.status(400).json({ message: 'companyId required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    await AssingPermission.removeFromUser(company, userId, permissionKey);

    await PermissionLog.create({ 
      companyId: company, 
      userId, 
      permissionKey, 
      actionType: 'REMOVED', 
      performedBy 
    });

    const assignment = await AssingPermission.findOne({ companyId: company, userId });

    res.json({ success: true, message: 'Permission removed', assignment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get user permissions
 */
export const getUserPermissions = async (req, res) => {
  try {
    const { userId, companyId } = req.query;
    const company = companyId || req.user.companyId;

    if (!company) return res.status(400).json({ message: 'companyId required' });

    const assignment = await AssingPermission.findOne({ companyId: company, userId }).populate('assignedBy', 'name email');
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    res.json({ success: true, permissions: assignment.permissions, assignment });
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
    const { page = 1, limit = 50, search = '' } = req.query;
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
