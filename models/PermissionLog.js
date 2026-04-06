import mongoose from 'mongoose';

const PermissionLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true

    },
    permissionKey: {
        type: String,
        required: true

    },
    actionType: {
        type: String,
        enum: ['ASSIGNED', 'REMOVED'],
        required: true
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', required: true

    },
    note: {
        type: String,
        default: ''

    }
}, { timestamps: true });

export default mongoose.model('PermissionLog', PermissionLogSchema);
