import express from "express";
import multer from "multer";
import { createOrUpdateProfile, getProfile } from "../controllers/PatnerProfile.js";
import authMiddleware from '../middlewares/authMiddleware.js';
import { updateProfileMedia } from "../controllers/authController.js";

const router = express.Router();


const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            cb(new Error("Only image files are allowed"));
        }
        cb(null, true);
    },
});
// Create or Update Profile with Cloudinary logo
router.post(
    "/",
    upload.fields([
        { name: "logo", maxCount: 1 },
        { name: "mallImage", maxCount: 5 }
    ]),
    authMiddleware,
    createOrUpdateProfile
);



router.put(
    "/media",
    authMiddleware,                     // JWT Authentication
    upload.single("image"),      // Multipart Form Data
    updateProfileMedia
);
// Get Profile by User ID
router.get("/:userId", getProfile);


export default router;
