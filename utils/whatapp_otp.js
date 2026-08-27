import dotenv from 'dotenv';
import axios from "axios";
import logger from "./logger.js";

dotenv.config();

const WHATSAPP_API_URL =
    "https://whatsapp.quickhub.ai/public/whatsapp/send-template";

const WHATSAPP_API_KEY = process.env.QUICKHUB_API_KEY;

const SMS_API_URL =
    "https://smsmediaapi.patronservices.in/api/sms/send-otp-api";

const SMS_API_KEY = process.env.SMS_API_KEY;

/**
 * Format phone number to E.164
 */
const formatPhoneNumber = (number) => {
    let cleaned = String(number).replace(/\D/g, "");

    // If starts with 91 and length is 12
    if (cleaned.startsWith("91") && cleaned.length === 12) {
        return `+${cleaned}`;
    }

    // If only 10 digit Indian number
    if (cleaned.length === 10) {
        return `+91${cleaned}`;
    }

    // If already has country code
    return `+${cleaned}`;
};

/**
 * Send SMS OTP
 * @param {string} number
 * @param {string|number} code
 */
export const QuicksendWhatsAppOtp = async (number, code) => {
    const cleanedNumber = String(number).replace(/\D/g, "");
    const mobile = cleanedNumber.length === 10
        ? cleanedNumber
        : cleanedNumber.startsWith("91") && cleanedNumber.length === 12
            ? cleanedNumber.slice(2)
            : cleanedNumber;

    logger.info("Attempting to send SMS OTP", {
        original: number,
        mobile: mobile
    });

    try {
        const smstext = `Your OTP is ${code}`;

        const response = await axios.get(SMS_API_URL, {
            params: {
                apikey: SMS_API_KEY,
                senderid: "SMEDIA",
                mobile: mobile,
                smstext: smstext,
                serviceid: 16,
            },
        });

        logger.info("SMS OTP sent successfully", {
            number: mobile,
            response: response.data
        });

        return {
            success: true,
            data: response.data,
        };

    } catch (error) {

        logger.error("SMS OTP Send Error:", {
            number: mobile,
            error: error?.response?.data || error.message
        });

        return {
            success: false,
            error: error?.response?.data || error.message,
        };
    }
}


/**
 * Verify SMS OTP
 * @param {string} otp
 * @param {string} uid
 */
export const Smsotpverify = async (otp, uid) => {
    logger.info("Attempting to verify SMS OTP", { uid, otp });

    try {
        const url = `${SMS_API_URL}/verify-otp-api`;

        const response = await axios.get(url, {
            params: {
                apikey: SMS_API_KEY,
                uid: uid,
                otp: otp,
            },
        });

        logger.info("SMS OTP verified successfully", { uid, response: response.data });

        return {
            success: true,
            data: response.data,
        };
    } catch (error) {
        logger.error("SMS OTP Verify Error:", { uid, error: error?.response?.data || error.message });

        return {
            success: false,
            error: error?.response?.data || error.message,
        };
    }
}
