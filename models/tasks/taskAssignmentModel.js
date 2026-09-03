import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskAssignmentSchema = new mongoose.Schema({
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
  assignedBy: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['INVITED', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'REMOVED', 'COMPLETED'],
    default: 'INVITED'
  },
  acceptedAt: Date,
  rejectedAt: Date,
  rejectionReason: {
    type: String,
    maxlength: [500, 'Rejection reason cannot exceed 500 characters']
  },
  startedAt: Date,
  completedAt: Date,
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

// Compound indexes for multi-tenant performance
taskAssignmentSchema.index({ companyId: 1, taskId: 1, userId: 1 }, { unique: true });
taskAssignmentSchema.index({ companyId: 1, userId: 1, status: 1 });
taskAssignmentSchema.index({ companyId: 1, taskId: 1, status: 1 });
taskAssignmentSchema.index({ userId: 1, status: 1 });
taskAssignmentSchema.index({ companyId: 1, createdAt: -1 });

// Method to check if assignment is active
taskAssignmentSchema.methods.isActive = function() {
  return ['INVITED', 'ASSIGNED', 'ACCEPTED'].includes(this.status);
};

// Method to check if assignment is accepted
taskAssignmentSchema.methods.isAccepted = function() {
  return this.status === 'ACCEPTED';
};

// Method to check if assignment is rejected
taskAssignmentSchema.methods.isRejected = function() {
  return this.status === 'REJECTED';
};

// Pre-save logic
taskAssignmentSchema.pre('save', function (next) {
  // If status is ACCEPTED and acceptedAt is not set, set it
  if (this.status === 'ACCEPTED' && !this.acceptedAt) {
    this.acceptedAt = new Date();
  }
  // If status is REJECTED and rejectedAt is not set, set it
  if (this.status === 'REJECTED' && !this.rejectedAt) {
    this.rejectedAt = new Date();
  }
  next();
});

export default mongoose.model('TaskAssignment', taskAssignmentSchema);