import nodemailer from 'nodemailer';
import { BaseProvider } from './baseProvider.js';
import { notificationLogger } from '../logs/index.js';

class EmailProvider extends BaseProvider {
  constructor() {
    super();
    this.transporter = null;
    this._initPromise = null;
  }

  initialize() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 465,
        secure: (process.env.SMTP_PORT || '465') === '465',
        auth: {
          user: process.env.SMTP_USER || process.env.EMAIL_USER,
          pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
        },
      });

      transporter.on('error', (err) => {
        // notificationLo   gger.error('SMTP transporter error', { error: err.message });
        if (this.transporter) {
          this.transporter.close().catch(() => {});
        }
        this.transporter = null;
        this._initPromise = null;
      });

      await transporter.verify();

      this.transporter = transporter;
      this.fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_ID || '"UAI Notifications" <noreply@uai.app>';

      notificationLogger.info('Email provider initialized', {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        from: this.fromAddress,
      });
    })();

    return this._initPromise;
  }

  async send({ to, subject, html, text }) {
    await this.initialize();

    if (!to) {
      throw Object.assign(new Error('Recipient email is required'), { code: 'INVALID_EMAIL' });
    }

    const mailOptions = {
      from: this.fromAddress,
      to,
      subject,
      html,
      text,
      timeout: 10000,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);

      notificationLogger.debug('Email sent via SMTP', {
        to,
        messageId: info.messageId,
        response: info.response?.substring(0, 100),
      });

      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      };
    } catch (error) {
      const enhancedError = Object.assign(
        new Error(error.message),
        {
          code: error.code || 'EMAIL_SEND_FAILED',
          statusCode: error.statusCode || error.responseCode,
          originalError: error,
        },
      );

      notificationLogger.error('Email send failed', {
        to,
        error: error.message,
        code: error.code,
      });

      throw enhancedError;
    }
  }

  async validate({ to }) {
    if (!to || typeof to !== 'string') {
      return { valid: false, reason: 'Missing or invalid recipient email' };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return { valid: false, reason: 'Invalid email format' };
    }
    return { valid: true };
  }

  getChannelName() {
    return 'email';
  }
}

export const emailProvider = new EmailProvider();
export default emailProvider;
