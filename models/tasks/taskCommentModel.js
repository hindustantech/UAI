import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskCommentSchema = new mongoose.Schema({
  companyId: {
    type: ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  taskId: {
    type: ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  userId: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: [true, 'Comment message is required'],
    maxlength: [2000, 'Comment cannot exceed 2000 characters']
  },
  parentCommentId: {
    type: ObjectId,
    ref: 'TaskComment',
    index: true
  },
  mentions: [{
    userId: {
      type: ObjectId,
      ref: 'User'
    }
  }],
  deletedAt: Date,
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

// Indexes
taskCommentSchema.index({ companyId: 1, taskId: 1, createdAt: -1 });
taskCommentSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
taskCommentSchema.index({ taskId: 1, deletedAt: 1 });

// Method to check if comment is deleted
taskCommentSchema.methods.isDeleted = function() {
  return !!this.deletedAt;
};

export default mongoose.model('TaskComment', taskCommentSchema);