// routes/onboarding.routes.js

import express from "express";
import {
    createOnboarding, getOnboardingdatabyPhone, createLead

} from "../controllers/onboarding.controller.js";

const router = express.Router();

router.post("/create", createOnboarding);
router.get("/getByPhone/:phone", getOnboardingdatabyPhone);
router.post("/createLead", createLead);

export default router;