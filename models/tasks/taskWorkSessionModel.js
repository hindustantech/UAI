import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskWorkSessionSchema = new mongoose.Schema({
  companyId: {
    type: ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  taskId: {
    type: ObjectId,
    ref: 'Task',
    required: true
  },
  userId: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  assignmentId: {
    type: ObjectId,
    ref: 'TaskAssignment',
    required: true
  },
  startedAt: {
    type: Date,
    required: [true, 'Start time is required']
  },
  stoppedAt: Date,
  durationSeconds: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'STOPPED', 'AUTO_STOPPED', 'CANCELLED'],
    default: 'ACTIVE'
  },
  startSource: {
    type: String,
    enum: ['WEB', 'MOBILE', 'API', 'ATTENDANCE_CHECKOUT'],
    default: 'WEB'
  },
  stopSource: {
    type: String,
    enum: ['USER', 'SYSTEM', 'ATTENDANCE_CHECKOUT']
  },
  stopReason: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for multi-tenant performance
taskWorkSessionSchema.index({ companyId: 1, taskId: 1, userId: 1 });
taskWorkSessionSchema.index({ companyId: 1, userId: 1, status: 1 });
taskWorkSessionSchema.index({ companyId: 1, startedAt: -1 });
taskWorkSessionSchema.index({ companyId: 1, status: 1 });
taskWorkSessionSchema.index({ userId: 1, status: 1 });
taskWorkSessionSchema.index({ companyId: 1, taskId: 1, status: 1 });

// Virtual for is active
taskWorkSessionSchema.virtual('isActive').get(function() {
  return this.status === 'ACTIVE';
});

// Method to calculate duration
taskWorkSessionSchema.methods.calculateDuration = function() {
  if (!this.stoppedAt) return 0;
  return Math.floor((new Date(this.stoppedAt) - new Date(this.startedAt)) / 1000);
};

// Method to stop the session
taskWorkSessionSchema.methods.stop = function(stopSource = 'USER', reason = '') {
  this.stoppedAt = new Date();
  this.status = 'STOPPED';
  this.stopSource = stopSource;
  this.stopReason = reason;
  this.durationSeconds = this.calculateDuration();
  this.updatedAt = new Date();
  return this;
};

export default mongoose.model('TaskWorkSession', taskWorkSessionSchema);