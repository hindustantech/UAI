// utils/cronLogger.js

import fs from "fs";
import path from "path";
import crypto from "crypto";
import mongoose from "mongoose";
import "../models/AuditLog.js";
import "../models/AuditSequence.js";
import auditConfig from "../services/audit/config.js";
import { deriveOperation, deriveEventType, deriveSeverity } from "../services/audit/taxonomy.js";
import {
    allocateSequence,
    getPreviousHash,
    computeEventHash,
} from "../services/audit/hashChain.js";

const CRON_LOGS_DIR = "./logs/cron";

// Ensure logs directory exists
if (!fs.existsSync(CRON_LOGS_DIR)) {
    fs.mkdirSync(CRON_LOGS_DIR, { recursive: true });
}

const GLOBAL_SCOPE = "__GLOBAL__";

/* ────────────────────────────────────────────────
   AUDIT DB WRITE — Cron events (fire-and-forget)
   ──────────────────────────────────────────────── */

async function writeToAuditDb(jobName, status, message) {
    try {
        const chainScope = GLOBAL_SCOPE;
        const seq = await allocateSequence(chainScope);
        const previousHash = await getPreviousHash(chainScope, seq);
        const timestamp = new Date();
        const success = status === "SUCCESS" || status === "COMPLETED";

const fullAction = `CRON.${jobName}.${String(status).toUpperCase()}`;

        const eventDoc = {
            eventId: crypto.randomUUID(),
            schemaVersion: 1,
            timestamp,
            actorType: "CRON",
            action: fullAction,
            resource: "CronJob",
            resourceId: jobName,
            category: "SYSTEM",
            origin: "CRON",
            cronJobName: jobName,
            operation: deriveOperation(fullAction),
            eventType: deriveEventType(fullAction),
            severity: deriveSeverity(fullAction),
            success,
            result: success ? "SUCCESS" : (status === "FAILED" ? "FAILURE" : "SUCCESS"),
            safeErrorMessage: success ? undefined : String(message).slice(0, 500),
            metadata: { message, jobName, status },
            chainScope,
            seq,
            previousHash,
            currentHash: null,
        };

        eventDoc.currentHash = computeEventHash({
            eventId: eventDoc.eventId,
            timestamp: eventDoc.timestamp,
            actorType: eventDoc.actorType,
            actorId: null,
            action: eventDoc.action,
            resource: eventDoc.resource,
            resourceId: eventDoc.resourceId,
            requestId: null,
            success: eventDoc.success,
            oldData: null,
            newData: null,
            previousHash,
        });

        await AuditLog.create(eventDoc);
    } catch {
        // Cron audit DB failure is silent — file log already captured it
    }
}

/**
 * Log cron execution to file + AuditLog DB.
 * File write is synchronous (fast, small). DB write is fire-and-forget.
 */
export const logCronExecution = (jobName, status, message) => {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, jobName, status, message };

    // 1. File write (fast, synchronous)
    const logFile = path.join(CRON_LOGS_DIR, `${jobName}.log`);
    try {
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n", "utf8");
    } catch {
        // file write failure is non-critical
    }

    console.log(`[${jobName}] [${status}] ${message} - ${timestamp}`);

    // 2. AuditLog DB entry (fire-and-forget, never blocks)
    if (auditConfig.enabled) {
        writeToAuditDb(jobName, status, message); // intentionally not awaited
    }
};

/**
 * Get recent cron logs
 */
export const getCronLogs = (jobName, limit = 50) => {
    const logFile = path.join(CRON_LOGS_DIR, `${jobName}.log`);

    if (!fs.existsSync(logFile)) {
        return [];
    }

    const logs = fs
        .readFileSync(logFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .slice(-limit);

    return logs;
};

export default { logCronExecution, getCronLogs };
