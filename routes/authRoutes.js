import express from 'express';
import multer from 'multer'; // Add this at the top

import {
    signup,
    updateUserLocation,
    UpdateManualAddress,
    verifyOtp,
    login,
    resendOtp,
    signout,
    forgotPassword,
    resetPassword,
    updateProfile,
    getProfileData,
    uploadProfileImage,
    getOwner,
    findUserByPhone,
    getProfileImageUrl,
    getProfile,
    updateProfileImage,
    getUserIdsAndNamesByReferralCodesController,
    getUserProfile,
    deleteUser,
    startAuth,
    completOtp,
    completeProfile,
    findUserByReferralOwner,
    exportUsersByLocation,
    restoreAccount,
    requestAccountDeletion,
    getDeletionStatus,
    generateTheQRCode,
    startAdminAuth,completeAdminOtp
} from '../controllers/authController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import profileUploadMiddleware from '../middlewares/profileUploadMiddleware.js';
const router = express.Router();
const storage = multer.memoryStorage(); // ✅ stores buffer in memory

const upload = multer({ storage });
upload.single("images")

router.post('/updateUserLocation', authMiddleware, updateUserLocation);

router.get('/getuserbyreferal', getUserIdsAndNamesByReferralCodesController);
router.get('/generateTheQRCode', authMiddleware, generateTheQRCode);

router.post('/UpdateManualAddress', authMiddleware, UpdateManualAddress);

router.get('/getProfile', authMiddleware, getProfile);
router.get('/exportUsersByLocation', exportUsersByLocation);

router.get('/updateProfileImage', authMiddleware, upload.single('profileImage'), updateProfileImage);

// router.post('/signout', signout);

router.post('/signup', signup);
router.post("/find-by-phone", findUserByPhone);
router.get("/getUserProfile", authMiddleware, getUserProfile);
router.delete("/deleteUser", authMiddleware, deleteUser);


router.post('/startAuth', startAuth);
router.post('/completOtp', completOtp);
router.post('/startAdminAuth', startAdminAuth);
router.post('/completeAdminOtp', completeAdminOtp);
router.post('/completeProfile',
    authMiddleware,
    upload.single('profileImage'),
    completeProfile
); 
router.post('/restoreAccount', authMiddleware, restoreAccount);
router.post('/requestAccountDeletion', authMiddleware, requestAccountDeletion);
router.get('/getDeletionStatus', authMiddleware, getDeletionStatus);
router.get('/findUserByReferralOwner/:code', authMiddleware, findUserByReferralOwner);

router.post('/verifyOtp', verifyOtp);
router.post('/login', login);
router.post('/resendOtp', resendOtp);
router.post('/signout', signout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.put('/update-profile', authMiddleware, updateProfile);
router.get('/profile-data', authMiddleware, getProfileData);
router.get('/getOwner/:ownerId', authMiddleware, getOwner);

router.post('/upload-profile-image', authMiddleware, profileUploadMiddleware, uploadProfileImage);
router.get('/profile-image-url', authMiddleware, profileUploadMiddleware, getProfileImageUrl);

export default router;
