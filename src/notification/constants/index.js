import { QUEUE_NAMES, NOTIFICATION_TYPES, CHANNELS, JOB_STATUS, PRIORITY } from './enums.js';

export { QUEUE_NAMES, NOTIFICATION_TYPES, CHANNELS, JOB_STATUS, PRIORITY };

export const IDEMPOTENCY_TTL = parseInt(process.env.IDEMPOTENCY_TTL) || 86400;
export const LOCK_TTL = parseInt(process.env.LOCK_TTL) || 60000;
export const LOCK_RETRY_DELAY = parseInt(process.env.LOCK_RETRY_DELAY) || 100;
export const LOCK_RETRY_COUNT = parseInt(process.env.LOCK_RETRY_COUNT) || 20;
export const DEAD_LETTER_MAX_RETRY = parseInt(process.env.DEAD_LETTER_MAX_RETRY) || 5;
export const NOTIFICATION_JOB_REMOVE_COMPLETE = parseInt(process.env.NOTIFICATION_JOB_REMOVE_COMPLETE) || 1000;
export const NOTIFICATION_JOB_REMOVE_FAIL = parseInt(process.env.NOTIFICATION_JOB_REMOVE_FAIL) || 5000;
export const NOTIFICATION_DEFAULT_PRIORITY = parseInt(process.env.NOTIFICATION_DEFAULT_PRIORITY) || 2;
