import mongoose from 'mongoose';
import moment from 'moment';

const { ObjectId } = mongoose.Schema;

const taskSchema = new mongoose.Schema({
  companyId: {
    type: ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  taskNumber: {
    type: String,
    required: [true, 'Task number is required'],
  },
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true
  },

  priority: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'],
    default: 'MEDIUM'
  },
  status: {
    type: String,
    enum: [
      'DRAFT', 'INVITED', 'ASSIGNED', 'ACCEPTED', 'ACTIVE',
      'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'SUBMITTED',
      'VERIFIED', 'REJECTED', 'REOPENED', 'DEACTIVATED',
      'CANCELLED', 'CLOSED'
    ],
    default: 'DRAFT'
  },
  createdBy: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  ownerId: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  assignedUsers: [{
    type: ObjectId,
    ref: 'User'
  }],
  startDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    validate: {
      validator: function(value) {
        return !this.startDate || moment(value).isSameOrAfter(moment(this.startDate));
      },
      message: 'Due date must be after start date'
    }
  },
  estimatedDurationSeconds: {
    type: Number,
    default: 0
  },
  actualDurationSeconds: {
    type: Number,
    default: 0
  },
  completedAt: Date,
  completedBy: {
    type: ObjectId,
    ref: 'User'
  },
  submittedAt: {
    type: Date
  },
  submittedBy: {
    type: ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  verifiedBy: {
    type: ObjectId,
    ref: 'User'
  },
  closedAt: Date,
  closedBy: {
    type: ObjectId,
    ref: 'User'
  },
  activatedAt: Date,
  activatedBy: {
    type: ObjectId,
    ref: 'User'
  },
  deactivatedAt: Date,
  deactivatedBy: {
    type: ObjectId,
    ref: 'User'
  },
  deletedAt: Date,
  deletedBy: {
    type: ObjectId,
    ref: 'User'
  },
  version: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for multi-tenant performance (1k+ tasks)
taskSchema.index({ companyId: 1, status: 1 });
taskSchema.index({ companyId: 1, priority: 1 });
taskSchema.index({ companyId: 1, dueDate: 1 });
taskSchema.index({ companyId: 1, createdBy: 1 });
taskSchema.index({ companyId: 1, ownerId: 1 });
taskSchema.index({ companyId: 1, taskNumber: 1 }, { unique: true });
taskSchema.index({ companyId: 1, createdAt: -1 });
taskSchema.index({ companyId: 1, status: 1, priority: 1 });
taskSchema.index({ companyId: 1, status: 1, dueDate: 1 });
taskSchema.index({ assignedUsers: 1, status: 1 });
taskSchema.index({ companyId: 1, deletedAt: 1 });

// Virtual for task age
taskSchema.virtual('ageInDays').get(function() {
  if (!this.createdAt) return 0;
  return moment().diff(moment(this.createdAt), 'days');
});

// Virtual for isOverdue
taskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.status === 'CLOSED' || this.status === 'CANCELLED') return false;
  return moment().isAfter(moment(this.dueDate));
});

// Virtual for time variance
taskSchema.virtual('timeVariance').get(function() {
  if (this.estimatedDurationSeconds <= 0 || this.actualDurationSeconds <= 0) return 0;
  return this.actualDurationSeconds - this.estimatedDurationSeconds;
});

// Virtual for formatted actual duration
taskSchema.virtual('formattedActualDuration').get(function() {
  if (this.actualDurationSeconds <= 0) return '0m';
  const hours = Math.floor(this.actualDurationSeconds / 3600);
  const minutes = Math.floor((this.actualDurationSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
});

// Virtual for formatted estimated duration
taskSchema.virtual('formattedEstimatedDuration').get(function() {
  if (this.estimatedDurationSeconds <= 0) return '0m';
  const hours = Math.floor(this.estimatedDurationSeconds / 3600);
  const minutes = Math.floor((this.estimatedDurationSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
});

// Pre-save to generate taskNumber if not provided
taskSchema.pre('save', async function (next) {
  if (!this.taskNumber) {
    // Generate company-scoped task number
    const count = await mongoose.model('Task').countDocuments({ companyId: this.companyId });
    this.taskNumber = `TASK-${String(count + 1).padStart(4, '0')}`;
  }
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Task', taskSchema);