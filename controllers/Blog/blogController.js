import Blog from "../../models/Blog/Blog.js";
import Category from "../../models/Blog/Category.js";
import { uploadToCloudinary } from "../../utils/Cloudinary.js";


// @desc    Create blog post
// @route   POST /api/blogs
// @access  Private
export const createBlog = async (req, res) => {
    try {
        const {
            title,
            content,
            excerpt,
            category,
            subCategory,
            tags,
            status = "DRAFT",
            allowComments = true,
            metaTitle,
            metaDescription,
            metaKeywords,
            scheduledAt,
        } = req.body;

        // Validate category exists
        const categoryExists = await Category.findById(category);
        if (!categoryExists) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        // Validate subcategory if provided
        if (subCategory) {
            const subExists = categoryExists.subCategories.some(
                sub => sub.name === subCategory
            );
            if (!subExists) {
                return res.status(400).json({
                    success: false,
                    message: "Subcategory not found in selected category",
                });
            }
        }

        // Handle image uploads
        let featuredImageUrl = null;
        let galleryUrls = [];

        // Upload featured image if provided
        if (req.files?.featuredImage) {
            const result = await uploadToCloudinary(
                req.files.featuredImage[0].buffer,
                'blogs/featured'
            );
            featuredImageUrl = result.secure_url;
        }

        // Upload gallery images if provided
        if (req.files?.gallery) {
            const uploadPromises = req.files.gallery.map(file =>
                uploadToCloudinary(file.buffer, 'blogs/gallery')
            );
            const results = await Promise.all(uploadPromises);
            galleryUrls = results.map(result => result.secure_url);
        }

        const blog = await Blog.create({
            title,
            content,
            excerpt: excerpt || content.substring(0, 200),
            category,
            subCategory,
            tags: tags ? JSON.parse(tags) : [],
            featuredImage: featuredImageUrl,
            gallery: galleryUrls,
            author: req.user.id,
            authorName: req.user.name,
            authorAvatar: req.user.avatar,
            status,
            allowComments,
            metaTitle: metaTitle || title,
            metaDescription: metaDescription || excerpt || content.substring(0, 160),
            metaKeywords: metaKeywords ? JSON.parse(metaKeywords) : [],
            scheduledAt: status === "SCHEDULED" ? scheduledAt : null,
            publishedAt: status === "PUBLISHED" ? new Date() : null,
        });

        // Update category blog count
        await Category.findByIdAndUpdate(category, {
            $inc: { blogCount: 1 }
        });

        res.status(201).json({
            success: true,
            message: "Blog post created successfully",
            data: blog,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error creating blog post",
            error: error.message,
        });
    }
};

// @desc    Update blog post
// @route   PUT /api/blogs/:id
// @access  Private
export const updateBlog = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Check if blog exists
        const blog = await Blog.findById(id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Check ownership (unless admin)
        if (blog.author.toString() !== req.user.id && req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Not authorized to update this blog post",
            });
        }

        // Handle image uploads for update
        if (req.files?.featuredImage) {
            const result = await uploadToCloudinary(
                req.files.featuredImage[0].buffer,
                'blogs/featured'
            );
            updates.featuredImage = result.secure_url;
        }

        // Upload new gallery images if provided
        if (req.files?.gallery) {
            const uploadPromises = req.files.gallery.map(file =>
                uploadToCloudinary(file.buffer, 'blogs/gallery')
            );
            const results = await Promise.all(uploadPromises);
            const newGalleryUrls = results.map(result => result.secure_url);

            // Merge with existing gallery or replace
            if (updates.appendToGallery) {
                updates.gallery = [...(blog.gallery || []), ...newGalleryUrls];
            } else {
                updates.gallery = newGalleryUrls;
            }
        }

        // Add to revision history if content changed
        if (updates.content && updates.content !== blog.content) {
            blog.revisionHistory.push({
                content: blog.content,
                updatedBy: req.user.id,
                updatedAt: new Date(),
            });
            blog.version += 1;
        }

        // Update fields
        Object.keys(updates).forEach(key => {
            if (key !== "_id" && key !== "author") {
                blog[key] = updates[key];
            }
        });

        // Handle status change
        if (updates.status === "PUBLISHED" && !blog.publishedAt) {
            blog.publishedAt = new Date();
        }

        await blog.save();

        res.status(200).json({
            success: true,
            message: "Blog post updated successfully",
            data: blog,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error updating blog post",
            error: error.message,
        });
    }
};

// @desc    Get all blogs with filtering and pagination
// @route   GET /api/blogs
// @access  Public
export const getAllBlogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            sort = "-createdAt",
            category,
            subCategory,
            tag,
            author,
            status,
            search,
            featured,
            trending,
            editorPick,
            minRating,
            dateFrom,
            dateTo,
        } = req.query;

        // Build query
        const query = {};

        // Only show published blogs for public
        if (!req.user || req.user.role !== "admin") {
            query.status = "PUBLISHED";
        } else if (status) {
            query.status = status;
        }

        if (category) query.category = category;
        if (subCategory) query.subCategory = subCategory;
        if (tag) query.tags = tag.toLowerCase();
        if (author) query.author = author;
        if (featured) query.isFeatured = featured === "true";
        if (trending) query.isTrending = trending === "true";
        if (editorPick) query.isEditorPick = editorPick === "true";

        if (minRating) {
            query.averageRating = { $gte: parseFloat(minRating) };
        }

        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        // Text search
        if (search) {
            query.$text = { $search: search };
        }

        // Execute query
        const blogs = await Blog.find(query)
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate("author", "name avatar bio")
            .populate("category", "name slug icon")
            .select("-content -comments -ratings -revisionHistory");

        const total = await Blog.countDocuments(query);

        res.status(200).json({
            success: true,
            data: blogs,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalBlogs: total,
                hasMore: page * limit < total,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching blogs",
            error: error.message,
        });
    }
};

// @desc    Get single blog by ID
// @route   GET /api/blogs/:id
// @access  Public
export const getBlogById = async (req, res) => {
    try {
        const { id } = req.params;

        const blog = await Blog.findById(id)
            .populate("author", "name avatar bio socialLinks")
            .populate("category", "name slug icon")
            .populate("relatedPosts", "title slug featuredImage createdAt");

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Increment view count
        blog.views += 1;
        await blog.save({ validateBeforeSave: false });

        // Get related posts by category and tags
        if (!blog.relatedPosts || blog.relatedPosts.length === 0) {
            const relatedPosts = await Blog.find({
                _id: { $ne: blog._id },
                status: "PUBLISHED",
                $or: [
                    { category: blog.category },
                    { tags: { $in: blog.tags } },
                ],
            })
                .limit(3)
                .select("title slug featuredImage createdAt author authorName");

            blog.relatedPosts = relatedPosts;
        }

        res.status(200).json({
            success: true,
            data: blog,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching blog post",
            error: error.message,
        });
    }
};

// @desc    Get blog by slug
// @route   GET /api/blogs/slug/:slug
// @access  Public
export const getBlogBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        const blog = await Blog.findOne({ slug })
            .populate("author", "name avatar bio")
            .populate("category", "name slug icon");

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Increment view count
        blog.views += 1;
        await blog.save({ validateBeforeSave: false });

        res.status(200).json({
            success: true,
            data: blog,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching blog post",
            error: error.message,
        });
    }
};



// @desc    Delete blog post
// @route   DELETE /api/blogs/:id
// @access  Private
export const deleteBlog = async (req, res) => {
    try {
        const { id } = req.params;

        const blog = await Blog.findById(id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Check ownership
        if (blog.author.toString() !== req.user.id && req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Not authorized to delete this blog post",
            });
        }

        // Decrease category blog count
        await Category.findByIdAndUpdate(blog.category, {
            $inc: { blogCount: -1 }
        });

        await blog.deleteOne();

        res.status(200).json({
            success: true,
            message: "Blog post deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting blog post",
            error: error.message,
        });
    }
};

// @desc    Add rating to blog
// @route   POST /api/blogs/:id/rate
// @access  Private
export const rateBlog = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, review } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: "Rating must be between 1 and 5",
            });
        }

        const blog = await Blog.findById(id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Check if user already rated
        const existingRating = blog.ratings.find(
            r => r.user.toString() === req.user.id
        );

        if (existingRating) {
            // Update existing rating
            existingRating.rating = rating;
            if (review) existingRating.review = review;
        } else {
            // Add new rating
            blog.ratings.push({
                user: req.user.id,
                rating,
                review,
            });
        }

        await blog.save();

        res.status(200).json({
            success: true,
            message: "Rating submitted successfully",
            data: {
                averageRating: blog.averageRating,
                totalRatings: blog.totalRatings,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error rating blog post",
            error: error.message,
        });
    }
};

// @desc    Add comment to blog
// @route   POST /api/blogs/:id/comment
// @access  Private
export const addComment = async (req, res) => {
    try {
        const { id } = req.params;
        const { content, parentCommentId } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Comment content is required",
            });
        }

        const blog = await Blog.findById(id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        if (!blog.allowComments) {
            return res.status(403).json({
                success: false,
                message: "Comments are disabled for this blog post",
            });
        }

        const newComment = {
            user: req.user.id,
            userName: req.user.name,
            userAvatar: req.user.avatar,
            content: content.trim(),
        };

        if (parentCommentId) {
            // This is a reply
            newComment.parentComment = parentCommentId;

            const parentComment = blog.comments.id(parentCommentId);
            if (!parentComment) {
                return res.status(404).json({
                    success: false,
                    message: "Parent comment not found",
                });
            }

            blog.comments.push(newComment);
            await blog.save();

            // Add reply to parent comment
            const savedComment = blog.comments[blog.comments.length - 1];
            parentComment.replies.push(savedComment._id);
            await blog.save();
        } else {
            // This is a top-level comment
            blog.comments.push(newComment);
        }

        blog.commentCount = blog.comments.length;
        await blog.save();

        res.status(200).json({
            success: true,
            message: "Comment added successfully",
            data: blog.comments[blog.comments.length - 1],
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error adding comment",
            error: error.message,
        });
    }
};

// @desc    Like/Unlike blog
// @route   POST /api/blogs/:id/like
// @access  Private
export const toggleLike = async (req, res) => {
    try {
        const { id } = req.params;

        const blog = await Blog.findById(id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        const likeIndex = blog.likes.indexOf(req.user.id);

        if (likeIndex === -1) {
            // Like
            blog.likes.push(req.user.id);
        } else {
            // Unlike
            blog.likes.splice(likeIndex, 1);
        }

        blog.likeCount = blog.likes.length;
        await blog.save();

        res.status(200).json({
            success: true,
            message: likeIndex === -1 ? "Blog liked" : "Blog unliked",
            data: {
                liked: likeIndex === -1,
                likeCount: blog.likeCount,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error toggling like",
            error: error.message,
        });
    }
};

// @desc    Bookmark/Unbookmark blog
// @route   POST /api/blogs/:id/bookmark
// @access  Private
export const toggleBookmark = async (req, res) => {
    try {
        const { id } = req.params;

        const blog = await Blog.findById(id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        const bookmarkIndex = blog.bookmarks.indexOf(req.user.id);

        if (bookmarkIndex === -1) {
            blog.bookmarks.push(req.user.id);
        } else {
            blog.bookmarks.splice(bookmarkIndex, 1);
        }

        blog.bookmarkCount = blog.bookmarks.length;
        await blog.save();

        res.status(200).json({
            success: true,
            message: bookmarkIndex === -1 ? "Blog bookmarked" : "Bookmark removed",
            data: {
                bookmarked: bookmarkIndex === -1,
                bookmarkCount: blog.bookmarkCount,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error toggling bookmark",
            error: error.message,
        });
    }
};

// @desc    Get blog statistics
// @route   GET /api/blogs/stats
// @access  Private/Admin
export const getBlogStats = async (req, res) => {
    try {
        const totalBlogs = await Blog.countDocuments();
        const publishedBlogs = await Blog.countDocuments({ status: "PUBLISHED" });
        const draftBlogs = await Blog.countDocuments({ status: "DRAFT" });

        const totalViews = await Blog.aggregate([
            { $group: { _id: null, totalViews: { $sum: "$views" } } }
        ]);

        const totalComments = await Blog.aggregate([
            { $group: { _id: null, totalComments: { $sum: "$commentCount" } } }
        ]);

        const topCategories = await Blog.aggregate([
            { $match: { status: "PUBLISHED" } },
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: "categories",
                    localField: "_id",
                    foreignField: "_id",
                    as: "category",
                },
            },
            { $unwind: "$category" },
            { $project: { name: "$category.name", count: 1 } },
        ]);

        const topRated = await Blog.find({ status: "PUBLISHED" })
            .sort({ averageRating: -1 })
            .limit(5)
            .select("title averageRating totalRatings");

        res.status(200).json({
            success: true,
            data: {
                totalBlogs,
                publishedBlogs,
                draftBlogs,
                totalViews: totalViews[0]?.totalViews || 0,
                totalComments: totalComments[0]?.totalComments || 0,
                topCategories,
                topRated,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching blog statistics",
            error: error.message,
        });
    }
};