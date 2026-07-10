// src/middleware/upload.middleware.js
import multer from 'multer';

const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FACE_IMAGE_MB || '10', 10);

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
  cb(null, true);
}

const singleUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
}).single('file');

const batchUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 5 },
}).array('files', 5);

function wrap(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        err.statusCode = 400;
        return next(err);
      }
      next();
    });
  };
}

export const uploadSingle = wrap(singleUpload);
export const uploadBatch = wrap(batchUpload);
