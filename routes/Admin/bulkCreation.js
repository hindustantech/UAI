
import express from "express";
import multer from "multer";
import { createEmployeesFromCSV } from "../../controllers/Admin/BulkCreationEmp.js";

const router = express.Router();

// Configure multer for memory storage (better for CSV processing)
const storage = multer.memoryStorage();

// File filter to only allow CSV files
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    const allowedExtensions = ['.csv'];

    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only CSV files are allowed.'), false);
    }
};

// Multer configuration
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// ==================== CSV Upload Routes ====================

/**
 * @route   POST /api/employees/bulk-create
 * @desc    Create multiple employees from CSV file
 * @access  Private (requires authentication)
 * @body    { partnerPhone, csvFile }
 */
router.post(
    "/bulk-create",
    upload.single("csv"), // Expecting field name 'csv'
    createEmployeesFromCSV
);



export default router;