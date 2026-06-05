// controllers/onboarding.controller.js

import Onboarding from "../models/Onboarding.js";

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

        return res.status(201).json({
            success: true,
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
