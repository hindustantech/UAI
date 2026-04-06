// models/Permission.js
import { Schema, model } from 'mongoose';
import User from './userModel.js';
const DEFAULT_ACTIONS = [
    'create', 'read', 'update', 'delete',
    'list', 'export', 'import',
    'manage', 'approve', 'assign'
];

const PermissionSchema = new Schema({
    resource: { type: String, required: true, trim: true, index: true },
    action: { type: String, required: true, trim: true, enum: DEFAULT_ACTIONS },
    name: { type: String, trim: true },
    key: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '' },
    system: { type: Boolean, default: false },
    meta: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

PermissionSchema.index({ resource: 1, action: 1 }, { unique: true });

PermissionSchema.pre('validate', function (next) {
    if (this.resource && this.action) {
        this.key = `${this.resource}.${this.action}`.toLowerCase();
        if (!this.name) this.name = `${this.resource} ${this.action}`;
    }
    next();
});

// ✅ After saving a new permission, assign it to all super_admin users automatically
PermissionSchema.post('save', async function (doc) {
    try {
        const superAdmins = await User.find({ type: 'super_admin' });
        const permissionKey = doc.key;

        for (const admin of superAdmins) {
            if (!admin.permissions.includes(permissionKey)) {
                admin.permissions.push(permissionKey);
                await admin.save();
                console.log(`Assigned permission ${permissionKey} to super_admin ${admin.email}`);
            }
        }
    } catch (err) {
        console.error('Error assigning permission to super_admin:', err);
    }
});

PermissionSchema.statics.generateForResources = function (resources, actions = DEFAULT_ACTIONS) {
    if (!Array.isArray(resources)) resources = [resources];
    const perms = [];
    for (const r of resources) {
        for (const a of actions) {
            const resource = String(r).trim().toLowerCase();
            const action = String(a).trim().toLowerCase();
            perms.push({
                resource,
                action,
                key: `${resource}.${action}`,
                name: `${resource} ${action}`,
                description: ''
            });
        }
    }
    return perms;
};

PermissionSchema.statics.ensurePermissions = async function (resources, actions = DEFAULT_ACTIONS, opts = {}) {
    const perms = this.generateForResources(resources, actions);
    if (!perms.length) return { inserted: 0 };
    const ops = perms.map(p => ({
        updateOne: {
            filter: { key: p.key },
            update: { $setOnInsert: { ...p, system: !!opts.system } },
            upsert: true
        }
    }));
    const result = await this.bulkWrite(ops);

    // Assign new permissions to super_admin dynamically
    const superAdmins = await User.find({ type: 'super_admin' });
    const allKeys = perms.map(p => p.key);
    for (const admin of superAdmins) {
        const newKeys = allKeys.filter(k => !admin.permissions.includes(k));
        if (newKeys.length) {
            admin.permissions.push(...newKeys);
            await admin.save();
            console.log(`Assigned new permissions to super_admin ${admin.email}:`, newKeys);
        }
    }

    return result;
};

export default model('Permission', PermissionSchema);
