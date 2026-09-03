import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema;

const taskAttachmentSchema = new mongoose.Schema({
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
  uploader: {
    type: ObjectId,
    ref: 'User',
    required: true
  },
  fileName: {
    type: String,
    required: [true, 'File name is required']
  },
  fileId: {
    type: String,
    required: [true, 'File ID is required (Cloudinary/S3)']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required']
  },
  size: {
    type: Number,
    required: [true, 'File size is required']
  },
  checksum: {
    type: String,
    default: ''
  },
  accessType: {
    type: String,
    enum: ['private', 'public', 'team'],
    default: 'private'
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
taskAttachmentSchema.index({ companyId: 1, taskId: 1, createdAt: -1 });
taskAttachmentSchema.index({ companyId: 1, uploader: 1, createdAt: -1 });

export default mongoose.model('TaskAttachment', taskAttachmentSchema);