import mongoose from "mongoose";

const subCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Subcategory name is required"],
        trim: true,
        maxlength: [100, "Subcategory name cannot exceed 100 characters"],
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
    },
    description: {
        type: String,
        maxlength: [500, "Description cannot exceed 500 characters"],
    },
    image: {
        url: String,
        public_id: String,
        altText: String,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    order: {
        type: Number,
        default: 0,
    },
    metaTitle: String,
    metaDescription: String,
    metaKeywords: [String],
}, {
    timestamps: true,
});

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Category name is required"],
        unique: true,
        trim: true,
        maxlength: [100, "Category name cannot exceed 100 characters"],
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
    },
    description: {
        type: String,
        maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    image: {
        url: String,
        public_id: String,
        altText: String,
    },
    icon: {
        type: String,
        default: "📁",
    },
    subCategories: [subCategorySchema],
    parentCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        default: null,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    isFeatured: {
        type: Boolean,
        default: false,
    },
    order: {
        type: Number,
        default: 0,
    },
    blogCount: {
        type: Number,
        default: 0,
    },
    metaTitle: String,
    metaDescription: String,
    metaKeywords: [String],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },
}, {
    timestamps: true,
});

// Pre-save middleware to generate slug
categorySchema.pre("save", function (next) {
    if (this.isModified("name")) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
    }
    next();
});

// Update subcategory slugs
categorySchema.pre("save", function (next) {
    if (this.isModified("subCategories")) {
        this.subCategories.forEach((sub) => {
            if (sub.isModified("name")) {
                sub.slug = sub.name
                    .toLowerCase()
                    .replace(/[^a-zA-Z0-9]/g, "-")
                    .replace(/-+/g, "-")
                    .replace(/^-|-$/g, "");
            }
        });
    }
    next();
});

// Indexes for better performance
categorySchema.index({ slug: 1 });
categorySchema.index({ isActive: 1, isFeatured: 1 });
categorySchema.index({ "subCategories.slug": 1 });

export default mongoose.model("Category", categorySchema);