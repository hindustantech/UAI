import express from "express";
import {
    createBlog,
    getAllBlogs,
    getBlogById,
    getBlogBySlug,
    updateBlog,
    deleteBlog,
    rateBlog,
    addComment,
    toggleLike,
    toggleBookmark,
    getBlogStats,
} from "../../controllers/Blog/blogController.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getAllBlogs);
router.get("/stats", getBlogStats);
router.get("/slug/:slug", getBlogBySlug);
router.get("/:id", getBlogById);

// Protected routes (authenticated users)
router.post("/", authMiddleware, createBlog);
router.put("/:id", authMiddleware, updateBlog);
router.delete("/:id", authMiddleware, deleteBlog);
router.post("/:id/rate", authMiddleware, rateBlog);
router.post("/:id/comment", authMiddleware, addComment);
router.post("/:id/like", authMiddleware, toggleLike);
router.post("/:id/bookmark", authMiddleware, toggleBookmark);

export default router;