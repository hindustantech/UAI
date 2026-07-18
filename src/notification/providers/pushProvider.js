import { BaseProvider } from './baseProvider.js';
import { notificationLogger } from '../index.js';
import { isChannelEnabled } from '../utils/channelManager.js';

class PushProvider extends BaseProvider {
  constructor() {
    super();
    this.fcmAdmin = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    notificationLogger.info('Push provider initialized (FCM)');
  }

  async getFirebaseAdmin() {
    try {
      const { default: admin } = await import('../../../utils/firebaseadmin.js');
      return admin;
    } catch (error) {
      notificationLogger.error('Failed to load Firebase Admin', { error: error.message });
      return null;
    }
  }

  async send({ deviceToken, title, body, data }) {
    this.initialize();

    if (!deviceToken) {
      throw Object.assign(new Error('Device token is required'), { code: 'INVALID_TOKEN' });
    }

    const admin = await this.getFirebaseAdmin();
    if (!admin) {
      throw Object.assign(new Error('Firebase Admin not available'), { code: 'CONFIG_ERROR' });
    }

    const message = {
      token: deviceToken,
      notification: { title, body },
      data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
    };

    try {
      const response = await admin.messaging().send(message);

      notificationLogger.debug('Push notification sent', {
        token: deviceToken?.substring(0, 20),
        title,
        response,
      });

      return { success: true, messageId: response };
    } catch (error) {
      const enhancedError = Object.assign(
        new Error(error.message),
        {
          code: error.code || 'PUSH_SEND_FAILED',
          originalError: error,
        },
      );

      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        enhancedError.code = 'INVALID_TOKEN';
      }

      notificationLogger.error('Push notification failed', {
        error: error.message,
        code: error.code,
      });

      throw enhancedError;
    }
  }

  async sendMulticast({ tokens, title, body, data }) {
    this.initialize();

    if (!tokens || tokens.length === 0) {
      throw Object.assign(new Error('At least one device token is required'), { code: 'INVALID_TOKEN' });
    }

    const admin = await this.getFirebaseAdmin();
    if (!admin) {
      throw Object.assign(new Error('Firebase Admin not available'), { code: 'CONFIG_ERROR' });
    }

    const message = {
      tokens,
      notification: { title, body },
      data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);

      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          if (resp.error?.code === 'messaging/invalid-registration-token' ||
              resp.error?.code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      notificationLogger.info('Multicast push sent', {
        total: tokens.length,
        success: response.successCount,
        failure: response.failureCount,
        invalidTokens: invalidTokens.length,
      });

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error) {
      notificationLogger.error('Multicast push failed', { error: error.message });
      throw error;
    }
  }

  async validate({ deviceToken }) {
    if (!deviceToken || typeof deviceToken !== 'string') {
      return { valid: false, reason: 'Missing or invalid device token' };
    }
    if (deviceToken.length < 20) {
      return { valid: false, reason: 'Device token too short' };
    }
    return { valid: true };
  }

  getChannelName() {
    return 'push';
  }

  isAvailable() {
    return isChannelEnabled('push');
  }
}

export const pushProvider = new PushProvider();
export default pushProvider;
