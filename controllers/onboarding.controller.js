// controllers/onboarding.controller.js

import Onboarding from "../models/Onboarding.js";
import Lead from '../models/uaileads.js';
import { sendEmail } from '../utils/mail.js';


// Add before sending
const formatPhoneNumber = (phone) => {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    // Add country code if missing (e.g., India)
    if (!cleaned.startsWith('91') && cleaned.length === 10) {
        cleaned = '+91' + cleaned;
    }
    return cleaned;
};

// Use in your functions
const sendUAIWelcomeTemplate = async (phone, customerName) => {
    const API_KEY = process.env.QUICKHUB_API_KEY;
    const API_URL = 'https://whatsapp.quickhub.ai/public/whatsapp/send-template';

    const formattedPhone = formatPhoneNumber(phone);

    // Your approved template name
    const templateName = 'uai_first'; // Replace with your actual template name

    const payload = {
        "to": formattedPhone,
        "templateName": templateName,
        "variables": {
            "body": {
                "Customer name": customerName
                // The template will automatically include:
                // - 3 solutions info
                // - Play Store link
                // - Reply options (1, 2, 3)
            }
        }
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`✅ UAI welcome message sent to ${phone}`);
            return { success: true, data };
        } else {
            console.error(`❌ Failed:`, data);
            return { success: false, error: data };
        }
    } catch (error) {
        console.error(`❌ Error:`, error);
        return { success: false, error: error.message };
    }
};


const salesEmails = [
    "pathakhemanga4@gmail.com",
    "praecorehr@gmail.com",
    // "manager@uattendance.in",
];



export const createOnboarding = async (req, res) => {
    try {
        const {
            personalInfo: { name, email, phone } = {},
            company: { name: companyName } = {},
        } = req.body;

        // Validation
        if (!name || !email || !phone || !companyName) {
            return res.status(400).json({
                success: false,
                message:
                    "Name, email, phone, and company name are required.",
            });
        }

        // Check existing email
        const existingUser = await Onboarding.findOne({
            "personalInfo.email": email.toLowerCase(),
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Email already exists.",
            });
        }

        // Create onboarding record
        const onboarding = await Onboarding.create({
            personalInfo: {
                name,
                email: email.toLowerCase(),
                phone,
            },
            company: {
                name: companyName,
            },
            onboarding: {
                status: "pending",
            },
        });
        const result = await sendUAIWelcomeTemplate(onboarding.personalInfo.phone, onboarding.personalInfo.name);

        // Email to Sales Team
        await sendEmail({
            to: salesEmails.join(","),
            subject: `🚀 New Lead Captured - ${lead.companyName}`,
            html: `
        <h2>New Lead Captured</h2>

        <table border="1" cellpadding="10" cellspacing="0">
            <tr>
                <td><strong>Company</strong></td>
                <td>${onboarding.personalInfo.phone}</td>
            </tr>

            <tr>
                <td><strong>Phone</strong></td>
                <td>${onboarding.personalInfo.phone}</td>
            </tr>

            <tr>
                <td><strong>Company Size</strong></td>
                <td>${onboarding.company.name}</td>
            </tr>


            <tr>
                <td><strong>Created At</strong></td>
                <td>${new Date().toLocaleString()}</td>
            </tr>
        </table>

        <br>

        <p>Please contact this lead as soon as possible.</p>
    `,
        });
        return res.status(201).json({
            success: true,
            templateResult: templateResult.success,
            message: "Onboarding created successfully.",
            data: onboarding,
        });
    } catch (error) {
        console.error("Create Onboarding Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create onboarding.",
            error: error.message,
        });
    }
};

export const getOnboardingdatabyPhone = async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required",
            });
        }
        const onboardingData = await Onboarding.findOne({ "personalInfo.phone": phone.trim() });
        if (!onboardingData) {
            return res.status(404).json({
                success: false,

                message: "Onboarding data not found for the provided phone number",
            });
        }
        res.status(200).json({
            success: true,
            data: onboardingData,
        });
    }
    catch (error) {
        console.error("Error fetching onboarding data by phone:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch onboarding data",

        });
    }
};



export const createLead = async (req, res) => {
    try {
        const {
            companyName,
            phone,
            companySize,
            salesTeam,
            notes,
        } = req.body;

        // Validation
        if (!companyName || !phone || !companySize) {
            return res.status(400).json({
                success: false,
                message:
                    "Company name, phone, and company size are required.",
            });
        }

        const existingLead = await Lead.findOne({ phone });

        if (existingLead) {
            return res.status(409).json({
                success: false,
                message: "Lead already exists with this phone number.",
            });
        }

        const lead = await Lead.create({
            companyName,
            phone,
            companySize,
            salesTeam,
            notes,
        });
        const templateResult = await sendUAIWelcomeTemplate(lead.phone, lead.companyName);
        // Email to Sales Team
        await sendEmail({
            to: salesEmails.join(","),
            subject: `🚀 New Lead Captured - ${lead.companyName}`,
            html: `
        <h2>New Lead Captured</h2>

        <table border="1" cellpadding="10" cellspacing="0">
            <tr>
                <td><strong>Company</strong></td>
                <td>${lead.companyName}</td>
            </tr>

            <tr>
                <td><strong>Phone</strong></td>
                <td>${lead.phone}</td>
            </tr>

            <tr>
                <td><strong>Company Size</strong></td>
                <td>${lead.companySize}</td>
            </tr>

            <tr>
                <td><strong>Sales Team</strong></td>
                <td>${lead.salesTeam || "N/A"}</td>
            </tr>

            <tr>
                <td><strong>Notes</strong></td>
                <td>${lead.notes || "N/A"}</td>
            </tr>

           <tr>
    <td><strong>Created At</strong></td>
    <td>
        ${new Date().toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true, // false for 24-hour format
            })}
    </td>
</tr>
        </table>

        <br>

        <p>Please contact this lead as soon as possible.</p>
    `,
        });
        return res.status(201).json({
            templateResult: templateResult.success,
            success: true,
            message: "Lead created successfully.",
            data: lead,
        });
    } catch (error) {
        console.error("Create Lead Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create lead.",
            error: error.message,
        });
    }
};