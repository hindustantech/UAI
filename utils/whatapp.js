import dotenv from 'dotenv';  // <-- make sure you import it
import axios from "axios";
import User from '../models/userModel.js';
import logger from "./logger.js";

import crypto from "crypto";

dotenv.config();


export const generateOTP = () => {
    return crypto.randomInt(1000, 10000).toString();
};



const QUICKHUB_API_KEY = process.env.QUICKHUB_API_KEY;
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;
const WHATSAPP_SEND = process.env.WHATSAPP_SEND_OTP_URL;
const WHATSAPP_VERIFY = process.env.WHATSAPP_VERIFY_OTP_URL;
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME;



export async function sendWhatsAppOtp(mobile) {
    const number = mobile;
    try {


        const url = `https://smsmediaapi.patronservices.in/api/whatsapp-cloud-api/send-auth-api?apikey=${WHATSAPP_API_KEY}&mobile=${number}&templatename=${WHATSAPP_TEMPLATE_NAME}`;

        const resp = await axios.get(url, {
            headers: { Accept: "application/json" },
            timeout: 30000,
        });


        // Extract the response data properly
        const responseData = resp.data;
        return {
            success: true,
            data: responseData,
        };
    } catch (err) {


        return {
            success: false,
            error: err?.response?.data || err.message,
            data: null,
            uid: null
        };
    }
}



// Verify OTP
export async function verifyWhatsAppOtp(uid, otp) {
    try {


        const url = `${WHATSAPP_VERIFY}?apikey=${WHATSAPP_API_KEY}&uid=${uid}&otp=${otp}`;

        const resp = await axios.get(url, {
            headers: { Accept: "application/json" },
            timeout: 30000,
        });

        const data = resp?.data || {};



        return {
            success: true,
            data,
        };
    } catch (err) {


        return {
            success: false,
            error: err?.response?.data || err.message,
        };
    }
}



