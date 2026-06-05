import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    companySize: {
      type: String,
      enum: [
        "1-10",
        "11-50",
        "51-200",
        "201-500",
        "501-1000",
        "1000+",
      ],
      required: true,
    },

    salesTeam: {
      type: Boolean,
      required: true,
      default: false,
    },

    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "converted", "rejected"],
      default: "new",
    },

    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

leadSchema.index({ phone: 1 }, { unique: true });

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;