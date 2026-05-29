import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'missed', 'rescheduled'],
            default: 'pending',
        },
        note: {
            type: String,
            trim: true,
        },
    },
    { _id: false }
);

const billSchema = new mongoose.Schema(
    {
        billDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        bill_id: {
            type: String,
            required: true,
        },

        customerName: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        phone: {
            type: String,
            required: true,
            trim: true,
        },

        serviceName: {
            type: String,
            required: true,
            trim: true,
        },

        status: {
            type: String,
            enum: ['draft', 'issued', 'paid', 'overdue', 'cancelled'],
            default: 'issued',
        },
        
        remarks: {
            type: String,
            trim: true,
        },
        followUps: {
            type: [followUpSchema],
            default: [],
        },
        followUpMax: {
            type: Number,
            default: 3,
            min: 0,
        },
        followUpCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        metadata: {
            source: {
                type: String,
                trim: true,
            },
            createdBy: {
                type: String,
                trim: true,
            },
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model('Bill', billSchema);
