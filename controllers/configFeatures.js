import User from '../models/userModel.js';
import mongoose from 'mongoose';

export const enableFace = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { 'manageFeature.face.enabled': true },
      {
        new: true,
        runValidators: true
      }
    ).select('-password -otp');

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: 'Face feature enabled successfully'
    });
  } catch (error) {
    console.error('Enable face error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

export const disableFace = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { 'manageFeature.face.enabled': false },
      {
        new: true,
        runValidators: true
      }
    ).select('-password -otp');

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: 'Face feature disabled successfully'
    });
  } catch (error) {
    console.error('Disable face error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

export const enableQr = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { 'manageFeature.qr.enabled': true },
      {
        new: true,
        runValidators: true
      }
    ).select('-password -otp');

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: 'QR feature enabled successfully'
    });
  } catch (error) {
    console.error('Enable QR error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};

export const disableQr = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'User not found'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { 'manageFeature.qr.enabled': false },
      {
        new: true,
        runValidators: true
      }
    ).select('-password -otp');

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: 'QR feature disabled successfully'
    });
  } catch (error) {
    console.error('Disable QR error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
};
