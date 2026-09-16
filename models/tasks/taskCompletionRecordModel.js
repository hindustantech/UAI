import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskCompletionRecordSchema = new mongoose.Schema({
  companyId: {
    type: ObjectId,
    ref: 'Company',
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
  completionDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['SUBMITTED', 'COMPLETED'],
    default: 'SUBMITTED'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  durationSeconds: {
    type: Number,
    default: 0
  },
  comment: {
    type: String,
    maxlength: [500, 'Comment cannot exceed 500 characters']
  }
}, {
  timestamps: true
});

// Compound indexes for multi-tenant performance
taskCompletionRecordSchema.index({ companyId: 1, taskId: 1, completionDate: 1 });
taskCompletionRecordSchema.index({ companyId: 1, userId: 1, completionDate: 1 });
taskCompletionRecordSchema.index({ companyId: 1, taskId: 1, userId: 1, completionDate: 1 }, { unique: true });

// Method to check if already completed today
taskCompletionRecordSchema.statics.isCompletedToday = async function(taskId, userId, companyId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return this.findOne({
    companyId,
    taskId,
    userId,
    completionDate: { $gte: today, $lt: tomorrow }
  });
};

export default mongoose.model('TaskCompletionRecord', taskCompletionRecordSchema);
