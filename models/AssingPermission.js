import mongoose, { Schema } from 'mongoose';
import User from './userModel.js';
import Permission from './Permission.js';

export const APPROVAL_SCOPE_TYPES = ['department', 'departments', 'company'];

export const normalizeDepartmentList = (values = []) => {
    const seen = new Set();
    const result = [];

    for (const value of Array.isArray(values) ? values : []) {
        if (value === undefined || value === null) continue;
        const cleaned = String(value).replace(/\s+/g, ' ').trim();
        if (!cleaned) continue;

        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(cleaned);
    }

    return result;
};

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
    approvalScope: {
        type: {
            type: String,
            enum: APPROVAL_SCOPE_TYPES,
            default: 'department'
        },
        departments: [{
            type: String,
            trim: true
        }]
    },
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

// Normalize the approval scope before validation
AssingPermissionSchema.pre('validate', function (next) {
    if (this.approvalScope) {
        if (!APPROVAL_SCOPE_TYPES.includes(this.approvalScope.type)) {
            this.approvalScope.type = 'department';
        }

        if (this.approvalScope.type === 'company') {
            this.approvalScope.departments = [];
        } else {
            const departments = normalizeDepartmentList(
                this.approvalScope.departments
            );

            if (this.approvalScope.type === 'departments' && departments.length === 0) {
                this.approvalScope.type = 'department';
            }

            this.approvalScope.departments = departments;
        }
    }

    next();
});

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
    session = null,
    approvalScope = null
) {
    const update = {
        $addToSet: { permissions: permissionKey },
        $setOnInsert: { assignedBy }
    };

    if (approvalScope) {
        update.$set = { approvalScope };
    }

    return this.findOneAndUpdate(
        { companyId, userId },
        update,
        {
            new: true,
            upsert: true,
            session,
            runValidators: true
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
