import mongoose from "mongoose";

const commentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    userName: {
        type: String,
        required: true,
    },
    userAvatar: {
        type: String,
    },
    content: {
        type: String,
        required: [true, "Comment content is required"],
        maxlength: [2000, "Comment cannot exceed 2000 characters"],
    },
    parentComment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Blog.comments",
        default: null,
    },
    replies: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Blog.comments",
    }],
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    likeCount: {
        type: Number,
        default: 0,
    },
    isEdited: {
        type: Boolean,
        default: false,
    },
    isApproved: {
        type: Boolean,
        default: true,
    },
    isReported: {
        type: Boolean,
        default: false,
    },
    reportReason: String,
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },
}, {
    timestamps: true,
});

const ratingSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
    },
    review: {
        type: String,
        maxlength: [1000, "Review cannot exceed 1000 characters"],
    },
    isVerified: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true,
});

const blogSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "Blog title is required"],
        trim: true,
        maxlength: [200, "Title cannot exceed 200 characters"],
        index: true,
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
        index: true,
    },
    content: {
        type: String,
        required: [true, "Blog content is required"],
    },
    excerpt: {
        type: String,
        maxlength: [500, "Excerpt cannot exceed 500 characters"],
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: [true, "Category is required"],
        index: true,
    },
    subCategory: {
        type: String,
        index: true,
    },
    tags: [{
        type: String,
        trim: true,
        lowercase: true,
    }],
    
    // Images
    featuredImage: {
        url: {
            type: String,
            required: [true, "Featured image URL is required"],
        },
        public_id: String,
        altText: String,
        caption: String,
    },
    gallery: [{
        url: String,
        public_id: String,
        altText: String,
        caption: String,
    }],
    
    // Author
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    authorName: {
        type: String,
        required: [true, "Author name is required"],
    },
    authorAvatar: {
        type: String,
        default: null,
    },
    
    // Status and Publishing
    status: {
        type: String,
        enum: ["DRAFT", "PUBLISHED", "ARCHIVED", "SCHEDULED"],
        default: "DRAFT",
        index: true,
    },
    visibility: {
        type: String,
        enum: ["PUBLIC", "PRIVATE", "PASSWORD_PROTECTED"],
        default: "PUBLIC",
    },
    password: String,
    scheduledAt: Date,
    publishedAt: Date,
    
    // Statistics
    views: {
        type: Number,
        default: 0,
    },
    uniqueViews: {
        type: Number,
        default: 0,
    },
    readTime: {
        type: Number, // in minutes
        default: 0,
    },
    wordCount: {
        type: Number,
        default: 0,
    },
    
    // Engagement
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    likeCount: {
        type: Number,
        default: 0,
    },
    bookmarks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    bookmarkCount: {
        type: Number,
        default: 0,
    },
    shares: {
        type: Number,
        default: 0,
    },
    shareLinks: {
        facebook: Number,
        twitter: Number,
        linkedin: Number,
        whatsapp: Number,
        other: Number,
    },
    
    // Ratings
    ratings: [ratingSchema],
    averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
    },
    totalRatings: {
        type: Number,
        default: 0,
    },
    
    // Comments
    comments: [commentSchema],
    commentCount: {
        type: Number,
        default: 0,
    },
    allowComments: {
        type: Boolean,
        default: true,
    },
    
    // SEO
    metaTitle: String,
    metaDescription: String,
    metaKeywords: [String],
    focusKeyword: String,
    canonicalUrl: String,
    ogImage: String,
    
    // Features
    isFeatured: {
        type: Boolean,
        default: false,
        index: true,
    },
    isTrending: {
        type: Boolean,
        default: false,
    },
    isEditorPick: {
        type: Boolean,
        default: false,
    },
    
    // Related
    relatedPosts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Blog",
    }],
    
    // Versioning
    version: {
        type: Number,
        default: 1,
    },
    revisionHistory: [{
        content: String,
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        updatedAt: Date,
    }],
    
    // Settings
    isActive: {
        type: Boolean,
        default: true,
    },
    allowIndexing: {
        type: Boolean,
        default: true,
    },
    
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

// Virtual for comment replies
blogSchema.virtual("commentThreads").get(function () {
    return this.comments.filter(comment => !comment.parentComment);
});

// Pre-save middleware to generate slug
blogSchema.pre("save", function (next) {
    if (this.isModified("title")) {
        this.slug = this.title
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        
        // Add date to make slug more unique
        this.slug = `${this.slug}-${Date.now().toString().slice(-6)}`;
    }
    
    // Calculate read time (average 200 words per minute)
    if (this.isModified("content")) {
        this.wordCount = this.content.split(/\s+/).length;
        this.readTime = Math.ceil(this.wordCount / 200);
    }
    
    next();
});

// Pre-save middleware for average rating
blogSchema.pre("save", function (next) {
    if (this.ratings && this.ratings.length > 0) {
        const totalRating = this.ratings.reduce((sum, rating) => sum + rating.rating, 0);
        this.averageRating = Math.round((totalRating / this.ratings.length) * 10) / 10;
        this.totalRatings = this.ratings.length;
    }
    next();
});

// Indexes
blogSchema.index({ slug: 1 });
blogSchema.index({ category: 1, status: 1 });
blogSchema.index({ author: 1, status: 1 });
blogSchema.index({ tags: 1 });
blogSchema.index({ createdAt: -1 });
blogSchema.index({ status: 1, publishedAt: -1 });
blogSchema.index({ isFeatured: 1, publishedAt: -1 });
blogSchema.index({ title: "text", content: "text", tags: "text" });

export default mongoose.model("Blog", blogSchema);