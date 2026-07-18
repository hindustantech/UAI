const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0,
  },

  whatsapp: {
    batchSize: parseInt(process.env.WHATSAPP_BATCH_SIZE) || 30,
    batchInterval: parseInt(process.env.WHATSAPP_BATCH_INTERVAL) || 60000,
    concurrency: parseInt(process.env.WHATSAPP_CONCURRENCY) || 5,
    maxRetry: parseInt(process.env.WHATSAPP_MAX_RETRY) || 5,
    backoff: parseInt(process.env.WHATSAPP_BACKOFF) || 30000,
  },

  email: {
    batchSize: parseInt(process.env.EMAIL_BATCH_SIZE) || 400,
    batchInterval: parseInt(process.env.EMAIL_BATCH_INTERVAL) || 86400000,
    concurrency: parseInt(process.env.EMAIL_CONCURRENCY) || 5,
    maxRetry: parseInt(process.env.EMAIL_MAX_RETRY) || 5,
    backoff: parseInt(process.env.EMAIL_BACKOFF) || 30000,
  },

  notification: {
    jobRemoveComplete: parseInt(process.env.NOTIFICATION_JOB_REMOVE_COMPLETE) || 1000,
    jobRemoveFail: parseInt(process.env.NOTIFICATION_JOB_REMOVE_FAIL) || 5000,
    defaultPriority: parseInt(process.env.NOTIFICATION_DEFAULT_PRIORITY) || 2,
  },

  idempotency: {
    ttl: parseInt(process.env.IDEMPOTENCY_TTL) || 86400,
  },

  lock: {
    ttl: parseInt(process.env.LOCK_TTL) || 60000,
    retryDelay: parseInt(process.env.LOCK_RETRY_DELAY) || 100,
    retryCount: parseInt(process.env.LOCK_RETRY_COUNT) || 20,
  },

  deadLetter: {
    maxRetry: parseInt(process.env.DEAD_LETTER_MAX_RETRY) || 5,
  },
};

export default config;
