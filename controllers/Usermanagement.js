// controllers/userController.js
import User from '../models/userModel.js';
import bcrypt from 'bcryptjs'; // Assume bcryptjs is installed for password hashing
import json2csv from 'json2csv'
import mongoose from 'mongoose';

// Helper function for paginatiozn and filtering
const getUserQuery = (search, role, isAgency) => {
  const query = {};
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }
  if (role) {
    query.type = role;
  }
  if (isAgency === 'true') {
    query.type = 'agency';
  }
  return query;
};

// GET /api/users - Fetch all users with pagination, search, filters
export const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const role = req.query.role || '';
    const isAgency = req.query.agency || '';

    const query = getUserQuery(search, role, isAgency);

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -otp') // Exclude sensitive fields
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages,
          total,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      },
      message: 'Users fetched successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

// GET /api/users/export - Export users to CSV
export const exportUsers = async (req, res) => {
  try {
    const search = req.query.search || '';
    const role = req.query.role || '';
    const isAgency = req.query.agency || '';

    const query = getUserQuery(search, role, isAgency);

    const users = await User.find(query)
      .select('-password -otp') // Exclude sensitive fields
      .lean();

    // Prepare data for CSV, excluding sensitive fields
    const csvData = users.map(user => ({
      UID: user.uid,
      Name: user.name,
      Email: user.email,
      Phone: user.phone,
      Type: user.type,
      IsVerified: user.isVerified,
      Suspended: user.suspend,
      ReferralCode: user.referalCode,
      ReferredBy: user.referredBy,
      CreatedAt: user.createdAt
    }));

    let csv;
    try {
      csv = json2csv.parse(csvData);
    } catch (err) {
      // Fallback manual CSV generation if library fails
      const headers = Object.keys(csvData[0]).join(',');
      const rows = csvData.map(row => Object.values(row).join(',')).join('\n');
      csv = `${headers}\n${rows}`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

// GET /api/users/analytics - User analytics
export const getUserAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Use aggregation for efficient counting
    const [totalUsers, activeUsers, newThisMonth, blockedUsers] = await Promise.all([
      User.countDocuments({}), // Total users
      User.countDocuments({ isVerified: true, suspend: false }), // Active: verified and not suspended
      User.countDocuments({ createdAt: { $gte: startOfMonth } }), // New this month
      User.countDocuments({ suspend: true }) // Blocked: suspended
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        newThisMonth,
        blockedUsers
      },
      message: 'Analytics fetched successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

// GET /api/users/:id - View user profile
export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id)
      .select('-password -otp') // Exclude sensitive fields
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user,
      message: 'Profile fetched successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

// PUT /api/users/:id/role - Change user role
// PUT /api/users/:id/role - Change user role
export const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Validate role against schema enum
    if (!['user', 'partner', 'agency', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid role. Must be: user, partner, agency, admin, or super_admin'
      });
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { type: role }, // Schema uses 'type', not 'role'
      {
        new: true,
        runValidators: true,
        context: 'query' // Ensures validators run on update
      }
    ).select('-password -otp');

    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user,
      message: `User role updated to ${role} successfully`
    });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

// PUT /api/users/:id/block - Block/unblock user (toggle suspend)
export const toggleUserBlock = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { suspend: !user.suspend },
      {
        new: true,
        runValidators: true
      }
    ).select('-password -otp');

    const action = updatedUser.suspend ? 'blocked' : 'unblocked';

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: `User ${action} successfully`
    });
  } catch (error) {
    console.error('Toggle block error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

// POST /api/users - Add new user
// POST /api/users - Add new user
export const createUser = async (req, res) => {
  try {
    const { name, email, password, phone, type = 'user', isVerified = true } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Name, email, and password are required'
      });
    }

    // Validate role type
    if (!['user', 'partner', 'agency', 'admin', 'super_admin'].includes(type)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user type'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        ...(phone ? [{ phone: phone.trim() }] : [])
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'User with this email or phone already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      phone: phone ? phone.trim() : undefined,
      type,
      isVerified: Boolean(isVerified) // ✅ Configurable verification status
    });

    const savedUser = await newUser.save();

    // Exclude sensitive fields in response
    const userResponse = savedUser.toObject();
    delete userResponse.password;
    delete userResponse.otp;

    res.status(201).json({
      success: true,
      data: userResponse,
      message: `User created successfully ${isVerified ? '(Verified)' : '(Pending Verification)'}`
    });
  } catch (error) {
    console.error('Create user error:', error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        data: null,
        message: `User with this ${field} already exists`
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        data: null,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      data: null,
      message: 'Internal server error'
    });
  }
};
 