import express from 'express';
import { getFilteredUsers, uploadCSVFile } from '../../controllers/BilledData/billedDateController.js';
import multer from 'multer';
const router = express.Router();

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files allowed'), false);
        }
    }
});

router.post('/filter', getFilteredUsers);



// Route
router.post('/upload-csv', upload.single('csvFile'), uploadCSVFile);

export default router;
