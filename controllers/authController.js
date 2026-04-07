import bcrypt from 'bcryptjs';
import User from '../models/userModel.js';
import { generateToken } from '../config/jwt.js';
import { sendWhatsAppOtp, verifyWhatsAppOtp } from '../utils/whatapp.js';
import { generateReferralCode } from '../utils/Referalcode.js';
import fs from 'fs';
import path from 'path';
import { uploadToCloudinary } from '../utils/Cloudinary.js';
import admin from '../utils/firebaseadmin.js';
import mongoose from "mongoose";
import logger from '../utils/logger.js';
import PatnerProfile from '../models/PatnerProfile.js';
import Employee from '../models/Attandance/Employee.js';
import jwt from 'jsonwebtoken';
import QRCode from "qrcode";

import { Parser } from 'json2csv';
const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_key"; // keep this secret in env




export const generateTheQRCode = async (req, res) => {
  try {
    // const { userId } = req.query;
    const userId = req.user._id

    const user = await User.findById(userId);
    if (!user || user.type !== "partner") {
      return res.status(404).json({
        success: false,
        message: "User not found or not a partner"
      });
    }

    // Generate a JWT token that expires in 10 minutes
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      // { expiresIn: "10m" } // 10 minutes
    );

    // Generate QR code from the token
    const qrCodeUrl = await QRCode.toDataURL(token);

    return res.status(200).json({
      success: true,
      message: "QR Code generated successfully",
      data: { qrCodeUrl }
    });

  } catch (error) {
    console.error("Error generating QR code:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating QR code",
      error: error.message
    });
  }
};




export const updateProfileMedia = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const authUserId = req.user.id || req.user._id;
    const targetUserId = req.query.Id;

    if (!targetUserId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "Image file is required"
      });
    }

    // ==============================
    // STEP 1: Upload Media
    // ==============================
    const uploadResult = await uploadToCloudinary(
      req.file.buffer,
      "profile/media"
    );

    const mediaUrl = uploadResult.secure_url;

    // ==============================
    // STEP 2: Start Transaction
    // ==============================
    session.startTransaction();

    // ==============================
    // STEP 3: Update User Profile
    // ==============================
    const updatedUser = await User.findByIdAndUpdate(
      targetUserId,
      { profileImage: mediaUrl },
      { new: true, session }
    ).select("-password -otp");

    if (!updatedUser) {
      throw new Error("User not found");
    }

    // ==============================
    // STEP 4: Update Partner Profile (if exists)
    // ==============================
    const partner = await PartnerProfile.findOne({
      User_id: targetUserId
    }).session(session);

    let partnerResponse = null;

    if (partner) {
      partner.logo = mediaUrl;

      // Defensive nested object creation
      if (!partner.detilsmall) {
        partner.detilsmall = {};
      }

      if (!Array.isArray(partner.detilsmall.mallImage)) {
        partner.detilsmall.mallImage = [];
      }

      // Prevent duplicate insertion
      if (!partner.detilsmall.mallImage.includes(mediaUrl)) {
        partner.detilsmall.mallImage.push(mediaUrl);
      }

      await partner.save({ session });

      partnerResponse = {
        logo: partner.logo,
        mallImages: partner.detilsmall.mallImage
      };
    }

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Profile media updated successfully",
      data: {
        userProfileImage: updatedUser.profileImage,
        partner: partnerResponse
      }
    });

  } catch (error) {
    await session.abortTransaction();

    return res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {
    session.endSession();
  }
};
/* -------------------------------
   Distance Calculator (KM)
-------------------------------- */
const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/* -------------------------------
   Export Users (JSON → CSV)
-------------------------------- */

/* -------------------------------
   Export Users By Location
-------------------------------- */
export const exportUsersByLocation = async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude & Longitude required",
      });
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusKm = Number(radius);

    if (
      isNaN(latitude) ||
      isNaN(longitude) ||
      isNaN(radiusKm)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates",
      });
    }

    /* Convert to meters */
    const maxDistance = radiusKm * 1000;

    /* ---------------- GEO QUERY ---------------- */

    const users = await User.find({
      latestLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: maxDistance,
        },
      },
    })
      .select("uid name phone email type latestLocation createdAt")
      .lean();

    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: "No users found in this radius",
      });
    }

    /* ---------------- Prepare Export Data ---------------- */

    const exportRows = users.map((u) => {
      const [lng2, lat2] = u.latestLocation.coordinates;

      const distance = getDistanceKm(
        latitude,
        longitude,
        lat2,
        lng2
      );

      return {
        UID: u.uid,
        Name: u.name || "",
        Phone: u.phone || "",
        Email: u.email || "",
        Type: u.type,
        Latitude: lat2,
        Longitude: lng2,
        DistanceKM: Number(distance.toFixed(2)),
        CreatedAt: u.createdAt,
      };
    });

    /* ---------------- JSON → CSV ---------------- */

    const fields = [
      "UID",
      "Name",
      "Phone",
      "Email",
      "Type",
      "Latitude",
      "Longitude",
      "DistanceKM",
      "CreatedAt",
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(exportRows);

    /* ---------------- Save File ---------------- */

    const exportDir = path.join(process.cwd(), "exports");

    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `user_export_${Date.now()}.csv`;
    const filePath = path.join(exportDir, fileName);

    fs.writeFileSync(filePath, csv, "utf8");

    /* ---------------- Stats ---------------- */

    const distances = exportRows.map(
      (r) => r.DistanceKM
    );

    /* ---------------- Response ---------------- */

    return res.status(200).json({
      success: true,

      totalUsers: exportRows.length,

      searchRadius: `${radiusKm} KM`,

      minDistanceKm: Math.min(...distances),
      maxDistanceKm: Math.max(...distances),

      avgDistanceKm: Number(
        (
          distances.reduce((a, b) => a + b, 0) /
          distances.length
        ).toFixed(2)
      ),

      file: fileName,

      downloadUrl: `/exports/${fileName}`,

      preview: exportRows.slice(0, 20),
    });
  } catch (error) {
    console.error("Export Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
// Controller function to get user IDs and names by referral codes
// Controller
export const getUserIdsAndNamesByReferralCodesController = async (req, res) => {
  try {
    const { referralCodes } = req.query; // use query params for GET

    if (!referralCodes) {
      return res.status(400).json({ success: false, message: 'No referral codes provided' });
    }

    // Ensure it's an array
    // If only one code is sent, it will be a string
    const codesArray = Array.isArray(referralCodes) ? referralCodes : referralCodes.split(',');

    // Query users with the given referral codes
    const users = await User.find({ referalCode: { $in: codesArray } }, '_id name referalCode');

    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'No users found for these referral codes' });
    }

    // Map referral codes to user info
    const result = users.map(user => ({
      userId: user._id.toString(),
      name: user.name,
      referralCode: user.referalCode
    }));

    res.status(200).json({ success: true, users: result });

  } catch (error) {

    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteUser = async (req, res) => {
  try {
    /* ===============================
       1. Authentication Check
    =============================== */
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    /* ===============================
       2. Authorization (Super Admin)
    =============================== */
    if (req.user.type !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Super admin only."
      });
    }

    /* ===============================
       3. Validate Target User ID
    =============================== */
    const { targetUserId } = req.body;

    if (!mongoose.isValidObjectId(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id"
      });
    }

    /* ===============================
       4. Prevent Self Deletion
    =============================== */
    if (req.user.id === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Super admin cannot delete self"
      });
    }

    /* ===============================
       5. Fetch Target User
    =============================== */
    const user = await User.findByIdAndDelete(targetUserId);









    return res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });

  } catch (error) {
    console.error("DELETE_USER_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};



export const restoreAccount = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const userId = req.user?._id;

    /* ---------- Validation ---------- */
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid user id"
      });
    }

    /* ---------- Fetch User ---------- */
    const user = await User.findById(userId).session(session);

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    /* ---------- State Machine Guard ---------- */
    if (user.accountStatus !== "PENDING_DELETION") {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Account is not scheduled for deletion"
      });
    }

    /* ---------- Expiry Check (Safety) ---------- */
    if (user.scheduledDeletionAt && user.scheduledDeletionAt <= new Date()) {
      await session.abortTransaction();
      return res.status(410).json({
        success: false,
        message: "Restoration window expired. Account already queued for permanent deletion."
      });
    }

    /* ---------- Restore ---------- */
    user.accountStatus = "ACTIVE";
    user.deletionRequestedAt = null;
    user.scheduledDeletionAt = null;
    user.suspend = false;
    user.suspendedAt = null;
    user.deletedAt = null;

    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Account restored successfully"
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Restore Account Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to restore account",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

export const requestAccountDeletion = async (req, res) => {
  try {
    const userId = req.user._id;

    const deleteAfterDays = 365;
    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + deleteAfterDays);

    await User.findByIdAndUpdate(userId, {
      accountStatus: "PENDING_DELETION",
      deletionRequestedAt: new Date(),
      scheduledDeletionAt: scheduledDate,
      suspendedAt: new Date()
    });

    return res.json({
      success: true,
      message: `Your account is scheduled for permanent deletion on ${scheduledDate.toDateString()}. You can restore before this date.`
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



export const getDeletionStatus = async (req, res) => {
  try {
    const userId = req.user?._id;

    /* ---------- Validate ---------- */
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id"
      });
    }

    /* ---------- Fetch Minimal Fields ---------- */
    const user = await User.findById(userId)
      .select("accountStatus scheduledDeletionAt deletionRequestedAt")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    /* ---------- Default Response ---------- */
    let response = {
      success: true,
      accountStatus: user.accountStatus,
      scheduledDeletionAt: null,
      daysRemaining: null,
      message: null
    };

    /* ---------- If Scheduled for Deletion ---------- */
    if (user.accountStatus === "PENDING_DELETION" && user.scheduledDeletionAt) {

      const now = new Date();
      const diffTime = user.scheduledDeletionAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      response.scheduledDeletionAt = user.scheduledDeletionAt;
      response.daysRemaining = daysRemaining > 0 ? daysRemaining : 0;

      response.message =
        daysRemaining > 0
          ? `Your account is scheduled for permanent deletion in ${daysRemaining} days. You can restore your account before this date.`
          : "Your account is queued for permanent deletion and can no longer be restored.";
    }

    /* ---------- If Suspended ---------- */
    if (user.accountStatus === "SUSPENDED") {
      response.message =
        "Your account has been suspended. Please contact support for assistance.";
    }

    /* ---------- If Active ---------- */
    if (user.accountStatus === "ACTIVE") {
      response.message = "Your account is active.";
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error("Get Deletion Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch account status"
    });
  }
};



export const getUserProfile = async (req, res) => {
  try {
    /* -------------------- AUTH VALIDATION -------------------- */
    if (!req.user || (!req.user.id && !req.user._id)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: user context missing",
      });
    }


    const userId = req.user.id || req.user._id;
    console.log("userId", userId)
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    /* -------------------- DB QUERY -------------------- */
    const user = await User.findById(userId).select(
      "name email phone type permissions isVerified suspend createdAt"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.suspend) {
      return res.status(403).json({
        success: false,
        message: "Account suspended",
      });
    }

    /* -------------------- RESPONSE -------------------- */
    return res.status(200).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone ?? null,
        role: user.type,
        permissions: user.permissions ?? [],
        isVerified: user.isVerified,
        joinedAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("getUserProfile::ERROR", {
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};






/**
 * @desc    Get Profile (User + Employee)
 * @route   GET /api/profile
 * @access  Private
 */
export const getProfile = async (req, res) => {
  const requestId = new mongoose.Types.ObjectId().toString(); // trace id

  try {
    /* ---------------------------------------------
       1. AUTH CONTEXT
    ---------------------------------------------- */
    const userId = req.user?._id || req.user?.id;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        requestId,
        message: "Invalid or missing user ID"
      });
    }

    /* ---------------------------------------------
       2. TIMEOUT WRAPPER (FAIL FAST STRATEGY)
    ---------------------------------------------- */
    const timeout = (promise, ms = 5000) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), ms)
        )
      ]);
    };

    /* ---------------------------------------------
       3. PARALLEL FETCH (OPTIMIZED)
    ---------------------------------------------- */
    const userQuery = User.findById(userId)
      .select("name phone email profileImage couponCount type referalCode referredBy")
      .lean();

    const employeeQuery = Employee.findOne({ userId })
      .select(`
        empCode role weeklyOff employmentStatus
        jobInfo salaryStructure bankDetails officeLocation shift
      `)
      .populate({
        path: "jobInfo.reportingManager",
        select: "name email",
        options: { lean: true }
      })
      .populate({
        path: "shift",
        select: "name startTime endTime",
        options: { lean: true }
      })
      .lean();

    const [user, employee] = await timeout(
      Promise.all([userQuery, employeeQuery]),
      7000
    );

    /* ---------------------------------------------
       4. VALIDATION
    ---------------------------------------------- */
    if (!user) {
      return res.status(404).json({
        success: false,
        requestId,
        message: "User not found"
      });
    }

    /* ---------------------------------------------
       5. SAFE RESPONSE MAPPING (DEFENSIVE DESIGN)
    ---------------------------------------------- */
    const response = {
      user: {
        id: user._id,
        name: user.name || null,
        phone: user.phone || null,
        email: user.email || null,
        profileImage: user.profileImage || null,
        couponCount: user.couponCount || 0,
        type: user.type || null,
        referalCode: user.referalCode || null,
        referredBy: user.referredBy || null
      },
      employee: employee
        ? {
          empCode: employee.empCode || null,
          role: employee.role || null,
          weeklyOff: employee.weeklyOff || [],
          employmentStatus: employee.employmentStatus || null,

          jobInfo: {
            ...employee.jobInfo,
            reportingManager:
              employee.jobInfo?.reportingManager || null
          },

          salaryStructure: employee.salaryStructure || {},
          bankDetails: employee.bankDetails || {},
          officeLocation: employee.officeLocation || null,
          shift: employee.shift || null
        }
        : null
    };

    /* ---------------------------------------------
       6. SUCCESS RESPONSE
    ---------------------------------------------- */
    return res.status(200).json({
      success: true,
      requestId,
      message: "Profile fetched successfully",
      data: response
    });

  } catch (error) {
    /* ---------------------------------------------
       7. ERROR HANDLING (OBSERVABILITY)
    ---------------------------------------------- */
    console.error("GET_PROFILE_ERROR:", {
      requestId,
      error: error.message,
      stack: error.stack
    });

    // Specific error handling
    if (error.message === "DB_TIMEOUT") {
      return res.status(503).json({
        success: false,
        requestId,
        message: "Database timeout. Please try again."
      });
    }

    return res.status(500).json({
      success: false,
      requestId,
      message: "Internal Server Error"
    });
  }
};

export const updateProfileImage = async (req, res) => {
  try {
    const userId = req.user?.id; // from auth middleware
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: "No image file uploaded" });
    }

    // Upload image to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'profile_images');

    // Update user's profileImage
    const user = await User.findByIdAndUpdate(
      userId,
      { profileImage: result.secure_url },
      { new: true, select: 'name phone profileImage couponCount type referalCode referredBy' }
    ).lean();

    res.status(200).json({ success: true, message: "Profile image updated", data: user });
  } catch (error) {

    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const broadcastNotification = async (req, res) => {

  const userId = req.user?.id; // from auth middleware
  const startTime = Date.now();
  let processedCount = 0;

  try {
    // Input validation
    const { address, title, body, data = {}, delay = 50, concurrency = 5, type = 'location' } = req.body;

    if (!address || !title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Address, title, and body are required fields',
      });
    }

    // Validate input types
    if (typeof title !== 'string' || typeof body !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Title and body must be strings',
      });
    }

    if (delay < 0 || !Number.isInteger(delay)) {
      return res.status(400).json({
        success: false,
        message: 'Delay must be a non-negative integer',
      });
    }

    if (concurrency < 1 || !Number.isInteger(concurrency)) {
      return res.status(400).json({
        success: false,
        message: 'Concurrency must be a positive integer',
      });
    }



    // Construct query based on address type
    const query = Array.isArray(address)
      ? {
        manul_address: { $in: address },
        devicetoken: { $exists: true, $nin: ["", null] },
      }
      : {
        manul_address: address,
        devicetoken: { $exists: true, $nin: ["", null] },
      };

    // Fetch users
    const users = await User.find(query, {
      uid: 1,
      name: 1,
      devicetoken: 1,
      manul_address: 1,
    }).lean();


    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: `No users found for address: ${Array.isArray(address) ? address.join(', ') : address}`,
      });
    }



    const results = {
      totalSuccess: 0,
      totalFailures: 0,
      invalidTokens: [],
      detailedResults: [],
    };

    // Process notifications in batches
    for (let i = 0; i < users.length; i += concurrency) {
      const batch = users.slice(i, i + concurrency);
      processedCount += batch.length;

      const batchPromises = batch.map((user) =>
        sendSingleNotification(user, title, body, data)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          const notificationResult = result.value;
          results.detailedResults.push(notificationResult);

          if (notificationResult.success) {
            results.totalSuccess++;
          } else {
            results.totalFailures++;
            if (notificationResult.shouldCleanup) {
              results.invalidTokens.push({
                uid: notificationResult.user.uid,
                _id: notificationResult.user._id,
                token: notificationResult.user.devicetoken,
                error: notificationResult.error,
              });
            }
          }
        } else {
          results.totalFailures++;
          results.detailedResults.push({
            success: false,
            error: result.reason?.message || 'Unknown error in batch processing',
          });
        }
      });

      // Log progress
      const progress = ((processedCount / users.length) * 100).toFixed(1);


      // Delay between batches
      if (delay > 0 && i + concurrency < users.length) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Cleanup invalid tokens
    if (results.invalidTokens.length > 0) {
      await cleanupInvalidTokensBulk(results.invalidTokens);

    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);



    return res.status(200).json({
      success: true,
      message: `Notifications sent successfully in ${duration}s`,
      data: {
        ...results,
        totalUsers: users.length,
        duration: `${duration}s`,
        successRate: `${((results.totalSuccess / users.length) * 100).toFixed(1)}%`,
        notificationId: newNotification._id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: error.message,
    });
  }
};

// Helper function for single notification
const sendSingleNotification = async (user, title, body, data) => {
  try {
    if (!user.devicetoken) {
      return {
        user,
        success: false,
        error: 'No device token found for user',
        shouldCleanup: false,
      };
    }

    const message = {
      token: user.devicetoken,
      notification: { title, body },
      data: data || {},
    };

    const response = await admin.messaging().send(message);

    return {
      user,
      success: true,
      messageId: response,
      shouldCleanup: false,
    };
  } catch (error) {
    const shouldCleanup = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
    ].includes(error.code);

    return {
      user,
      success: false,
      error: error.message,
      errorCode: error.code,
      shouldCleanup,
    };
  }
};

// Helper function to clean up invalid tokens
const cleanupInvalidTokensBulk = async (invalidTokens) => {
  try {
    const userIds = invalidTokens.map((token) => token._id);
    await User.updateMany(
      { _id: { $in: userIds } },
      { $set: { devicetoken: null } }
    );
  } catch (error) {
    throw error;
  }
};


export const findUserByPhone = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const user = await User.findOne({ phone }).select("_id name");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error finding user by phone",
      error: error.message,
    });
  }
};

export const updateUserLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and Longitude are required",
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        latestLocation: {
          type: "Point",
          coordinates: [parseFloat(lng), parseFloat(lat)],
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User location updated successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating location",
      error: error.message,
    });
  }
};




export const UpdateManualAddress = async (req, res) => {
  try {
    const { manul_address } = req.body;
    const userId = req?.user?.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId, // the user to update
      { manul_address }, // update this field
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Manual address updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


export const generateUniqueReferralCode = async () => {
  let code;
  let exists = true;
  let attempts = 0;

  while (exists && attempts < 5) {
    code = "IND" + Math.floor(100 + Math.random() * 900);

    exists = await User.exists({
      referalCode: code,
    });

    attempts++;
  }

  if (exists) {
    throw new Error("Referral code generation failed");
  }

  return code;
};


export const startAuth = async (req, res) => {
  try {
    const { phone, deviceId, type, referralCode } = req.body;

    /* ---------- Validation ---------- */

    if (!phone || !type) {
      return res.status(400).json({
        message: "phone, deviceId and type required",
      });
    }

    const allowed = ["user", "partner", "agency", 'admin', 'super_admin'];

    if (!allowed.includes(type)) {
      return res.status(401).json({
        message: "Invalid type",
      });
    }

    // Optional referral validation
    if (referralCode && !/^IND\d{3}$/.test(referralCode)) {
      return res.status(400).json({
        message: "Invalid referral code format",
      });
    }

    const cleanPhone = phone.trim();



    /* ---------- Find User ---------- */

    let user = await User.findOne({ phone: cleanPhone });

    let isNew = false;

    /* ---------- Create If New ---------- */

    if (!user) {
      // Generate own referral
      const ownReferral = await generateUniqueReferralCode();

      user = await User.create({
        phone: cleanPhone,
        type,
        referalCode: ownReferral,       // user's own code
        referredBy: referralCode || null, // who referred him (optional)
        isVerified: false,
      });

      isNew = true;
    }

    /* ---------- Type Lock ---------- */

    if (user.suspend) {
      return res.status(403).json({
        message: "Account suspended",
      });
    }



    /* ---------- Save WhatsApp UID ---------- */
    const otpResponse = await sendWhatsAppOtp(phone);

    if (!otpResponse.success) {
      await User.findByIdAndDelete(user._id); // rollback

      return res.status(500).json({ message: 'Failed to send OTP', error: otpResponse.error });
    }

    // Store WhatsApp UID


    await User.findByIdAndUpdate(
      user._id,
      { whatsapp_uid: otpResponse.data }
    );

    /* ---------- Response ---------- */

    return res.json({
      message: isNew
        ? "Registered. OTP sent"
        : "Login OTP sent",

      userId: user._id,
      isNewUser: isNew,
      type: user.type,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Auth start failed",
      error: err.message,
    });
  }
};


export const completOtp = async (req, res) => {
  try {
    const { userId, otp, deviceId } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        message: "userId, otp, deviceId required",
      });
    }

    // 1. Get user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // 2. Verify OTP
    const verifyResponse = await verifyWhatsAppOtp(user.whatsapp_uid, otp);
    logger.info(`OTP verification response for user ${userId}: ${JSON.stringify(verifyResponse)}`);
    if (!verifyResponse.success) {
      return res.status(400).json({ message: "Invalid OTP", error: verifyResponse.error });
    }



    // 3. Verify OTP and activate user (Device-Agnostic)

    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
      },
      {
        $set: {
          isVerified: true,
          otp: null,              // Clear OTP after success
          lastLoginAt: new Date() // Optional audit field (recommended)
        }
      },
      { new: true }
    );

    

    // 4. JWT
    const token = generateToken(
      updated._id,
      updated.type
    );
    logger.info(`Generated JWT for user ${userId}: ${token}`);

    logger.info(`Login success for user ${userId}`, {
      id: updated._id,
      phone: updated.phone,
      type: updated.type,
      isVerified: true,
    },);
    return res.json({
      message: "Login success",
      token,

      user: {
        id: updated._id,
        phone: updated.phone,
        type: updated.type,
        isVerified: true,
      },
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "OTP verify failed",
      error: err.message,
    });
  }
};

export const startAdminAuth = async (req, res) => {
  try {
    const { phone, type } = req.body;

    /* ---------- Validation ---------- */
    if (!phone || !type) {
      return res.status(400).json({
        success: false,
        message: "Phone and type are required"
      });
    }

    // Only allow super_admin type
    if (type !== 'super_admin') {
      return res.status(401).json({
        success: false,
        message: "Invalid access type"
      });
    }

    const cleanPhone = phone.trim();

    // Validate phone format (basic validation)
    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(cleanPhone.replace(/[^0-9]/g, ''))) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format"
      });
    }

    /* ---------- Find Existing Super Admin ---------- */
    const user = await User.findOne({
      phone: cleanPhone,
      type: 'super_admin' // Ensure only super_admin can login through this endpoint
    });

    // Don't create new user - super admin must exist in system
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials. Super admin account not found."
      });
    }

    /* ---------- Send OTP ---------- */
    const otpResponse = await sendWhatsAppOtp(phone);

    if (!otpResponse.success) {
      // Log the error for monitoring
      console.error(`Failed to send OTP to super admin ${phone}:`, otpResponse.error);

      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again later.'
      });
    }

    /* ---------- Update User with OTP Info ---------- */
    await User.findByIdAndUpdate(
      user._id,
      {
        whatsapp_uid: otpResponse.data,
        lastOtpSentAt: new Date(),
      }
    );

    /* ---------- Response ---------- */
    return res.json({
      success: true,
      message: "OTP sent successfully",
      userId: user._id,
      phone: user.phone,
      
    });

  } catch (err) {
    console.error('Admin auth start error:', err);

    res.status(500).json({
      success: false,
      message: "Authentication failed. Please try again later."
    });
  }
};

export const completeAdminOtp = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    /* ---------- Validation ---------- */
    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required"
      });
    }

    if (!otp.match(/^\d{4}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP format. OTP must be 6 digits."
      });
    }

    /* ---------- Find User ---------- */
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Verify this is a super admin account
    if (user.type !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Invalid account type."
      });
    }

 



    /* ---------- Verify OTP ---------- */
    const verifyResponse = await verifyWhatsAppOtp(user.whatsapp_uid, otp);

    if (!verifyResponse.success) {
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remainingAttempts} attempts remaining.`,
        remainingAttempts: remainingAttempts
      });
    }

    /* ---------- Generate JWT Token ---------- */
    const token = generateToken(user._id, user.type);

   
 

    /* ---------- Response with Minimal User Info ---------- */
    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        phone: user.phone,
        type: user.type,
      }
    });

  } catch (err) {
    console.error('Admin OTP verification error:', err);

    res.status(500).json({
      success: false,
      message: "OTP verification failed. Please try again."
    });
  }
};

export const completeProfile = async (req, res) => {
  try {
    const userId = req.user.id; // from JWT middleware

    const {
      name,
      email,
      data,
    } = req.body;

    /* ---------- Validation ---------- */

    if (!name && !email && !req.file && !data) {
      return res.status(400).json({
        message: "At least one field is required",
      });
    }

    /* ---------- Email Validation ---------- */

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        return res.status(400).json({
          message: "Invalid email format",
        });
      }

      const exists = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: userId },
      });

      if (exists) {
        return res.status(409).json({
          message: "Email already in use",
        });
      }
    }

    /* ---------- Build Update Object ---------- */

    const update = {};

    if (name) update.name = name.trim();

    if (email)
      update.email = email.toLowerCase().trim();

    /* ---------- Handle Image Upload ---------- */
    if (req.file) {
      try {
        // Upload to 'profiles' folder instead of 'products'
        const result = await uploadToCloudinary(req.file.buffer, 'profiles');
        update.profileImage = result.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        return res.status(400).json({
          message: "Failed to upload profile image",
          error: uploadError.message
        });
      }
    }

    if (data && typeof data === "object")
      update.data = data;

    // Mark profile as completed
    update.isProfileCompleted = true;

    /* ---------- Atomic Update ---------- */

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password -otp");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    /* ---------- Response ---------- */

    return res.json({
      message: "Profile completed successfully",
      user,
    });

  } catch (err) {
    console.error('Profile update error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        message: "Duplicate field error",
      });
    }

    res.status(500).json({
      message: "Profile update failed",
      error: err.message,
    });
  }
};

export const findUserByReferralOwner = async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({
        message: "Referral code is required",
      });
    }

    // ✅ Find ONLY owner of this referral code
    const user = await User.findOne({
      referalCode: code,
    }).select("-password -otp -whatsapp_uid");

    if (!user) {
      return res.status(404).json({
        message: "No user found with this referral code",
      });
    }

    return res.json({
      success: true,
      user,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Referral search failed",
      error: err.message,
    });
  }
};

const signup = async (req, res) => {
  try {
    // deviceId,
    const { name, phone, email, type, password, referralCode, deviceId
    } = req.body;


    if (!name || !phone || !password) {
      return res.status(400).json({ message: 'Name, phone, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    if (referralCode && !/^(IND\d{3})$/.test(referralCode)) {
      return res.status(400).json({ message: 'Invalid referral code format' });
    }


    if (!["user", "partner", "agency"].includes(type)) {
      return res.status(401).json({ success: false, message: "Unauthorized Access Denied" });
    }

    // Find user by email, phone, or deviceId
    const existingUser = await User.findOne({
      $or: [
        phone ? { phone } : null,
        deviceId ? { deviceId } : null
      ].filter(Boolean)
    });

    if (email) {
      const emailExists = await User.findOne({ email: email.toLowerCase().trim() });
      if (emailExists) {
        return res.status(400).json({
          message: 'Email already registered. Please login.'
        });
      }
    }
    if (existingUser) {
      // ✅ If device is already registered with another phone/email
      if (
        existingUser.deviceId === deviceId &&
        (existingUser.phone !== phone)
      ) {
        return res.status(400).json({
          message: 'This device is already registered with another account.'
        });
      }

      // ✅ If same user tries again (same device + same email/phone)
      if (
        existingUser.deviceId === deviceId &&
        existingUser.phone === phone
      ) {
        return res.status(200).json({
          message: 'You are already registered. Please log in instead.'
        });
      }

      // ✅ If email or phone already exists for another device

      if (existingUser.phone === phone) {
        return res.status(400).json({ message: 'Phone number is already registered.' });
      }
    }

    // Generate referral code
    let uniqueReferralCode = null;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!isUnique && attempts < maxAttempts) {
      uniqueReferralCode = generateReferralCode();
      const existingCode = await User.findOne({ referalCode: uniqueReferralCode });
      if (!existingCode) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ message: 'Could not generate unique referral code' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name,                              // deviceId,
      type,
      phone,
      email: email ? email.toLowerCase().trim() : undefined,
      password: hashedPassword,
      referalCode: uniqueReferralCode,
      referredBy: referralCode || null,
    });


    await newUser.save(); // SAVE FIRST

    // Send WhatsApp OTP
    const otpResponse = await sendWhatsAppOtp(phone);


    if (!otpResponse.success) {
      await User.findByIdAndDelete(newUser._id); // rollback

      return res.status(500).json({ message: 'Failed to send OTP', error: otpResponse.error });
    }

    // Store WhatsApp UID
    newUser.whatsapp_uid = otpResponse.data || null;
    await newUser.save();

    res.status(201).json({
      message: 'Signup successful, OTP sent to WhatsApp',
      userId: newUser._id,
      whatsapp_uid: newUser.whatsapp_uid
    });
  } catch (error) {
    console.log(error)
    logger.info("error", error);
    res.status(500).json({ message: 'Signup failed', error: error.message });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { userId, otp, deviceId } = req.body;

    if (!userId || !otp || !deviceId) {
      return res.status(400).json({ message: "userId, otp and deviceId are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 1. Verify WhatsApp OTP
    const verifyResponse = await verifyWhatsAppOtp(user.whatsapp_uid, otp);
    if (!verifyResponse.success) {
      return res.status(400).json({ message: "Invalid OTP", error: verifyResponse.error });
    }

    // 2. Check if deviceId already belongs to another user
    const existingDeviceUser = await User.findOne({
      deviceId,
      _id: { $ne: user._id }
    }).select("_id");

    if (existingDeviceUser) {
      return res.status(409).json({
        message: "This device is already registered with another account"
      });
    }

    // 3. Atomic update (prevents race conditions)
    user.isVerified = true;
    user.deviceId = deviceId;
    user.otp = null;

    await user.save();



    // 5. Token response
    res.json({
      message: "OTP verified successfully",
      token: generateToken(user._id, user.type),
      name: user.name,
      type: user.type,
      isVerified: true,
      isProfileCompleted: user.isProfileCompleted
    });

  } catch (error) {

    // Handle Mongo duplicate key error safely
    if (error.code === 11000 && error.keyPattern?.deviceId) {
      return res.status(409).json({
        message: "Device already registered with another account"
      });
    }

    res.status(500).json({
      message: "OTP verification failed",
      error: error.message
    });
  }
};




const login = async (req, res) => {
  try {
    const { phone, password, deviceId, deviceToken } = req.body;

    // ✅ 1. Basic validation for phone & password only
    if (!phone || !password) {
      return res.status(400).json({
        message: 'Phone and password are required'
      });
    }


    // ✅ 2. Find user by phone
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ message: 'Invalid phone number or password' });
    }

    if (user.isVerified === false) {
      return res.status(403).json({
        message: 'Account not verified. Please complete OTP verification.'
      });
    }

    if (user.suspend === true) {
      return res.status(403).json({
        message: 'Account suspended. Contact support.'
      });
    }

    // ✅ 3. Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid phone number or password' });
    }

    // ✅ 4. Roles that require deviceId & deviceToken
    const requiresDevice = !['super_admin', 'admin', 'partner'].includes(user.type);

    if (requiresDevice) {
      if (!deviceId || !deviceToken) {
        return res.status(400).json({
          message: 'deviceId and deviceToken are required for your account type'
        });
      }

      // Check if deviceId already used by another user
      const deviceIdInUse = await User.findOne({
        deviceId,
        _id: { $ne: user._id }
      });
      if (deviceIdInUse) {
        return res.status(400).json({
          message: 'This device ID is already registered with another account.'
        });
      }

      // Check if deviceToken already used by another user
      const deviceTokenInUse = await User.findOne({
        deviceToken,
        _id: { $ne: user._id }
      });
      if (deviceTokenInUse) {
        return res.status(400).json({
          message: 'This device token is already registered with another account.'
        });
      }

      // Save or update deviceId & deviceToken if changed
      let updated = false;
      if (user.deviceId !== deviceId) {
        user.deviceId = deviceId;
        updated = true;
      }
      if (user.deviceToken !== deviceToken) {
        user.deviceToken = deviceToken;
        updated = true;
      }
      if (updated) await user.save();
    }

    // ✅ 5. Generate JWT token
    const token = generateToken(user._id.toString(), user.type);

    // ✅ 6. Send response
    return res.status(200).json({
      success: true,
      token,
      name: user.name,
      type: user.type,
      isApproved: user.isVerified,
      isProfileCompleted: user.isProfileCompleted,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      message: 'Login failed',
      error: error.message
    });
  }
};




const resendOtp = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Send new WhatsApp OTP
    const otpResponse = await sendWhatsAppOtp(user.phone);
    if (!otpResponse.success) {
      return res.status(500).json({ message: 'Failed to send OTP', error: otpResponse.error });
    }

    // Update WhatsApp UID
    user.whatsapp_uid = otpResponse.data || null;
    await user.save();

    res.status(200).json({
      message: 'OTP resent successfully',
      whatsapp_uid: user.whatsapp_uid
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to resend OTP', error: error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { phone } = req.body;

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Send WhatsApp OTP
    const otpResponse = await sendWhatsAppOtp(phone);
    if (!otpResponse.success) {
      return res.status(500).json({ message: 'Failed to send OTP', error: otpResponse.error });
    }

    // Store WhatsApp UID
    user.whatsapp_uid = otpResponse.data || null;
    await user.save();

    res.status(200).json({
      message: 'OTP sent to WhatsApp',
      userId: user._id,
      whatsapp_uid: user.whatsapp_uid
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send OTP', error: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { userId, otp, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify WhatsApp OTP
    const verifyResponse = await verifyWhatsAppOtp(user.whatsapp_uid, otp);
    if (!verifyResponse.success) {
      return res.status(400).json({ message: 'Invalid OTP', error: verifyResponse.error });
    }

    // Update password
    user.password = await bcrypt.hash(newPassword, 10);
    user.whatsapp_uid = null;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: 'Password reset failed', error: error.message });
  }
};

const signout = (req, res) => {
  // Clear device token
  User.findByIdAndUpdate(req.user._id, { devicetoken: null }, { new: true })
    .then(() => {
      res.json({ message: 'Signout successful' });
    })
    .catch(error => {
      res.status(500).json({ message: 'Signout failed', error: error.message });
    });
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;



    const isDataNotEmpty = Object.keys(req.body).length > 0;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        phone: req.body.phonenumber,
        data: req.body,  // Updating the Mixed type field
        isProfileCompleted: isDataNotEmpty ? true : false,
      },
      { new: true }  // Return the updated document
    );
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);

  } catch (error) {

    res.status(500).json({ message: 'Server error' });
  }
};

const getProfileData = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ data: user.data, _id: userId, isApproved: user.isVerified, isProfileCompleted: user.isProfileCompleted, name: user.name, email: user.email, type: user.type });
  } catch (error) {

    res.status(500).json({ message: 'Server error' });
  }
}

const getOwner = async (req, res) => {
  try {
    const { ownerId } = req.params;
    const user = await User.findById(ownerId);
    if (!user || user.type !== 'partner') {
      return res.status(404).json({ message: 'Owner not found' });
    }
    res.json({ data: user.data, name: user.name, email: user.email });
  } catch (error) {

    res.status(500).json({ message: 'Server error' });
  }
}

const uploadProfileImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image uploaded or invalid file type.' });
  }

  const newImageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

  try {
    const user = await User.findById(req.user._id);
    if (user && user.profileImage) {
      const previousImagePath = path.join(__dirname, '..', user.profileImage.split('/uploads/')[1]);

      // Delete the previous image file from the server
      fs.unlink(previousImagePath, (err) => {
        if (err) {
          console.error('Error deleting previous image:', err);
        } else {
          console.log('Previous image deleted successfully');
        }
      });
    }
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { profileImage: newImageUrl },
      { new: true }
    );

    return res.json({ message: 'Profile image uploaded successfully', imageUrl: newImageUrl, user: updatedUser });
  } catch (error) {
    return res.status(500).json({ message: 'Error uploading profile image' });
  }
};


const getProfileImageUrl = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('profileImage');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ profileImage: user.profileImage });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching profile image URL' });
  }
};

export {
  signup,
  verifyOtp,
  resendOtp,
  login,
  signout,
  forgotPassword,
  resetPassword,
  updateProfile,
  getProfileData,
  uploadProfileImage,
  getProfileImageUrl,
  getOwner
};
