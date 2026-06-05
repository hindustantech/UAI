// routes/onboarding.routes.js

import express from "express";
import {
    createOnboarding, getOnboardingdatabyPhone

} from "../controllers/onboarding.controller.js";

const router = express.Router();

router.post("/create", createOnboarding);
router.get("/getByPhone/:phone", getOnboardingdatabyPhone);

export default router;