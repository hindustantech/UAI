
import dotenv from 'dotenv';  // <-- make sure you import it
import axios from "axios";
import logger from "./logger.js";
dotenv.config();

const WHATSAPP_API_URL =
    "https://whatsapp.quickhub.ai/public/whatsapp/send-template";

const WHATSAPP_API_KEY = process.env.QUICKHUB_API_KEY;

/**
 * Send WhatsApp OTP
 * @param {string} number - User phone number (with country code)
 * @param {string|number} code - OTP code
 * @returns {Promise<Object>}
 */
export const QuicksendWhatsAppOtp = async (number, code) => {
    logger.info("Attempting to send WhatsApp OTP", { number });
    try {
        const payload = {
            to: number.startsWith("+") ? number : `+${number}`,
            templateName: "otp",
            params: [String(code)],
        };
        logger.info("Sending WhatsApp OTP", { number, code });
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
        logger.info("WhatsApp OTP sent successfully", { number, response: response.data });

        return {
            success: true,
            data: response.data,
        };
    } catch (error) {
        logger.error("WhatsApp OTP Send Error:", { number, error: error?.response?.data || error.message });

        return {
            success: false,
            error: error?.response?.data || error.message,
        };
    }
};
