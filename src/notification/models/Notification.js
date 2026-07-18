import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    index: true,
  },
  channel: {
    type: String,
    enum: ['email', 'whatsapp', 'sms', 'push', 'in_app'],
    required: true,
    index: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  recipient: {
    email: String,
    phone: String,
    deviceToken: String,
  },
  subject: String,
  body: String,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  idempotencyKey: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },
  jobId: {
    type: String,
    index: true,
  },
  status: {
    type: String,
    enum: ['queued', 'started', 'retry', 'success', 'failed', 'dead_letter', 'duplicate_skipped', 'rate_limited'],
    default: 'queued',
    index: true,
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
  priority: {
    type: Number,
    default: 2,
    min: 0,
    max: 4,
  },
  sentAt: Date,
  readAt: Date,
}, {
  timestamps: true,
});

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ status: 1, createdAt: -1 });
notificationSchema.index({ companyId: 1, type: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
