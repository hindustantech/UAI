import { OAuth2Client } from "google-auth-library";
import logger from "../utils/logger.js";

const client = new OAuth2Client();

/**
 * Verify Google ID Token (Production Grade)
 */
export const verifyGoogleOwnership = async (idToken) => {
    try {
        if (!idToken) {
            throw new Error("MISSING_ID_TOKEN");
        }

        const allowedAudiences = [
            process.env.GOOGLE_WEB_CLIENT_ID,
            process.env.GOOGLE_ANDROID_CLIENT_ID,
            process.env.GOOGLE_IOS_CLIENT_ID, // optional future-proof
        ].filter(Boolean);

        // 🔐 Step 1: Verify token with Google
        const ticket = await client.verifyIdToken({
            idToken,
            audience: allowedAudiences,
        });

        const payload = ticket.getPayload();

        if (!payload) {
            throw new Error("INVALID_PAYLOAD");
        }

        // 🔒 Step 2: Issuer validation
        const validIssuers = new Set([
            "accounts.google.com",
            "https://accounts.google.com",
        ]);

        if (!validIssuers.has(payload.iss)) {
            throw new Error("INVALID_ISSUER");
        }

        // 🔒 Step 3: Audience validation (multi-platform safe)
        if (!allowedAudiences.includes(payload.aud)) {
            throw new Error("INVALID_AUDIENCE");
        }

        // 🔒 Step 4: Email verification
        if (!payload.email_verified) {
            throw new Error("EMAIL_NOT_VERIFIED");
        }

        // 🔒 Step 5: Subject validation (Google unique ID)
        if (!payload.sub) {
            throw new Error("INVALID_SUBJECT");
        }

        // 🔒 Step 6: Optional domain restriction (enterprise use-case)
        // if (payload.hd !== "yourcompany.com") {
        //   throw new Error("UNAUTHORIZED_DOMAIN");
        // }
        logger.info("✅ Google ID Token verified successfully", payload);

        // ✅ Normalized user object (standard across services)
        return {
            provider: "google",
            providerId: payload.sub,
            email: payload.email?.toLowerCase() || null,
            name: payload.name || "",
            avatar: payload.picture || null,
            emailVerified: payload.email_verified,
        };
    } catch (error) {
        console.error("❌ Google Auth Error:", {
            message: error.message,
            stack: error.stack,
        });

        // 🔥 Standardized error response (like AWS / Stripe style)
        throw new Error("GOOGLE_AUTH_FAILED");
    }
};