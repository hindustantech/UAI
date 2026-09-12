import mongoose from "mongoose";
import { SalesSession } from "../models/Attandance/Salses/Salses.js";
import User from "../models/userModel.js";
import { generateUniqueCustomerIdWithRetry } from "../utils/nanoid.js";
import { generateSessionId } from "../controllers/bulkUploadSalesSessions.js";

/* ============================================================
SINGLE SESSION CREATION CONTROLLER
============================================================ */

/**
 * @route   POST /api/sales-sessions/create
 * @desc    Create a single sales session (one at a time)
 * @access  Private (Admin, Partner, Agency)
 */
export const createSalesSession = async (req, res) => {
    try {
        const { customer_name, phone_number } = req.body;

        if (!customer_name || !phone_number) {
            return res.status(400).json({
                success: false,
                message: "customer_name and phone_number are required"
            });
        }

        // Get authenticated user's company and location
        const companyId = req.user._id || req.user.id || req.user.companyId;

        const uploaderUser = await User.findById(companyId)
            .select('_id name email type latestLocation');

        if (!uploaderUser) {
            return res.status(404).json({
                success: false,
                message: "Uploader user not found"
            });
        }

        // Generate unique customer ID
        let customerId;
        try {
            const existingCustomer = await SalesSession.findOne({
                "customer.customerId": customer_name + phone_number
            });

            if (existingCustomer) {
                customerId = await generateUniqueCustomerIdWithRetry(SalesSession);
            } else {
                customerId = customer_name + phone_number;
            }
        } catch (genError) {
            return res.status(500).json({
                success: false,
                message: `Failed to generate unique customer ID: ${genError.message}`
            });
        }

        // Prepare customer data with uploader's location
        const location = uploaderUser.latestLocation || {
            type: "Point",
            coordinates: [0, 0]
        };

        const customerData = {
            customerId: customerId,
            companyName: customer_name,
            contactName: customer_name,
            phoneNumber: phone_number,
            address: "",
            landmark: "",
            location: {
                type: "Point",
                coordinates: location.coordinates
            }
        };

        // Generate unique session ID
        const sessionId = await generateSessionId();

        // Create session data
        const sessionData = {
            sessionId,
            customer: customerData,
            companyId: companyId,
            createdBy: uploaderUser._id,
            assignedTo: [uploaderUser._id],
            employeeId: uploaderUser._id,
            status: "not started",
            SalesStatus: "open",
            punchInLocation: location,
            punchOutLocation: location,
            punchOutTime: new Date(),
            punchInTime: new Date(),
            routePath: [
                {
                    userId: uploaderUser._id,
                    location: location,
                    timestamp: new Date(),
                    accuracy: 0,
                    speed: 0,
                    heading: 0
                }
            ]
        };

        // Save to database
        const salesSession = new SalesSession(sessionData);
        await salesSession.save();

        return res.status(201).json({
            success: true,
            message: "Sales session created successfully",
            data: {
                sessionId: salesSession.sessionId,
                customerId: customerId,
                customerName: customer_name,
                phoneNumber: phone_number,
                status: "not started",
                SalesStatus: "open",
                punchInTime: new Date(),
                createdBy: uploaderUser.name
            }
        });

    } catch (error) {
        console.error("Create sales session error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error during sales session creation",
            error: error.message
        });
    }
};

export default { createSalesSession };