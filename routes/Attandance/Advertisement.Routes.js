import express from "express";
import multer from "multer";
import {
    createAdvertisement,
    updateAdvertisement,
    deleteAdvertisement,
    toggleAdvertisementStatus,
    getActiveAdvertisements,
    getAllAdvertisements,
    getAdvertisementById,
    getAdvertisementsByCategory,
    bulkUpdateStatus,
    bulkDeleteAdvertisements,
    createAdvertisementAdmin,
    updateAdvertisementadmin,
    getAllAdminAdvertisements,
    getWithEmpAdvertisementsByCategory
} from "../../controllers/attandance/advertisement.controller.js";
import authMiddleware from "../../middlewares/authMiddleware.js";
import { checkPermission } from "../../middlewares/checkPermission.js";
const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept images only
        if (!file.originalname.match(/\.(jpg|JPG|jpeg|JPEG|png|PNG|gif|GIF|webp|WEBP)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});
// Public routes
router.get("/", authMiddleware,getAllAdvertisements);
router.get("/getAllAdminAdvertisements", getAllAdminAdvertisements);
router.get("/active", getActiveAdvertisements);
router.get("/category/:categoryId", getAdvertisementsByCategory);
router.get("/getWithEmpAdvertisementsByCategory/:categoryId", getWithEmpAdvertisementsByCategory);
router.get("/:id", getAdvertisementById);

// Admin routes (protected)
router.post("/createAdvertisementAdmin", authMiddleware, upload.single('image'), createAdvertisementAdmin);
router.put("/updateAdvertisementadmin/:id", authMiddleware, upload.single('image'), updateAdvertisementadmin);

router.post("/", authMiddleware, upload.single('image'),checkPermission('notice.create') ,createAdvertisement);
router.put("/:id", authMiddleware, upload.single('image'), checkPermission('notice.update'), updateAdvertisement);

router.delete("/:id", authMiddleware,checkPermission('notice.delete'),deleteAdvertisement);
router.patch("/:id/toggle-status", authMiddleware,checkPermission('notice.update'), toggleAdvertisementStatus);

// Bulk operations (admin only)
router.patch("/bulk/status", authMiddleware, checkPermission('notice.update'), bulkUpdateStatus);
router.delete("/bulk/delete", authMiddleware, checkPermission('notice.delete'), bulkDeleteAdvertisements);

export default router;