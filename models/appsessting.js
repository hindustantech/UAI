import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema({
  color: {
    type: String,
    required: true,
    default: "#000000" // Default to black if not specified
  },
  link: {
    type: String,
    required: false,
    default: "https://www.uaihr.com"
  }
  // Default link if not specified
}, {
  timestamps: true
});

const AppSettings = mongoose.model('AppSettings', appSettingsSchema);

export default AppSettings;
