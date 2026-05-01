import AppSettings from '../models/appsessting.js';

// Create app settings
export const createAppSettings = async (req, res) => {
  try {
    const { color,link } = req.body;

    if (!color) {
      return res.status(400).json({
        success: false,
        message: 'Color is required'
      });
    }

    // Check if settings already exist
    const existingSettings = await AppSettings.findOne();
    if (existingSettings) {
      return res.status(400).json({
        success: false,
        message: 'App settings already exist. Use update instead.'
      });
    }

    const newSettings = new AppSettings({ color, link });
    await newSettings.save();

    res.status(201).json({
      success: true,
      message: 'App settings created successfully',
      data: newSettings
    });
  } catch (error) {
    console.error('Create App Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create app settings',
      error: error.message
    });
  }
};

// Get app settings
export const getAppSettings = async (req, res) => {
  try {
    const settings = await AppSettings.findOne();

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'App settings not found'
      });
    }

    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get App Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get app settings',
      error: error.message
    });
  }
};

// Update app settings
export const updateAppSettings = async (req, res) => {
  try {
    const { color, link } = req.body;

    if (!color) {
      return res.status(400).json({
        success: false,
        message: 'Color is required'
      });
    }

    const updatedSettings = await AppSettings.findOneAndUpdate(
      {},
      { color, link },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'App settings updated successfully',
      data: updatedSettings
    });
  } catch (error) {
    console.error('Update App Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update app settings',
      error: error.message
    });
  }
};

// Delete app settings
export const deleteAppSettings = async (req, res) => {
  try {
    const deletedSettings = await AppSettings.findOneAndDelete();

    if (!deletedSettings) {
      return res.status(404).json({
        success: false,
        message: 'App settings not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'App settings deleted successfully'
    });
  } catch (error) {
    console.error('Delete App Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete app settings',
      error: error.message
    });
  }
};
