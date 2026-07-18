import mongoose from 'mongoose';

const deadLetterSchema = new mongoose.Schema({
  originalQueue: {
    type: String,
    required: true,
    index: true,
  },
  jobName: String,
  jobId: {
    type: String,
    index: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  error: {
    message: String,
    stack: String,
    code: String,
  },
  retryCount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'retrying', 'resolved', 'permanent_failure'],
    default: 'pending',
    index: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  resolvedAt: Date,
}, {
  timestamps: true,
});

deadLetterSchema.index({ status: 1, createdAt: -1 });

const DeadLetter = mongoose.model('DeadLetter', deadLetterSchema);

export default DeadLetter;
