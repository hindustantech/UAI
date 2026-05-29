// routes/billedDateRoutes.js
import express from 'express';
import { getAllBillsWithReminderStatus, uploadCSVFile, sendBulkReminder } from '../../controllers/BilledData/billedDateController.js';
import multer from 'multer';
import authMiddleware from '../../middlewares/authMiddleware.js';
const router = express.Router();
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        const allowedExtensions = ['.csv', '.xls', '.xlsx'];

        const fileExtension = '.' + file.originalname.split('.').pop().toLowerCase();

        console.log('📁 File upload attempt:', {
            originalname: file.originalname,
            mimetype: file.mimetype,
            extension: fileExtension,
            size: file.size
        });

        if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
            console.log('✅ File type accepted');
            cb(null, true);
        } else {
            console.log('❌ File type rejected');
            cb(new Error('Only CSV and Excel files (xls, xlsx) are allowed'), false);
        }
    }
});

router.use(authMiddleware); // Apply authentication middleware to all routes in this router

router.get('/bills', getAllBillsWithReminderStatus);

// Updated route to handle both CSV and Excel
router.post('/upload', upload.single('file'), uploadCSVFile);

router.post('/reminders', sendBulkReminder);

export default router;