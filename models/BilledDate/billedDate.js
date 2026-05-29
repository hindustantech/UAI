import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: true,
            default: Date.now,
        },
        status: {
            type: String,
            enum: ['pending', 'sent', 'failed', 'skipped'],
            default: 'pending',
        },
        note: {
            type: String,
            trim: true,
        },
        reminderType: {
            type: String,
            enum: ['whatsapp', 'sms', 'call', 'manual'],
            default: 'whatsapp',
        },
    },
    { _id: true, timestamps: false }  // Give _id to track individual follow-ups
);

const billSchema = new mongoose.Schema(
    {
        billDate: {
            type: Date,
            required: true,
        },
        bill_id: {
            type: String,
            required: true,
            unique: true,  // Bill ID should be unique
            index: true,
        },
        customerName: {
            type: String,
            required: true,
            trim: true,
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
        // Store base service name for easy grouping
        baseServiceName: {
            type: String,
            trim: true,
            index: true,
        },
        staffName: {
            type: String,
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['draft', 'issued', 'paid', 'overdue', 'cancelled'],
            default: 'issued',
            index: true,
        },
        remarks: {
            type: String,
            trim: true,
        },
        followUps: [followUpSchema],
        followUpMax: {
            type: Number,
            default: 3,
            min: 0,
            max: 10,
        },
        followUpCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        // Track reminder status separately
        reminderStatus: {
            type: String,
            enum: ['pending', 'skipped', 'sent', 'max_reached', 'not_needed'],
            default: 'pending',
            index: true,
        },
        lastReminderSentAt: {
            type: Date,
        },
        nextReminderDate: {
            type: Date,
        },
        // Service interval in days
        serviceIntervalDays: {
            type: Number,
            default: 30,
        },
        metadata: {
            source: {
                type: String,
                trim: true,
                default: 'manual',
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

// Compound indexes for common queries
billSchema.index({ phone: 1, baseServiceName: 1 });  // Grouping query
billSchema.index({ phone: 1, status: 1 });            // Customer bills
billSchema.index({ reminderStatus: 1, nextReminderDate: 1 }); // Reminder jobs
billSchema.index({ billDate: -1 });                    // Sort by date
billSchema.index({ createdAt: -1 });                   // Recent bills

// Pre-save middleware to extract baseServiceName and staffName
billSchema.pre('save', function(next) {
    if (this.isModified('serviceName')) {
        const extracted = extractServiceInfo(this.serviceName);
        this.baseServiceName = extracted.baseName;
        this.staffName = extracted.staffName;
        
        // Set service interval if not already set
        if (!this.serviceIntervalDays) {
            this.serviceIntervalDays = getDefaultServiceDays(this.baseServiceName);
        }
    }
    
    // Calculate next reminder date based on billDate + serviceIntervalDays
    if (this.isModified('billDate') || this.isModified('serviceIntervalDays')) {
        const nextDate = new Date(this.billDate);
        nextDate.setDate(nextDate.getDate() + this.serviceIntervalDays);
        this.nextReminderDate = nextDate;
    }
    
    next();
});

// Pre-find and update middleware
billSchema.pre('findOneAndUpdate', function(next) {
    const update = this.getUpdate();
    
    // If followUps are being pushed, increment followUpCount
    if (update.$push && update.$push.followUps) {
        if (!update.$inc) update.$inc = {};
        update.$inc.followUpCount = 1;
        this.setUpdate(update);
    }
    
    next();
});

// Helper function to extract service info
function extractServiceInfo(fullServiceName) {
    if (!fullServiceName) return { baseName: '', staffName: '' };
    
    // Handle HTML entities
    let cleaned = fullServiceName.replace(/&amp;/g, '&');
    
    // Split by " - " to get service and staff
    const parts = cleaned.split(' - ');
    
    let baseName = parts[0]
        .replace(/\(Service\)/gi, '')
        .trim();
    
    let staffName = parts.length > 1 ? parts[1].trim() : '';
    
    return { baseName, staffName };
}

// Helper function for default service days
function getDefaultServiceDays(baseServiceName) {
    const serviceDaysMap = {
        'Hair Cut- Men': 30,
        'Hair Cut- Ladies': 90,
        'Special hair Cut': 90,
        'Happy Child Cut - Boy': 90,
        'Happy Child Cut - Girl': 30,
        'Hair Colour M': 30,
        'Hair Colour F': 30,
        'Root Touch Up- Ammonia Free': 21,
        'Root Touch Up- With Ammonia': 30,
        'With Ammonia Hair Colour (M) F': 30,
        'With Ammonia Hair Colour (L) F': 30,
        'Ammonia Free Hair Colour (L) F': 30,
        'Highlights- 2 Streak': 60,
        'Highlights- 4 Streak And Multiple': 60,
        'Highlights- Global (Medium Hair)': 60,
        'Hair Botox (F) Long': 90,
        'Hair Fibre Repair ( M )': 60,
        'Hair Fibre Repair ( L )': 60,
        'Hair Straightening (Medium Hair)': 120,
        'Anti Dandruff Hair Treatment': 30,
        'Damaged/Freezy Detox Treatment ( L) Women': 60,
        'Destree SPA F (Medium Hair)': 45,
        'Destree SPA F (Long Hair)': 45,
        'Head Message (With Wash) (Olive Oil)': 15,
        'Hair wash - (Shampoo)': 7,
        'Hair Wash': 7,
        'Hair Wash with Deep Conditioning - Medium (F)': 15,
        'Blow Dry- Medium Hair': 7,
        'Hair Styling (Ironing / Tongs)- Medium Hair': 15,
        'Threading upperlips': 15,
        'Threading Forehead': 15,
        'Threading eyebrows': 15,
        'Threading Chin': 15,
        'Threading full face': 15,
        'Waxing full arms Rica': 30,
        'Waxing full legs Rica': 30,
        'Waxing half legs Rica': 30,
        'Waxing under arms Rica': 30,
        'Waxing upper lip Rica': 15,
        'Waxing chin Rica': 15,
        'Waxing face wax rica': 15,
        'Face D Tan': 30,
        'D-Tan full hand bleach': 30,
        'D-tan half back': 30,
        'Full leg D-tan': 30,
        'Neck D Tan': 30,
        'Advance (Whitening / Radiance)': 30,
        'Advance Facial (O3+/Bridal/Groom/Organic)': 45,
        'Destress Trendy Facial': 45,
        'Young Radiance': 45,
        'Glow Enhance Cleanup O3+': 30,
        'Good Bye Tan Cleanup O3+': 30,
        'Tangy Cleanup': 30,
        'O3+ Professional': 45,
        'Ultimo Diamond Glow Facial': 45,
        'Regular Manicure(40m)': 30,
        'Regular Pedicure (60m)': 30,
        'Signature Manicure (60m)': 45,
        'Signature pedicure': 45,
        'Artificial Nails': 30,
        'Package A': 30,
        'Package B': 30,
        'Package C': 30,
        'Package 1': 30,
        'Package 2': 30,
        'Additional Service': 30,
    };
    
    return serviceDaysMap[baseServiceName] || 30;
}

// Static methods for reminder queries
billSchema.statics.findDueForReminder = function() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return this.find({
        status: { $ne: 'cancelled' },
        reminderStatus: 'pending',
        followUpCount: { $lt: 3 },  // Hardcoded or use $expr if needed
        nextReminderDate: { $lte: today },
        billDate: { 
            $gte: new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)  // Not older than 365 days
        }
    }).sort({ nextReminderDate: 1 });
};

// Method to mark reminder as sent
billSchema.methods.markReminderSent = function(status = 'sent', note = '') {
    this.followUps.push({
        date: new Date(),
        status: status,
        note: note,
        reminderType: 'whatsapp'
    });
    
    this.followUpCount = this.followUps.length;
    this.lastReminderSentAt = new Date();
    
    if (this.followUpCount >= this.followUpMax) {
        this.reminderStatus = 'max_reached';
    } else {
        this.reminderStatus = 'sent';
        // Set next reminder for 3 days later
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + 3);
        this.nextReminderDate = nextDate;
    }
    
    return this.save();
};

// Method to skip reminder (customer has recent service)
billSchema.methods.skipReminder = function(note = 'Customer has recent service') {
    this.reminderStatus = 'skipped';
    this.followUps.push({
        date: new Date(),
        status: 'skipped',
        note: note,
        reminderType: 'whatsapp'
    });
    
    return this.save();
};

const Bill = mongoose.model('Bill', billSchema);

export default Bill;
export { extractServiceInfo, getDefaultServiceDays };