// models/Attandance/Face.js

import mongoose from "mongoose";

/* ===========================
   Individual Enrolled Image
=========================== */
const FaceImageSchema = new mongoose.Schema(
    {
        url: {
            type: String,
            required: [true, "Image URL is required"]
        },

        cloudinaryPublicId: {
            type: String,
            required: false,
            default: null
        },

        embedding: {
            type: [Number], // 512-d vector from ArcFace/InsightFace
            required: [true, "Face embedding is required"],
            validate: {
                validator: function (v) {
                    return Array.isArray(v) && v.length > 0 && v.every(num => typeof num === 'number' && !isNaN(num));
                },
                message: "Embedding must be a non-empty array of valid numbers"
            }
        },

        detScore: {
            type: Number, // face detector confidence (0-1)
            default: 0,
            min: [0, "Detection score cannot be negative"],
            max: [1, "Detection score cannot exceed 1"]
        },

        angle: {
            type: String,
            enum: {
                values: ["front", "left", "right", "up", "down", "other"],
                message: "{VALUE} is not a valid face angle"
            },
            default: "front"
        },

        quality: {
            type: String,
            enum: {
                values: ["good", "acceptable", "poor"],
                message: "{VALUE} is not a valid quality level"
            },
            default: "good"
        },

        capturedAt: {
            type: Date,
            default: Date.now
        },

        isActive: {
            type: Boolean,
            default: true // set false instead of deleting, for audit trail
        }
    },
    { _id: true }
);

/* ===========================
   Verification Attempt Log
   (kept lightweight here; full punch audit stays on Attendance)
=========================== */
const VerificationLogSchema = new mongoose.Schema(
    {
        attemptedAt: {
            type: Date,
            default: Date.now
        },

        matched: {
            type: Boolean,
            required: [true, "Match status is required"]
        },

        similarity: {
            type: Number, // cosine similarity score
            required: [true, "Similarity score is required"],
            min: [-1, "Similarity score cannot be less than -1"],
            max: [1, "Similarity score cannot exceed 1"]
        },

        detScore: {
            type: Number,
            default: 0,
            min: [0, "Detection score cannot be negative"],
            max: [1, "Detection score cannot exceed 1"]
        },

        imageUrl: {
            type: String,
            default: null
        },

        purpose: {
            type: String,
            enum: {
                values: ["punch_in", "punch_out", "re_verification", "spot_check"],
                message: "{VALUE} is not a valid verification purpose"
            },
            default: "punch_in"
        },

        deviceInfo: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },

        ip: {
            type: String,
            default: null
        },

        attendanceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Attendance",
            default: null
        }
    },
    { _id: true, timestamps: false }
);

/* ===========================
   Main Face Schema
=========================== */
const faceSchema = new mongoose.Schema(
    {
        /* ===========================
           Organization Mapping
        ============================ */

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // Should this be "Company"? Double-check your ref
            required: [true, "Company ID is required"],
            index: true // ✅ CRITICAL for performance
        },

        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: [true, "Employee ID is required"],
            unique: true, // one face profile per employee
            index: true
        },

        /* ===========================
           Enrolled Face Data
        ============================ */

        images: {
            type: [FaceImageSchema],
            default: [],
            validate: {
                validator: function (v) {
                    // Allow empty array for not_started status
                    if (!this.isEnrolled && this.enrollmentStatus === 'not_started') {
                        return true;
                    }
                    return v.length <= 5; // cap enrollment images per employee
                },
                message: "Maximum 5 enrolled face images allowed per employee"
            }
        },

        /* ===========================
           Enrollment Status
        ============================ */

        isEnrolled: {
            type: Boolean,
            default: false,
            index: true
        },

        enrollmentStatus: {
            type: String,
            enum: {
                values: ["not_started", "pending_review", "approved", "rejected", "needs_reenrollment"],
                message: "{VALUE} is not a valid enrollment status"
            },
            default: "not_started",
            index: true
        },

        minRequiredImages: {
            type: Number,
            default: 2,
            min: [1, "Minimum required images must be at least 1"],
            max: [5, "Minimum required images cannot exceed 5"]
        },

        enrolledAt: {
            type: Date,
            default: null
        },

        lastReEnrolledAt: {
            type: Date,
            default: null
        },

        enrolledBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // admin/HR who approved enrollment, if manual review is required
            default: null
        },

        rejectionReason: {
            type: String,
            default: null,
            maxlength: [500, "Rejection reason cannot exceed 500 characters"]
        },

        /* ===========================
           Matching Configuration
           (allow per-employee / per-company override of global threshold)
        ============================ */

        matchThreshold: {
            type: Number,
            default: 0.65, // cosine similarity threshold used at verification time
            min: [0, "Match threshold cannot be negative"],
            max: [1, "Match threshold cannot exceed 1"]
        },

        modelVersion: {
            type: String,
            default: "insightface-arcface-buffalo_l",
            maxlength: [100, "Model version string too long"]
        },

        /* ===========================
           Verification History
        ============================ */

        verificationLogs: {
            type: [VerificationLogSchema],
            default: [],
            validate: {
                validator: function (v) {
                    return Array.isArray(v);
                },
                message: "Verification logs must be an array"
            }
        },

        lastVerifiedAt: {
            type: Date,
            default: null
        },

        totalVerificationAttempts: {
            type: Number,
            default: 0,
            min: [0, "Total verification attempts cannot be negative"]
        },

        totalFailedAttempts: {
            type: Number,
            default: 0,
            min: [0, "Total failed attempts cannot be negative"]
        },

        consecutiveFailedAttempts: {
            type: Number,
            default: 0,
            min: [0, "Consecutive failed attempts cannot be negative"]
        },

        /* ===========================
           Fraud / Security Flags
        ============================ */

        isLocked: {
            type: Boolean,
            default: false, // lock after too many consecutive failures
            index: true
        },

        lockedAt: {
            type: Date,
            default: null
        },

        lockReason: {
            type: String,
            default: null,
            maxlength: [500, "Lock reason cannot exceed 500 characters"]
        },

        isSuspicious: {
            type: Boolean,
            default: false,
            index: true
        },

        flaggedForReview: {
            type: Boolean,
            default: false,
            index: true
        },

        /* ===========================
           Consent / Compliance
        ============================ */

        consentGiven: {
            type: Boolean,
            default: false,
            required: [true, "Consent status is required"]
        },

        consentGivenAt: {
            type: Date,
            default: null
        },

        consentWithdrawnAt: {
            type: Date,
            default: null
        },

        dataRetentionExpiresAt: {
            type: Date,
            default: null,
            index: true
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

/* ===========================
   Indexes
=========================== */

// Prevent duplicate face profiles per employee within a company
faceSchema.index({ companyId: 1, employeeId: 1 }, { unique: true });

// Compound indexes for common queries
faceSchema.index({ companyId: 1, isEnrolled: 1 });
faceSchema.index({ companyId: 1, enrollmentStatus: 1 });
faceSchema.index({ companyId: 1, isLocked: 1 });
faceSchema.index({ companyId: 1, isSuspicious: 1 });
faceSchema.index({ companyId: 1, flaggedForReview: 1 });

// For data retention cleanup jobs
faceSchema.index({ dataRetentionExpiresAt: 1 }, { sparse: true });

// For finding employees needing reenrollment
faceSchema.index({ enrollmentStatus: 1, lastReEnrolledAt: 1 });

/* ===========================
   Virtuals
=========================== */

// Virtual for active image count
faceSchema.virtual('activeImageCount').get(function () {
    return this.images.filter(img => img.isActive).length;
});

// Virtual for enrollment completion percentage
faceSchema.virtual('enrollmentProgress').get(function () {
    if (this.minRequiredImages === 0) return 100;
    const activeCount = this.activeImageCount;
    return Math.min(Math.round((activeCount / this.minRequiredImages) * 100), 100);
});

/* ===========================
   Pre-save Middleware
=========================== */

// Auto-update enrollment status based on image count
faceSchema.pre('save', function (next) {
    const activeImages = this.images.filter(img => img.isActive).length;
    
    // Update isEnrolled based on active images meeting minimum requirement
    if (this.enrollmentStatus === 'approved') {
        this.isEnrolled = activeImages >= this.minRequiredImages;
        
        if (this.isEnrolled && !this.enrolledAt) {
            this.enrolledAt = new Date();
        }
    }
    
    // Validate that approved status has required images
    if (this.enrollmentStatus === 'approved' && activeImages < this.minRequiredImages) {
        next(new Error(`Approved status requires at least ${this.minRequiredImages} active images, but only ${activeImages} found`));
        return;
    }
    
    next();
});

/* ===========================
   Instance Methods
=========================== */

// Returns only active embeddings, ready to send to the matching microservice
faceSchema.methods.getActiveEmbeddings = function () {
    return this.images
        .filter((img) => img.isActive)
        .map((img) => img.embedding);
};

// Get active images with their metadata
faceSchema.methods.getActiveImages = function () {
    return this.images.filter((img) => img.isActive);
};

// Record a verification attempt and update rolling counters
faceSchema.methods.recordVerification = async function (logEntry) {
    // Validate log entry
    if (!logEntry || typeof logEntry !== 'object') {
        throw new Error('Invalid verification log entry');
    }
    
    if (typeof logEntry.matched !== 'boolean') {
        throw new Error('Log entry must include a matched boolean');
    }
    
    if (typeof logEntry.similarity !== 'number' || isNaN(logEntry.similarity)) {
        throw new Error('Log entry must include a valid similarity score');
    }
    
    // Ensure log entry has required fields
    const verifiedLogEntry = {
        attemptedAt: logEntry.attemptedAt || new Date(),
        matched: logEntry.matched,
        similarity: logEntry.similarity,
        detScore: logEntry.detScore || 0,
        imageUrl: logEntry.imageUrl || null,
        purpose: logEntry.purpose || 'punch_in',
        deviceInfo: logEntry.deviceInfo || {},
        ip: logEntry.ip || null,
        attendanceId: logEntry.attendanceId || null
    };
    
    // Add to verification logs
    this.verificationLogs.push(verifiedLogEntry);
    
    // Update counters
    this.totalVerificationAttempts = (this.totalVerificationAttempts || 0) + 1;
    this.lastVerifiedAt = verifiedLogEntry.attemptedAt;
    
    if (verifiedLogEntry.matched) {
        // Reset consecutive failures on successful match
        this.consecutiveFailedAttempts = 0;
    } else {
        // Increment failure counters
        this.totalFailedAttempts = (this.totalFailedAttempts || 0) + 1;
        this.consecutiveFailedAttempts = (this.consecutiveFailedAttempts || 0) + 1;
    }
    
    // Auto-lock after repeated consecutive failures (fraud/self-protection)
    const MAX_CONSECUTIVE_FAILURES = 5;
    if (this.consecutiveFailedAttempts >= MAX_CONSECUTIVE_FAILURES && !this.isLocked) {
        this.isLocked = true;
        this.lockedAt = new Date();
        this.lockReason = `${MAX_CONSECUTIVE_FAILURES} consecutive failed verification attempts`;
        this.flaggedForReview = true;
    }
    
    // Keep only the most recent 100 logs to prevent unbounded document growth
    if (this.verificationLogs.length > 100) {
        this.verificationLogs = this.verificationLogs.slice(-100);
    }
    
    // Save the document
    return this.save();
};

// Unlock face profile
faceSchema.methods.unlock = function (reason = 'Manual unlock') {
    this.isLocked = false;
    this.lockedAt = null;
    this.lockReason = null;
    this.consecutiveFailedAttempts = 0;
    this.flaggedForReview = false;
    return this.save();
};

// Soft delete an image (set isActive to false)
faceSchema.methods.deactivateImage = function (imageId) {
    const image = this.images.id(imageId);
    if (!image) {
        throw new Error('Image not found');
    }
    image.isActive = false;
    return this.save();
};

// Check if employee needs reenrollment
faceSchema.methods.needsReenrollment = function () {
    const activeImages = this.activeImageCount;
    return this.enrollmentStatus === 'needs_reenrollment' || 
           activeImages < this.minRequiredImages;
};

/* ===========================
   Static Methods
=========================== */

// Find all locked profiles for a company
faceSchema.statics.findLockedProfiles = function (companyId) {
    return this.find({ 
        companyId, 
        isLocked: true 
    }).populate('employeeId', 'firstName lastName employeeId');
};

// Find employees pending enrollment review
faceSchema.statics.findPendingReview = function (companyId) {
    return this.find({ 
        companyId, 
        enrollmentStatus: 'pending_review' 
    }).populate('employeeId', 'firstName lastName employeeId');
};

// Get enrollment statistics for a company
faceSchema.statics.getEnrollmentStats = async function (companyId) {
    return this.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
        { $group: {
            _id: '$enrollmentStatus',
            count: { $sum: 1 }
        }}
    ]);
};

const Face = mongoose.model("Face", faceSchema);
export default Face;