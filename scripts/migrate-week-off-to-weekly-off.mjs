// scripts/migrate-week-off-to-weekly-off.mjs
//
// One-off migration: attendance records stored with the legacy `week_off`
// status are rewritten to `weekly_off`.
//
// Usage:
//   node scripts/migrate-week-off-to-weekly-off.mjs            # dry run
//   node scripts/migrate-week-off-to-weekly-off.mjs --apply    # write

import dotenv from "dotenv";
import mongoose from "mongoose";
import Attendance from "../models/Attandance/Attendance.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const FILTER = { status: "week_off" };

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not set");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("[MIGRATE] MongoDB connected");

    const matched = await Attendance.countDocuments(FILTER);
    console.log(
        `[MIGRATE] Attendance records with status "week_off": ${matched}`
    );

    if (matched === 0) {
        console.log("[MIGRATE] Nothing to do.");
        return;
    }

    if (!APPLY) {
        console.log(
            "[MIGRATE] Dry run — re-run with --apply to update these records."
        );
        return;
    }

    const result = await Attendance.updateMany(FILTER, {
        $set: { status: "weekly_off" },
    });

    console.log(
        `[MIGRATE] Updated ${result.modifiedCount} of ${result.matchedCount} matched records to "weekly_off".`
    );
};

try {
    await run();
} catch (error) {
    console.error("[MIGRATE] Failed:", error.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
    console.log("[MIGRATE] MongoDB disconnected");
}
