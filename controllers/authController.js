import bcrypt from 'bcryptjs';
import User from '../models/userModel.js';
import { generateToken } from '../config/jwt.js';
import { sendWhatsAppOtp, verifyWhatsAppOtp, generateOTP } from '../utils/whatapp.js';
import { QuicksendWhatsAppOtp } from '../utils/whatapp_otp.js';
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
import { verifyGoogleOwnership, verifyGoogleWebOwnership } from '../config/OAuth.js';
import { Parser } from 'json2csv';
import { newgenerateToken } from '../config/new_user_jwt.js';
const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_key"; // keep this secret in env
import Otp from '../models/Otp.js';



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




export const oauthAuthController = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { idToken, accessToken, deviceId, referralCode, devicetoken, type } = req.body;

    // 🔐 Step 1: Validate Tokens
    if (!idToken && !accessToken) {
      return res.status(400).json({
        success: false,
        message: "Google token is required",
      });
    }

    // 🔐 Step 2: Verify Google User
    let googleData;

    if (idToken) {
      // Mobile / Native flow
      googleData = await verifyGoogleOwnership(idToken);
    } else if (accessToken) {
      // Web flow
      googleData = await verifyGoogleWebOwnership(accessToken);
    }

    logger.info("Google OAuth Data:", {

      providerId: googleData?.providerId,
      email: googleData?.email,
      name: googleData?.name,
      avatar: googleData?.avatar,
      emailVerified: googleData?.emailVerified,
    });
    const {
      providerId: googleId,
      email,
      name,
      avatar,
      emailVerified,
    } = googleData;

    if (!googleId) {
      throw new Error("INVALID_GOOGLE_ID");
    }

    // 🔎 Step 2: Find user (Indexed Query)
    let user = await User.findOne({
      $or: [
        { "oauthProviders.google.id": googleId },
        { googleId },
        ...(email ? [{ email: email.toLowerCase() }] : []),
      ],
    }).session(session);

    let isNewUser = false;

    // 🆕 Step 3: Create User (Atomic Write)
    if (!user) {
      logger.info("No existing user found. Creating new user.");
      const ownReferral = await generateUniqueReferralCode();

      const [newUser] = await User.create(
        [
          {
            name,
            email,
            profileImage: avatar,
            referalCode: ownReferral,
            referredBy: referralCode || null,
            deviceId: deviceId || null,
            type: type || "user",
            devicetoken: devicetoken || null,
            oauthProviders: {
              google: {
                id: googleId,
                email,
              },
            },
            isVerified: emailVerified,
            accountStatus: "ACTIVE",
          },
        ],
        { session }
      );

      user = newUser;
      isNewUser = true;
    } else {
      let updatePayload = {};
      let needsUpdate = false;

      // 🔗 Link Google if not linked
      if (!user.oauthProviders?.google?.id) {
        updatePayload["oauthProviders.google"] = {
          id: googleId,
          email,
        };
        needsUpdate = true;
      }

      // 📱 Device ID update
      if (deviceId && user.deviceId !== deviceId) {
        updatePayload.deviceId = deviceId;
        needsUpdate = true;
      }

      // 🔔 Device Token update
      if (devicetoken && user.devicetoken !== devicetoken) {
        updatePayload.devicetoken = devicetoken;
        needsUpdate = true;
      }

      // 🖼️ Optional profile sync (like Google refresh)
      if (avatar && user.profileImage !== avatar) {
        updatePayload.profileImage = avatar;
        needsUpdate = true;
      }

      if (needsUpdate) {
        user = await User.findByIdAndUpdate(
          user._id,
          { $set: updatePayload },
          { new: true, session }
        );
      }
    }

    // 🚫 Step 4: Account Status Check (Fail Fast)
    if (user.accountStatus === "SUSPENDED" || user.suspend === true) {
      await session.abortTransaction();

      return res.status(403).json({
        success: false,
        message: "Account suspended",
      });
    }


    // 🔐 Step 5: Generate JWT (stateless auth)
    logger.info("Generating JWT for user:", {
      userId: user._id,
      email: user.email,
      type: user.type,
    });

    const token = isNewUser
      ? await newgenerateToken(user._id, user.type)
      : await generateToken(user._id, user.type);

    await session.commitTransaction();
    session.endSession();

    // ✅ Step 6: Response (Lean, frontend optimized)
    return res.status(200).json({
      success: true,
      message: isNewUser
        ? "User registered successfully"
        : "Login successful",
      data: {
        isNewUser,
        token,
        user: {
          id: user._id,
          uid: user.uid,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage,
          type: user.type,
          accountStatus: user.accountStatus,
        },
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("OAuth Auth Error:", {
      message: error.message,
      stack: error.stack,
    });

    return res.status(401).json({
      success: false,
      message: "Unauthorized Google login",
    });
  }
};



export const UpdatePhone = async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = req?.user?.id || req?.user?._id;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const existingUser = await User.findOne({ phone: phone.trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Phone number already in use",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId, // the user to update
      { phone: phone.trim() }, // update this field
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Phone number updated successfully",
      data: updatedUser,
    });
  }

  catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
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
        jobInfo salaryStructure bankDetails officeLocation shift employeeType
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
          employeeType: employee.employeeType || null,
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


// export const startAuth = async (req, res) => {
//   try {
//     const { phone, deviceId, type, referralCode } = req.body;

//     /* ---------- Validation ---------- */

//     if (!phone || !type) {
//       return res.status(400).json({
//         message: "phone, deviceId and type required",
//       });
//     }

//     const allowed = ["user", "partner", "agency", 'admin', 'super_admin'];

//     if (!allowed.includes(type)) {
//       return res.status(401).json({
//         message: "Invalid type",
//       });
//     }

//     // Optional referral validation
//     if (referralCode && !/^IND\d{3}$/.test(referralCode)) {
//       return res.status(400).json({
//         message: "Invalid referral code format",
//       });
//     }

//     const cleanPhone = phone.trim();

//     const code =  generateOTP();

//     /* ---------- Find User ---------- */

//     let user = await User.findOne({ phone: cleanPhone });

//     let isNew = false;

//     /* ---------- Create If New ---------- */

//     if (!user) {
//       // Generate own referral
//       const ownReferral = await generateUniqueReferralCode();

//       user = await User.create({
//         phone: cleanPhone,
//         type,
//         referalCode: ownReferral,       // user's own code
//         referredBy: referralCode || null, // who referred him (optional)
//         isVerified: false,
//       });

//       isNew = true;
//     }

//     /* ---------- Type Lock ---------- */

//     if (user.suspend) {
//       return res.status(403).json({
//         message: "Account suspended",
//       });
//     }



//     /* ---------- Save WhatsApp UID ---------- */
//     const otpResponse = await sendWhatsAppOtp(phone,code);

//     if (!otpResponse.success) {


//       return res.status(500).json({ message: 'Failed to send OTP', error: otpResponse.error });
//     }

//     // Store WhatsApp UID


//     await User.findByIdAndUpdate(
//       user._id,
//       { otp: code, whatsapp_uid: otpResponse.data, lastOtpSentAt: new Date() },
//       { new: true }
//     );

//     /* ---------- Response ---------- */

//     return res.json({
//       message: isNew
//         ? "Registered. OTP sent"
//         : "Login OTP sent",

//       userId: user._id,
//       isNewUser: isNew,
//       type: user.type,
//     });

//   } catch (err) {
//     console.error(err);

//     res.status(500).json({
//       message: "Auth start failed",
//       error: err.message,
//     });
//   }
// };




export const startAuth = async (req, res) => {
  try {
    const {
      phone,
      type,
      referralCode,
    } = req.body;

    /* ---------------- VALIDATION ---------------- */

    if (!phone || !type) {
      return res.status(400).json({
        success: false,
        message: "phone and type required",
      });
    }

    const allowedTypes = [
      "user",
      "partner",
      "agency",
      "admin",
      "super_admin",
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid type",
      });
    }

    const cleanPhone = phone.trim();

    /* ---------------- RATE LIMIT ---------------- */

    const recentOtp = await Otp.findOne({
      phone: cleanPhone,
      createdAt: {
        $gt: new Date(
          Date.now() - 60 * 1000
        ),
      },
    }).lean();

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        message:
          "Please wait 1 minute before requesting another OTP",
      });
    }

    /* ---------------- FIND USER ---------------- */

    let user = await User.findOne({
      phone: cleanPhone,
    });

    let isNewUser = false;

    /* ---------------- CREATE USER ---------------- */

    if (!user) {

      /* OPTIONAL REFERRAL VALIDATION */

      let referredUser = null;

      if (referralCode) {

        referredUser = await User.findOne({
          referalCode: referralCode,
        }).select("_id referalCode");

        if (!referredUser) {
          return res.status(400).json({
            success: false,
            message: "Invalid referral code",
          });
        }
      }

      /* USER OWN REFERRAL CODE */

      const ownReferralCode =
        await generateUniqueReferralCode();

      user = await User.create({
        phone: cleanPhone,
        type,

        /* USER OWN CODE */
        referalCode: ownReferralCode,

        /* OPTIONAL */
        referredBy: referralCode || null,

        isVerified: false,
      });

      isNewUser = true;
    }

    /* ---------------- SUSPEND CHECK ---------------- */

    if (user.suspend) {
      return res.status(403).json({
        success: false,
        message: "Account suspended",
      });
    }

    /* ---------------- DELETE OLD OTP ---------------- */

    await Otp.deleteMany({
      userId: user._id,
    });

    /* ---------------- GENERATE OTP ---------------- */

    const code = generateOTP();

    /* ---------------- SAVE OTP ---------------- */

    await Otp.create({
      userId: user._id,
      phone: cleanPhone,
      otp: code,

      attempts: 0,

      expiresAt: new Date(
        Date.now() + 5 * 60 * 1000
      ),
    });

    /* ---------------- SEND OTP ---------------- */

    const otpResponse =
      await QuicksendWhatsAppOtp(
        cleanPhone,
        code
      );

    if (!otpResponse.success) {

      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
        error: otpResponse.error,
      });
    }

    /* ---------------- RESPONSE ---------------- */

    return res.status(200).json({
      success: true,

      message: isNewUser
        ? "Registered successfully. OTP sent"
        : "Login OTP sent",

      userId: user._id,

      isNewUser,

      type: user.type,
    });

  } catch (error) {

    console.error(
      "startAuth Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Auth start failed",
      error: error.message,
    });
  }
};





export const completOtp = async (req, res) => {
  try {
    const {
      userId,
      otp,
      deviceId,
    } = req.body;

    /* ---------------- VALIDATION ---------------- */

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "userId and otp required",
      });
    }

    /* ---------------- FIND USER ---------------- */

    const user = await User.findById(userId)
      .select(
        "_id phone type suspend isVerified"
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    /* ---------------- SUSPEND CHECK ---------------- */

    if (user.suspend) {
      return res.status(403).json({
        success: false,
        message: "Account suspended",
      });
    }

    /* ---------------- FIND OTP ---------------- */

    const otpDoc = await Otp.findOne({
      userId: user._id,
      verified: false,
    });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found",
      });
    }

    /* ---------------- EXPIRE CHECK ---------------- */

    if (
      new Date() > new Date(otpDoc.expiresAt)
    ) {

      await Otp.deleteMany({
        userId: user._id,
      });

      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    /* ---------------- ATTEMPTS CHECK ---------------- */

    if (
      otpDoc.attempts >=
      otpDoc.maxAttempts
    ) {

      return res.status(429).json({
        success: false,
        message:
          "Too many invalid attempts",
      });
    }

    /* ---------------- INVALID OTP ---------------- */

    if (otpDoc.otp !== otp) {

      otpDoc.attempts += 1;

      await otpDoc.save();

      const attemptsLeft =
        otpDoc.maxAttempts -
        otpDoc.attempts;

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
        attemptsLeft:
          attemptsLeft < 0
            ? 0
            : attemptsLeft,
      });
    }

    /* ---------------- MARK VERIFIED ---------------- */

    otpDoc.verified = true;

    if (deviceId) {
      otpDoc.deviceId = deviceId;
    }

    await otpDoc.save();

    /* ---------------- UPDATE USER ---------------- */

    const updatedUser =
      await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            isVerified: true,
            lastLoginAt: new Date(),
          },
        },
        {
          new: true,
        }
      ).lean();

    /* ---------------- DELETE OTP ---------------- */

    await Otp.deleteMany({
      userId: user._id,
    });

    /* ---------------- GENERATE JWT ---------------- */

    const token = await generateToken(
      updatedUser._id,
      updatedUser.type
    );

    /* ---------------- RESPONSE ---------------- */

    return res.status(200).json({
      success: true,
      message: "Login success",

      token,

      user: {
        id: updatedUser._id,
        phone: updatedUser.phone,
        type: updatedUser.type,
        isVerified:
          updatedUser.isVerified,
      },
    });

  } catch (error) {

    console.error(
      "completOtp Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
      error: error.message,
    });
  }
};




/* =========================================================
   START SUPER ADMIN AUTH
========================================================= */

export const startAdminAuth = async (
  req,
  res
) => {
  try {

    const {
      phone,
      type,
    } = req.body;

    /* ---------------- VALIDATION ---------------- */

    if (!phone || !type) {
      return res.status(400).json({
        success: false,
        message:
          "phone and type required",
      });
    }

    /* ONLY SUPER ADMIN */

    if (type !== "super_admin") {
      return res.status(403).json({
        success: false,
        message:
          "Only super admin access allowed",
      });
    }

    const cleanPhone = phone.trim();

    /* PHONE VALIDATION */

    const phoneRegex =
      /^[0-9]{10,15}$/;

    if (
      !phoneRegex.test(
        cleanPhone.replace(/\D/g, "")
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid phone number format",
      });
    }

    /* ---------------- FIND USER ---------------- */

    const user = await User.findOne({
      phone: cleanPhone,
      type: "super_admin",
    });

    /* SUPER ADMIN MUST EXIST */

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "Super admin account not found",
      });
    }

    /* SUSPEND CHECK */

    if (user.suspend) {
      return res.status(403).json({
        success: false,
        message:
          "Account suspended",
      });
    }

    /* ---------------- RATE LIMIT ---------------- */

    const recentOtp = await Otp.findOne({
      userId: user._id,
      createdAt: {
        $gt: new Date(
          Date.now() - 60 * 1000
        ),
      },
    }).lean();

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        message:
          "Please wait 1 minute before requesting another OTP",
      });
    }

    /* ---------------- DELETE OLD OTP ---------------- */

    await Otp.deleteMany({
      userId: user._id,
    });

    /* ---------------- GENERATE OTP ---------------- */

    const code = generateOTP();

    /* ---------------- SAVE OTP ---------------- */

    await Otp.create({
      userId: user._id,
      phone: cleanPhone,
      otp: code,
      attempts: 0,

      expiresAt: new Date(
        Date.now() + 5 * 60 * 1000
      ),
    });

    /* ---------------- SEND WHATSAPP OTP ---------------- */

    const otpResponse =
      await QuicksendWhatsAppOtp(
        cleanPhone,
        code
      );

    if (!otpResponse.success) {

      console.error(
        "Admin OTP send failed:",
        otpResponse.error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to send OTP",
      });
    }

    /* ---------------- RESPONSE ---------------- */

    return res.status(200).json({
      success: true,
      message:
        "OTP sent successfully",

      userId: user._id,

      phone: user.phone,
    });

  } catch (error) {

    console.error(
      "startAdminAuth Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Authentication failed",
      error: error.message,
    });
  }
};



/* =========================================================
   COMPLETE SUPER ADMIN OTP
========================================================= */

export const completeAdminOtp =
  async (req, res) => {

    try {

      const {
        userId,
        otp,
      } = req.body;

      /* ---------------- VALIDATION ---------------- */

      if (!userId || !otp) {
        return res.status(400).json({
          success: false,
          message:
            "userId and otp required",
        });
      }

      /* 4 DIGIT OTP */

      if (!/^\d{4}$/.test(otp)) {
        return res.status(400).json({
          success: false,
          message:
            "OTP must be 4 digits",
        });
      }

      /* ---------------- FIND USER ---------------- */

      const user =
        await User.findById(userId)
          .select(
            "_id phone type suspend"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User not found",
        });
      }

      /* ONLY SUPER ADMIN */

      if (
        user.type !== "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied",
        });
      }

      /* SUSPEND CHECK */

      if (user.suspend) {
        return res.status(403).json({
          success: false,
          message:
            "Account suspended",
        });
      }

      /* ---------------- FIND OTP ---------------- */

      const otpDoc =
        await Otp.findOne({
          userId: user._id,
          verified: false,
        });

      if (!otpDoc) {
        return res.status(400).json({
          success: false,
          message:
            "OTP expired or not found",
        });
      }

      /* ---------------- EXPIRE CHECK ---------------- */

      if (
        new Date() >
        new Date(
          otpDoc.expiresAt
        )
      ) {

        await Otp.deleteMany({
          userId: user._id,
        });

        return res.status(400).json({
          success: false,
          message:
            "OTP expired",
        });
      }

      /* ---------------- ATTEMPTS CHECK ---------------- */

      if (
        otpDoc.attempts >=
        otpDoc.maxAttempts
      ) {

        return res.status(429).json({
          success: false,
          message:
            "Too many invalid attempts",
        });
      }

      /* ---------------- INVALID OTP ---------------- */

      if (otpDoc.otp !== otp) {

        otpDoc.attempts += 1;

        await otpDoc.save();

        return res.status(400).json({
          success: false,
          message:
            "Invalid OTP",

          remainingAttempts:
            otpDoc.maxAttempts -
            otpDoc.attempts,
        });
      }

      /* ---------------- MARK VERIFIED ---------------- */

      otpDoc.verified = true;

      await otpDoc.save();

      /* ---------------- UPDATE USER ---------------- */

      const updatedUser =
        await User.findByIdAndUpdate(
          user._id,
          {
            $set: {
              isVerified: true,
              lastLoginAt:
                new Date(),
            },
          },
          {
            new: true,
          }
        ).lean();

      /* ---------------- DELETE OTP ---------------- */

      await Otp.deleteMany({
        userId: user._id,
      });

      /* ---------------- JWT TOKEN ---------------- */

      const token =
        await generateToken(
          updatedUser._id,
          updatedUser.type
        );

      /* ---------------- RESPONSE ---------------- */

      return res.status(200).json({
        success: true,
        message:
          "Login successful",

        token,

        user: {
          id: updatedUser._id,
          phone:
            updatedUser.phone,
          type:
            updatedUser.type,
        },
      });

    } catch (error) {

      console.error(
        "completeAdminOtp Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "OTP verification failed",
        error: error.message,
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



const resendOtp = async (
  req,
  res
) => {
  try {

    const {
      userId,
    } = req.body;

    /* ---------------- VALIDATION ---------------- */

    if (!userId) {
      return res.status(400).json({
        success: false,
        message:
          "userId is required",
      });
    }

    /* ---------------- FIND USER ---------------- */

    const user =
      await User.findById(userId)
        .select(
          "_id phone type suspend"
        )
        .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User not found",
      });
    }

    /* ---------------- SUSPEND CHECK ---------------- */

    if (user.suspend) {
      return res.status(403).json({
        success: false,
        message:
          "Account suspended",
      });
    }

    /* ---------------- RATE LIMIT ---------------- */

    const recentOtp =
      await Otp.findOne({
        userId: user._id,

        createdAt: {
          $gt: new Date(
            Date.now() -
            60 * 1000
          ),
        },
      }).lean();

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        message:
          "Please wait 1 minute before resending OTP",
      });
    }

    /* ---------------- DELETE OLD OTP ---------------- */

    await Otp.deleteMany({
      userId: user._id,
    });

    /* ---------------- GENERATE NEW OTP ---------------- */

    const code = generateOTP();

    /* ---------------- SAVE OTP ---------------- */

    await Otp.create({
      userId: user._id,

      phone: user.phone,

      otp: code,

      attempts: 0,

      expiresAt: new Date(
        Date.now() +
        5 * 60 * 1000
      ),
    });

    /* ---------------- SEND OTP ---------------- */

    const otpResponse =
      await QuicksendWhatsAppOtp(
        user.phone,
        code
      );

    logger.info(
      `OTP resend response for ${user.phone}`,
      otpResponse
    );

    if (!otpResponse.success) {

      logger.error(
        "OTP resend failed",
        otpResponse.error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to resend OTP",

        error:
          otpResponse.error,
      });
    }

    /* ---------------- RESPONSE ---------------- */

    return res.status(200).json({
      success: true,
      message:
        "OTP resent successfully",
    });

  } catch (error) {

    logger.error(
      "resendOtp Error",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to resend OTP",

      error: error.message,
    });

  } finally {

    logger.info(
      "OTP resend attempt completed"
    );
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

  resendOtp,

  signout,

  updateProfile,
  getProfileData,
  uploadProfileImage,
  getProfileImageUrl,
  getOwner
};
