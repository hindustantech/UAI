import mongoose, { Schema } from 'mongoose';
import User from './userModel.js';
import Permission from './Permission.js';

const AssingPermissionSchema = new Schema({
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    permissions: [
        {
            type: String,
            lowercase: true, // ensure keys like 'user.create' are always lowercase
            trim: true,
        }
    ],
    assignedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Compound unique index to prevent duplicate assignments per company-user
AssingPermissionSchema.index({ companyId: 1, userId: 1 }, { unique: true });

// Validate permissions exist
AssingPermissionSchema.pre('save', async function (next) {
    if (this.permissions.length > 0) {
        const existing = await Permission.find({ key: { $in: this.permissions } });
        const validKeys = existing.map(p => p.key);
        const invalid = this.permissions.filter(p => !validKeys.includes(p));
        if (invalid.length > 0) {
            return next(new Error(`Invalid permissions: ${invalid.join(', ')}`));
        }
    }
    next();
});

// Sync to user.permissions (optional, for backward compat)
AssingPermissionSchema.post('save', async function (doc) {
    const user = await User.findById(doc.userId);
    if (user) {
        user.permissions = [...new Set([...user.permissions, ...doc.permissions])];
        await user.save();
    }
});

AssingPermissionSchema.statics.getUserPermissions = function (companyId, userId) {
    return this.findOne({ companyId, userId })
        .populate('assignedBy', 'name email')
        .lean();
};

AssingPermissionSchema.statics.assignToUser = async function (
    companyId,
    userId,
    permissionKey,
    assignedBy,
    session = null
) {
    return this.findOneAndUpdate(
        { companyId, userId },
        {
            $addToSet: { permissions: permissionKey },
            $setOnInsert: { assignedBy }
        },
        {
            new: true,
            upsert: true,
            session
        }
    );
};
AssingPermissionSchema.statics.removeFromUser = async function (
    companyId,
    userId,
    permissionKey,
    session = null
) {
    return this.findOneAndUpdate(
        { companyId, userId },
        {
            $pull: { permissions: permissionKey }
        },
        { new: true, session }
    );
};

export default mongoose.model('AssingPermission', AssingPermissionSchema);
