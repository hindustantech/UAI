import express from "express";
import {
    createBlog,
    getAllBlogs,
    getBlogById,
    getBlogBySlug,
    updateBlog,
    deleteBlog,
    addComment,
    rateBlog,
    toggleLike,
    toggleBookmark,
    getBlogStats,
} from "../../controllers/Blog/blogController.js";
import authMiddleware from "../../middlewares/authMiddleware.js";
import multer from 'multer';
const router = express.Router();



// Configure multer for memory storage (required for Cloudinary stream upload)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept images only
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Configure fields for file upload
const blogUploadFields = upload.fields([
    { name: 'featuredImage', maxCount: 1 },
    { name: 'gallery', maxCount: 10 }
]);


// Public routes
router.get("/", getAllBlogs);
router.get("/stats", getBlogStats);
router.get("/slug/:slug", getBlogBySlug);
router.get("/:id", getBlogById);

// Protected routes (authenticated users)
router.post("/", authMiddleware, blogUploadFields, createBlog);
router.put("/:id", authMiddleware, blogUploadFields, updateBlog);
router.delete("/:id", authMiddleware, deleteBlog);
router.post("/:id/rate", authMiddleware, rateBlog);
router.post("/:id/comment", authMiddleware, addComment);
router.post("/:id/like", authMiddleware, toggleLike);
router.post("/:id/bookmark", authMiddleware, toggleBookmark);

export default router;