import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define log file path
const logFilePath = path.join(__dirname, '../logs/app.log');

// Create Winston logger
const logger = winston.createLogger({
  // Define log levels
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // Include stack traces for errors
    winston.format.json(), // JSON format for structured logging
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
      let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
      if (Object.keys(metadata).length > 0) {
        log += ` | Metadata: ${JSON.stringify(metadata)}`;
      }
      return log;
    })
  ),
  // Define transports (where logs are output)
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Colorize logs in console
        winston.format.simple()
      ),
    }),
    // File transport for persistent logs
    new winston.transports.File({
      filename: logFilePath,
      maxsize: 5 * 1024 * 1024, // 5MB per file
      maxFiles: 5, // Keep up to 5 rotated log files
      tailable: true, // Rotate logs when maxsize is reached
    }),
  ],
});

// Add error-specific file transport
logger.add(
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/error.log'),
    level: 'error',
    maxsize: 5 * 1024 * 1024,
    maxFiles: 5,
    tailable: true,
  })
);

// NOTE: Database storage is handled by AuditLog (MongoDB) via utils/apiLogger.js —
// NOT via a winston-mongodb transport. See logApiAction()/logApiError().

// Optional: Stream for Morgan (HTTP request logging)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

export default logger;