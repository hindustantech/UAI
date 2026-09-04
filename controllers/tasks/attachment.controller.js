import Task from '../../models/tasks/taskModel.js';
import TaskAttachment from '../../models/tasks/taskAttachmentModel.js';
import { createTaskAuditLog } from '../../utils/taskAuditHelper.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';

export const uploadAttachment = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'FILE_REQUIRED', message: 'File is required' }
      });
    }

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/webp'
    ];

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'File type not allowed' }
      });
    }

    const maxSize = 10 * 1024 * 1024;
    if (req.file.size > maxSize) {
      return res.status(400).json({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'File size exceeds 10MB limit' }
      });
    }

    const attachment = await TaskAttachment.create({
      companyId,
      taskId: id,
      uploader: req.user._id,
      fileName: req.file.originalname,
      fileId: req.file.path || req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      accessType: req.body.accessType || 'team'
    });

    await createTaskAuditLog({
      action: 'TASK_ATTACHMENT_UPLOADED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      oldData: {},
      after: { attachmentId: attachment._id, fileName: req.file.originalname },
      metadata: { attachmentId: attachment._id }
    });

    res.json({
      success: true,
      data: attachment
    });
  } catch (error) {
    console.error('Upload attachment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ATTACHMENT_ERROR', message: 'Failed to upload attachment' }
    });
  }
};

export const getAttachments = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const attachments = await TaskAttachment.find({ companyId, taskId: id })
      .populate('uploader', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: attachments.length,
      data: attachments
    });
  } catch (error) {
    console.error('Get attachments error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ATTACHMENTS_ERROR', message: 'Failed to fetch attachments' }
    });
  }
};

export const deleteAttachment = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, attachmentId } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const attachment = await TaskAttachment.findOne({ _id: attachmentId, companyId, taskId: id });
    if (!attachment) {
      return res.status(404).json({
        success: false,
        error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found' }
      });
    }

    if (attachment.uploader.toString() !== req.user._id.toString() &&
        !['super_admin', 'partner', 'admin'].includes(req.user.type)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only delete your own attachments' }
      });
    }

    await TaskAttachment.findByIdAndDelete(attachmentId);

    await createTaskAuditLog({
      action: 'TASK_ATTACHMENT_DELETED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      oldData: { attachmentId, fileName: attachment.fileName },
      after: {},
      metadata: { attachmentId }
    });

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ATTACHMENT_DELETE_ERROR', message: 'Failed to delete attachment' }
    });
  }
};