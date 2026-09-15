import mongoose from "mongoose";
import { SalesSession } from "../models/Attandance/Salses/Salses.js";
import User from "../models/userModel.js";
import Employee from "../models/Attandance/Employee.js";
import { generateUniqueCustomerIdWithRetry } from "../utils/nanoid.js";
import { generateSessionId } from "../controllers/bulkUploadSalesSessions.js";

/* ============================================================
SINGLE SESSION CREATION CONTROLLER
========================================================== */

/**
 * @route   POST /api/sales-sessions/create
 * @desc    Create a single sales session with customer details
 * @access  Private (Admin, Partner, Agency)
 */
export const createSalesSession = async (req, res) => {
    try {
        const {
            customer_name,
            phone_number,
            company_name,
            address,
            landmark,
            gender,
            dob,
            email,
            customer_type,
            salesperson_id,
            SalesStatus,
            visit_type,
            recurring_type,
            recurring_days,
            recurring_dates,
            next_meeting_date,
            next_meeting_time,
            next_meeting_notes
        } = req.body;

        if (!customer_name || !phone_number) {
            return res.status(400).json({
                success: false,
                message: "customer_name and phone_number are required"
            });
        }

        const companyId = req.user._id || req.user.id || req.user.companyId;

        const uploaderUser = await User.findById(companyId)
            .select('_id name email type latestLocation');

        if (!uploaderUser) {
            return res.status(404).json({
                success: false,
                message: "Uploader user not found"
            });
        }

        let assignedUserId = uploaderUser._id;

        if (salesperson_id && mongoose.Types.ObjectId.isValid(salesperson_id)) {
            const salesperson = await User.findOne({
                _id: salesperson_id,
                accountStatus: "ACTIVE",
                suspend: false
            }).select('_id name email uid referalCode type');

            if (salesperson) {
                const employee = await Employee.findOne({
                    userId: salesperson._id,
                    companyId: companyId,
                    employmentStatus: "active"
                });

                if (employee && ["sales", "pro_sales"].includes(employee.employeeType)) {
                    assignedUserId = salesperson._id;
                }
            }
        }

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

        const location = uploaderUser.latestLocation || {
            type: "Point",
            coordinates: [0, 0]
        };

        const customerData = {
            customerId: customerId,
            companyName: company_name || customer_name,
            contactName: customer_name,
            phoneNumber: phone_number,
            address: address || "",
            landmark: landmark || "",
            gender: gender || "Other",
            dob: dob ? new Date(dob) : null,
            email: email || "",
            type: customer_type || "customer",
            isActive: true,
            location: {
                type: "Point",
                coordinates: location.coordinates
            }
        };

        const sessionId = await generateSessionId();

        const sessionData = {
            sessionId,
            customer: customerData,
            companyId: companyId,
            createdBy: uploaderUser._id,
            assignedTo: [assignedUserId],
            employeeId: assignedUserId,
            status: "not started",
            SalesStatus: SalesStatus || "open",
            visitType: visit_type || "one_time",
            punchInLocation: location,
            punchOutLocation: location,
            punchOutTime: new Date(),
            punchInTime: new Date(),
            routePath: [
                {
                    userId: assignedUserId,
                    location: location,
                    timestamp: new Date(),
                    accuracy: 0,
                    speed: 0,
                    heading: 0
                }
            ]
        };

        if (visit_type === "recurring" && recurring_type) {
            sessionData.recurringSchedule = {
                type: recurring_type,
                days: recurring_days || [],
                dates: recurring_dates || [],
                startDate: next_meeting_date ? new Date(next_meeting_date) : new Date(),
                isActive: true
            };
        }

        if (next_meeting_date) {
            sessionData.nextMeeting = {
                decided: true,
                date: new Date(next_meeting_date),
                time: next_meeting_time || null,
                notes: next_meeting_notes || ""
            };

            sessionData.meetingLogs = [
                {
                    userId: assignedUserId,
                    date: new Date(next_meeting_date),
                    time: next_meeting_time || "",
                    notes: next_meeting_notes || ""
                }
            ];
        }

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
                status: salesSession.status,
                SalesStatus: salesSession.SalesStatus,
                visitType: salesSession.visitType,
                nextMeeting: salesSession.nextMeeting?.decided ? salesSession.nextMeeting : null,
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