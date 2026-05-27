import express from "express";
import { fetchUsers, getme } from "../controllers/getUser.js";
import authMiddleware from '../middlewares/authMiddleware.js';
const router = express.Router();

router.get("/fetchUsers", fetchUsers);
router.get("/me", authMiddleware, getme);

export default router;
