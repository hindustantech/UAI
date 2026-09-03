import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskStatusHistorySchema = new mongoose.Schema({
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
  fromStatus: {
    type: String,
    required: true
  },
  toStatus: {
    type: String,
    required: true
  },
  changedBy: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  reason: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for queries
taskStatusHistorySchema.index({ companyId: 1, taskId: 1, createdAt: -1 });
taskStatusHistorySchema.index({ companyId: 1, changedBy: 1, createdAt: -1 });
taskStatusHistorySchema.index({ companyId: 1, toStatus: 1, createdAt: -1 });

export default mongoose.model('TaskStatusHistory', taskStatusHistorySchema);