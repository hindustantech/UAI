export const TIER_SCORES = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
  BULK: 4,
};

export const TIER_LABELS = {
  [TIER_SCORES.CRITICAL]: 'critical',
  [TIER_SCORES.HIGH]: 'high',
  [TIER_SCORES.NORMAL]: 'normal',
  [TIER_SCORES.LOW]: 'low',
  [TIER_SCORES.BULK]: 'bulk',
};

export const TIER_NAMES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
  BULK: 'bulk',
};

export const TIER_CONFIG = {
  [TIER_SCORES.CRITICAL]: {
    label: 'critical',
    concurrency: parseInt(process.env.TIER_CRITICAL_CONCURRENCY) || 10,
    rateLimitMax: parseInt(process.env.TIER_CRITICAL_RATE) || 200,
    rateLimitDuration: 60000,
  },
  [TIER_SCORES.HIGH]: {
    label: 'high',
    concurrency: parseInt(process.env.TIER_HIGH_CONCURRENCY) || 5,
    rateLimitMax: parseInt(process.env.TIER_HIGH_RATE) || 100,
    rateLimitDuration: 60000,
  },
  [TIER_SCORES.NORMAL]: {
    label: 'normal',
    concurrency: parseInt(process.env.TIER_NORMAL_CONCURRENCY) || 3,
    rateLimitMax: parseInt(process.env.TIER_NORMAL_RATE) || 50,
    rateLimitDuration: 60000,
  },
  [TIER_SCORES.LOW]: {
    label: 'low',
    concurrency: parseInt(process.env.TIER_LOW_CONCURRENCY) || 2,
    rateLimitMax: parseInt(process.env.TIER_LOW_RATE) || 25,
    rateLimitDuration: 60000,
  },
  [TIER_SCORES.BULK]: {
    label: 'bulk',
    concurrency: parseInt(process.env.TIER_BULK_CONCURRENCY) || 1,
    rateLimitMax: parseInt(process.env.TIER_BULK_RATE) || 10,
    rateLimitDuration: 60000,
  },
};

export const CHANNELS = ['email', 'whatsapp'];

export function makeTierQueueName(channel, tierScore) {
  const label = TIER_LABELS[tierScore];
  if (!label) throw new Error(`Unknown tier score: ${tierScore}`);
  return `${channel}_${label}`;
}

export function parseTierQueueName(queueName) {
  const underscoreIdx = queueName.indexOf('_');
  if (underscoreIdx === -1) return null;
  const channel = queueName.substring(0, underscoreIdx);
  const label = queueName.substring(underscoreIdx + 1);
  const entry = Object.entries(TIER_LABELS).find(([, v]) => v === label);
  if (!entry) return null;
  return { channel, tierScore: parseInt(entry[0]), label };
}

export function getTierScoreForType(notificationType) {
  const typeTierMap = {
    otp: TIER_SCORES.CRITICAL,
    password_reset: TIER_SCORES.CRITICAL,
    subscription_expired: TIER_SCORES.CRITICAL,
    subscription_activated: TIER_SCORES.HIGH,
    subscription_renewed: TIER_SCORES.HIGH,
    login_alert: TIER_SCORES.HIGH,
    absent: TIER_SCORES.HIGH,
    leave_approved: TIER_SCORES.HIGH,
    leave_rejected: TIER_SCORES.HIGH,
    welcome: TIER_SCORES.NORMAL,
    trial_started: TIER_SCORES.NORMAL,
    employee_added: TIER_SCORES.NORMAL,
    employee_removed: TIER_SCORES.NORMAL,
    employee_check_in: TIER_SCORES.NORMAL,
    employee_check_out: TIER_SCORES.NORMAL,
    late_attendance: TIER_SCORES.NORMAL,
    subscription_expiring_soon: TIER_SCORES.NORMAL,
    trial_ending: TIER_SCORES.NORMAL,
    daily_report: TIER_SCORES.LOW,
    weekly_report: TIER_SCORES.LOW,
    monthly_report: TIER_SCORES.LOW,
    meeting_reminder: TIER_SCORES.LOW,
    followup_reminder: TIER_SCORES.BULK,
    visit_reminder: TIER_SCORES.BULK,
  };
  return typeTierMap[notificationType] ?? TIER_SCORES.NORMAL;
}
