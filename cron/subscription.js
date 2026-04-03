import cron from "node-cron";
import mongoose from "mongoose";
import { Subscription } from "../models/Attandance/subscration/Subscription.js";
const BATCH_SIZE = 500;

/**
 * Production-grade Subscription Expiry Cron
 * Runs daily at 11:58 PM IST
 */

cron.schedule("58 23 * * *", async () => {
    const now = new Date();

    console.log("[CRON] Expiry job started:", now);

    try {
        let totalExpired = 0;

        // Cursor-based streaming (LOW MEMORY + LOW LOAD)
        const cursor = Subscription.find({
            status: "ACTIVE",
            isActive: true,
            endDate: { $lte: now }
        })
            .select("_id") // minimal payload
            .lean()
            .cursor();

        let batch = [];

        for await (const doc of cursor) {
            batch.push(doc._id);

            if (batch.length === BATCH_SIZE) {
                const res = await expireBatch(batch);
                totalExpired += res;
                batch = [];
            }
        }

        // Remaining batch
        if (batch.length > 0) {
            const res = await expireBatch(batch);
            totalExpired += res;
        }

        console.log(`[CRON] Total expired: ${totalExpired}`);

    } catch (err) {
        console.error("[CRON] Error:", err);
    }
}, {
    timezone: "Asia/Kolkata"
});



/**
 * Batch updater (atomic + efficient)
 */
const expireBatch = async (ids) => {
    const result = await Subscription.updateMany(
        { _id: { $in: ids } },
        {
            $set: {
                status: "EXPIRED",
                isActive: false,
                updatedAt: new Date()
            }
        }
    );

    return result.modifiedCount || 0;
};