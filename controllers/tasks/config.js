// Task Management Module Configuration
export const taskConfig = {
  // Supported priorities
  priorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'],

  // Task statuses
  statuses: [
    'DRAFT', 'INVITED', 'ASSIGNED', 'ACCEPTED', 'ACTIVE',
    'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'SUBMITTED',
    'VERIFIED', 'REJECTED', 'REOPENED', 'DEACTIVATED',
    'CANCELLED', 'CLOSED'
  ],

  // Assignment statuses
  assignmentStatuses: ['INVITED', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'REMOVED', 'COMPLETED'],

  // Invitation statuses
  invitationStatuses: ['PENDING', 'ACCEPTED', 'REJECTED'],

  // Work session statuses
  sessionStatuses: ['ACTIVE', 'STOPPED', 'AUTO_STOPPED', 'CANCELLED'],

  // Session sources
  sessionSources: {
    start: ['WEB', 'MOBILE', 'API', 'ATTENDANCE_CHECKOUT'],
    stop: ['USER', 'SYSTEM', 'ATTENDANCE_CHECKOUT']
  },

  // Valid state transitions
  validTransitions: {
    'DRAFT': ['INVITED', 'ASSIGNED'],
    'INVITED': ['ACCEPTED', 'REJECTED'],
    'ASSIGNED': ['ACCEPTED'],
    'ACCEPTED': ['ACTIVE'],
    'ACTIVE': ['IN_PROGRESS', 'DEACTIVATED'],
    'IN_PROGRESS': ['PAUSED', 'BLOCKED', 'SUBMITTED', 'DEACTIVATED'],
    'PAUSED': ['IN_PROGRESS', 'DEACTIVATED'],
    'BLOCKED': ['IN_PROGRESS', 'DEACTIVATED'],
    'SUBMITTED': ['VERIFIED', 'REJECTED'],
    'VERIFIED': ['CLOSED'],
    'REJECTED': ['IN_PROGRESS'],
    'REOPENED': ['IN_PROGRESS'],
    'DEACTIVATED': ['ACTIVE'],
    'CLOSED': ['REOPENED'],
    'CANCELLED': []
  },

  // Allowed attachment MIME types
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp'
  ],

  // Max file size (10MB)
  maxFileSize: 10 * 1024 * 1024,

  // Task number format
  taskNumberPrefix: 'TASK'
};

export default taskConfig;