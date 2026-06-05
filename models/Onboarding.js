import mongoose from "mongoose";

const onboardingSchema = new mongoose.Schema(
  {
    personalInfo: {
      name: {
        type: String,
        required: [true, "Name is required"],
        trim: true,
        maxlength: [100, "Name cannot exceed 100 characters"],
      },

      email: {
        type: String,
        required: [true, "Email is required"],
        lowercase: true,
        trim: true,
        match: [
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
          "Please enter a valid email",
        ],
      },

      phone: {
        type: String,
        required: [true, "Phone number is required"],
        trim: true,
      },
    },

    company: {
      name: {
        type: String,
        required: [true, "Company name is required"],
        trim: true,
        maxlength: [200, "Company name cannot exceed 200 characters"],
      },
    },

    onboarding: {
      status: {
        type: String,
        enum: ["pending", "in_progress", "completed", "rejected"],
        default: "pending",
      },

      startedAt: {
        type: Date,
        default: Date.now,
      },

      completedAt: {
        type: Date,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
onboardingSchema.index(
  { "personalInfo.email": 1 },
  { unique: true }
);

onboardingSchema.index({
  "onboarding.status": 1,
});

const Onboarding = mongoose.model(
  "Onboarding",
  onboardingSchema
);

export default Onboarding;