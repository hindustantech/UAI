// utils/cronLogger.js

import fs from "fs";
import path from "path";

const CRON_LOGS_DIR = "./logs/cron";

// Ensure logs directory exists
if (!fs.existsSync(CRON_LOGS_DIR)) {
  fs.mkdirSync(CRON_LOGS_DIR, { recursive: true });
}

/**
 * Log cron execution to file
 */
export const logCronExecution = (jobName, status, message) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    jobName,
    status,
    message
  };

  const logFile = path.join(CRON_LOGS_DIR, `${jobName}.log`);

  // Append to log file
  fs.appendFileSync(
    logFile,
    JSON.stringify(logEntry) + "\n",
    "utf8"
  );

  console.log(
    `[${jobName}] [${status}] ${message} - ${timestamp}`
  );
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