import dotenv from 'dotenv';
import axios from "axios";
import logger from "./logger.js";

dotenv.config();

const WHATSAPP_API_URL =
    "https://whatsapp.quickhub.ai/public/whatsapp/send-template";

const WHATSAPP_API_KEY = process.env.QUICKHUB_API_KEY;

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
 * Send WhatsApp OTP
 * @param {string} number
 * @param {string|number} code
 */
export const QuicksendWhatsAppOtp = async (number, code) => {
    const formattedNumber = formatPhoneNumber(number);

    logger.info("Attempting to send WhatsApp OTP", {
        original: number,
        formatted: formattedNumber
    });

    try {
        const payload = {
            to: formattedNumber,
            templateName: "otp_auth",
            params: [String(code)],
        };

        logger.info("Sending WhatsApp OTP", {
            number: formattedNumber,
            code
        });

        const response = await axios.post(
            WHATSAPP_API_URL,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${WHATSAPP_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        logger.info("WhatsApp OTP sent successfully", {
            number: formattedNumber,
            response: response.data
        });

        return {
            success: true,
            data: response.data,
        };

    } catch (error) {

        logger.error("WhatsApp OTP Send Error:", {
            number: formattedNumber,
            error: error?.response?.data || error.message
        });

        return {
            success: false,
            error: error?.response?.data || error.message,
        };
    }
}