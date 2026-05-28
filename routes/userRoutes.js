import express from "express";
import { fetchUsers } from "../controllers/getUser.js";
import authMiddleware from '../middlewares/authMiddleware.js';
const router = express.Router();

router.get("/fetchUsers", fetchUsers);


export default router;
