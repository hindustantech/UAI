import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskInvitationSchema = new mongoose.Schema({
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
  invitedUserId: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  invitedBy: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
    default: 'PENDING'
  },
  message: {
    type: String,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  respondedAt: Date,
  rejectionReason: {
    type: String,
    maxlength: [500, 'Rejection reason cannot exceed 500 characters']
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
  timestamps: true
});

// Compound index to prevent duplicate pending invitations per company + user + task
taskInvitationSchema.index(
  { companyId: 1, taskId: 1, invitedUserId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

// Index for queries
taskInvitationSchema.index({ invitedUserId: 1, status: 1 });
taskInvitationSchema.index({ taskId: 1, status: 1 });
taskInvitationSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model('TaskInvitation', taskInvitationSchema);