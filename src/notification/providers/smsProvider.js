import { BaseProvider } from './baseProvider.js';
import { notificationLogger } from '../logs/index.js';

class SMSProvider extends BaseProvider {
  constructor() {
    super();
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    notificationLogger.info('SMS provider initialized (stub — no active implementation)');
  }

  async send({ to, message }) {
    this.initialize();
    notificationLogger.warn('SMS provider is a stub — no message sent', { to });
    throw Object.assign(
      new Error('SMS provider not yet implemented'),
      { code: 'NOT_IMPLEMENTED' },
    );
  }

  async validate({ to }) {
    if (!to) return { valid: false, reason: 'Missing phone number' };
    return { valid: true, warning: 'SMS not yet implemented' };
  }

  getChannelName() {
    return 'sms';
  }

  isAvailable() {
    return false;
  }
}

export const smsProvider = new SMSProvider();
export default smsProvider;
