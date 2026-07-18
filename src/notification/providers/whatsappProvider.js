import axios from 'axios';
import { BaseProvider } from './baseProvider.js';
import { notificationLogger } from '../index.js';

const DEFAULT_API_URL = 'https://whatsapp.quickhub.ai/public/whatsapp/send-template';

class WhatsAppProvider extends BaseProvider {
  constructor() {
    super();
    this.apiUrl = DEFAULT_API_URL;
    this.apiKey = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    this.apiKey = process.env.QUICKHUB_API_KEY || process.env.WHATSAPP_API_TOKEN;
    this.apiUrl = process.env.WHATSAPP_API_URL || DEFAULT_API_URL;

    if (!this.apiKey) {
      notificationLogger.warn('WhatsApp provider: No API key configured');
    }

    this.initialized = true;

    notificationLogger.info('WhatsApp provider initialized', {
      apiUrl: this.apiUrl,
      keyConfigured: !!this.apiKey,
    });
  }

  formatPhoneNumber(number) {
    if (number == null) return null;
    const raw = String(number);
    if (raw.startsWith('+')) return raw;
    let cleaned = raw.replace(/\D/g, '');
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      return `+${cleaned}`;
    }
    const defaultCode = process.env.DEFAULT_COUNTRY_CODE || '91';
    if (cleaned.length === 10) {
      return `+${defaultCode}${cleaned}`;
    }
    return `+${cleaned}`;
  }

  async send({ to, message, templateName, params }) {
    this.initialize();

    if (!to) {
      throw Object.assign(new Error('Recipient phone is required'), { code: 'INVALID_PHONE' });
    }

    if (!this.apiKey) {
      throw Object.assign(new Error('WhatsApp API key not configured'), { code: 'CONFIG_ERROR' });
    }

    const formattedNumber = this.formatPhoneNumber(to);
    if (!formattedNumber) {
      throw Object.assign(new Error(`Invalid phone number: ${to}`), { code: 'INVALID_PHONE' });
    }

    const payload = {
      to: formattedNumber,
      templateName: templateName || 'notification',
      params: params || [message],
    };

    try {
      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      notificationLogger.debug('WhatsApp sent via QuickHub', {
        to: formattedNumber,
        templateName: payload.templateName,
        status: response.status,
      });

      return {
        success: true,
        messageId: response.data?.messageId || response.data?.id,
        data: response.data,
      };
    } catch (error) {
      const statusCode = error.response?.status;
      const responseData = error.response?.data;

      const enhancedError = Object.assign(
        new Error(error.response?.data?.message || error.message),
        {
          code: `WHATSAPP_${statusCode || 'ERROR'}`,
          statusCode: statusCode || 0,
          responseData,
          originalError: error,
        },
      );

      if (statusCode === 400) {
        enhancedError.code = 'INVALID_REQUEST';
      }

      notificationLogger.error('WhatsApp send failed', {
        to: formattedNumber,
        statusCode,
        error: error.message,
        response: responseData,
      });

      throw enhancedError;
    }
  }

  async validate({ to }) {
    if (!to || typeof to !== 'string') {
      return { valid: false, reason: 'Missing or invalid recipient phone' };
    }
    const cleaned = String(to).replace(/\D/g, '');
    if (cleaned.length < 10 || cleaned.length > 15) {
      return { valid: false, reason: 'Invalid phone number length' };
    }
    return { valid: true };
  }

  getChannelName() {
    return 'whatsapp';
  }
}

export const whatsappProvider = new WhatsAppProvider();
export default whatsappProvider;
