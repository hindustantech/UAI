import mongoose, { Mongoose } from "mongoose";

const advertisementSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true
        },

        description: {
            type: String,
            required: true
        },

        imageUrl: {
            type: String,
            required: true
        },

        linkUrl: {
            type: String,
            required: true
        },

        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdvertisementCategory",
            required: true,
            index: true
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: false,
            index: true,
            default: null
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
            index: true
        }

    }, { timestamps: true });

export default mongoose.model("Advertisement", advertisementSchema);