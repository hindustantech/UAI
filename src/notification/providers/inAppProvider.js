import { BaseProvider } from './baseProvider.js';
import { notificationLogger } from '../logs/index.js';

class InAppProvider extends BaseProvider {
  constructor() {
    super();
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    notificationLogger.info('In-app provider initialized (stub — no active implementation)');
  }

  async send({ userId, title, body, data }) {
    this.initialize();
    notificationLogger.warn('In-app provider is a stub — no notification stored', { userId });
    throw Object.assign(
      new Error('In-app notification provider not yet implemented'),
      { code: 'NOT_IMPLEMENTED' },
    );
  }

  async validate() {
    return { valid: true, warning: 'In-app not yet implemented' };
  }

  getChannelName() {
    return 'in_app';
  }

  isAvailable() {
    return false;
  }
}

export const inAppProvider = new InAppProvider();
export default inAppProvider;
