// const multer = require('multer');
// const path = require('path');
import multer from 'multer';
import path from 'path';

// Set up storage for profile images
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../Uploads/ProfileImages')); // Specify the upload folder
    },
    filename: function (req, file, cb) {
        const fileName = `${Date.now()}-${file.originalname}`; // Rename the file
        cb(null, fileName);
    }
});

// File filter to accept only image files
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Configure Multer for file uploads
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // Set file size limit to 5MB
    }
});

// Middleware to handle image upload
const profileUploadMiddleware = (req, res, next) => {
    upload.single('image')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: 'File upload error: ' + err.message });
        } else if (err) {
            return res.status(400).json({ message: 'Invalid file type or size exceeded!' });
        }
        next(); // Proceed to the next handler (controller)
    });
};

export default profileUploadMiddleware;
