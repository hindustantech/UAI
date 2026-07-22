import cron from "node-cron";
import mongoose from "mongoose";
import { Subscription } from "../models/Attandance/subscration/Subscription.js";
import { NotificationService } from "../src/notification/services/NotificationService.js";
import { scheduleSubscriptionReminders } from "../src/notification/scheduler/subscriptionReminder.js";
import { acquireLock, releaseLock } from "../src/notification/utils/redisLock.js";
const BATCH_SIZE = 500;

/**
 * Production-grade Subscription Expiry Cron
 * Runs daily at 11:58 PM IST
 */

cron.schedule("58 23 * * *", async () => {
    const lockKey = 'subscription-expiry-cron';
    const lockValue = await acquireLock(lockKey, 600000);

    if (!lockValue) {
        console.log("[CRON] Expiry job skipped (another instance holds lock)");
        return;
    }

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
    } finally {
        await releaseLock(lockKey, lockValue);
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

    if (result.modifiedCount > 0) {
        const expiredSubs = await Subscription.find({ _id: { $in: ids } })
            .populate('company', 'email phone name')
            .lean();

        for (const sub of expiredSubs) {
            try {
                await NotificationService.sendSubscriptionExpired({
                    companyId: sub.company?._id || sub.company,
                    companyName: sub.company?.name || 'Customer',
                    planName: sub.planSnapshot?.name || sub.plan?.name || 'Premium',
                    endDate: sub.endDate?.toISOString(),
                    email: sub.company?.email,
                    phone: sub.company?.phone,
                    subscriptionId: sub._id,
                });
            } catch (notifErr) {
                console.error(`[NOTIFICATION] Failed to send expiry notice for sub ${sub._id}:`, notifErr.message);
            }
        }
    }

    return result.modifiedCount || 0;
};