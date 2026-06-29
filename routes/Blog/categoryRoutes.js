import express from "express";
import {
    createCategory,
    getAllCategories,
    getCategoryById,
    getCategoryBySlug,
    updateCategory,
    deleteCategory,
    addSubCategory,
    getBlogsByCategory,
} from "../../controllers/Blog/categoryController.js";
import authMiddleware from "../../middlewares/authMiddleware.js";
import { upload } from "../Attandance/Sales/Sales.routes.js";
const router = express.Router();

// Public routes
router.get("/", getAllCategories);
router.get("/slug/:slug", getCategoryBySlug);
router.get("/:id", getCategoryById);
router.get("/:id/blogs", getBlogsByCategory);

// Admin routes
router.post("/", authMiddleware, upload.single('image'), createCategory);
router.put("/:id", authMiddleware, upload.single('image'), updateCategory);
router.delete("/:id", authMiddleware, deleteCategory);
router.post("/:id/subcategories", authMiddleware, addSubCategory);

export default router;