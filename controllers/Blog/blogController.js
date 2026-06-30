import Blog from "../../models/Blog/Blog.js";
import Category from "../../models/Blog/Category.js";
import { uploadToCloudinary } from "../../utils/Cloudinary.js";

// @desc    Create blog post
// @route   POST /api/blogs
// @access  Private
export const createBlog = async (req, res) => {
    try {
        console.log('Request body:', req.body);
        console.log('Request files:', req.files);
        console.log('Request user:', req.user);

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

        // Validate required fields
        if (!title) {
            return res.status(400).json({
                success: false,
                message: "Blog title is required",
            });
        }

        if (!content) {
            return res.status(400).json({
                success: false,
                message: "Blog content is required",
            });
        }

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
                sub => sub.name === subCategory || sub.slug === subCategory
            );
            if (!subExists) {
                return res.status(400).json({
                    success: false,
                    message: "Subcategory not found in selected category",
                });
            }
        }

        // Handle image uploads with proper structure
        let featuredImageObj = {
            url: "https://via.placeholder.com/800x400?text=No+Image",
            public_id: "default",
            altText: title || 'Blog featured image',
        };
        let galleryArray = [];

        // Upload featured image if provided
        if (req.files?.featuredImage && req.files.featuredImage.length > 0) {
            try {
                const result = await uploadToCloudinary(
                    req.files.featuredImage[0].buffer,
                    'blogs/featured'
                );
                featuredImageObj = {
                    url: result.secure_url,
                    public_id: result.public_id,
                    altText: title || 'Blog featured image',
                };
            } catch (uploadError) {
                console.error('Featured image upload failed:', uploadError);
                // Continue with default image
            }
        }

        // Upload gallery images if provided
        if (req.files?.gallery && req.files.gallery.length > 0) {
            try {
                const uploadPromises = req.files.gallery.map(file =>
                    uploadToCloudinary(file.buffer, 'blogs/gallery')
                );
                const results = await Promise.all(uploadPromises);
                galleryArray = results.map((result, index) => ({
                    url: result.secure_url,
                    public_id: result.public_id,
                    altText: `${title} gallery image ${index + 1}`,
                }));
            } catch (uploadError) {
                console.error('Gallery image upload failed:', uploadError);
                // Continue without gallery images
            }
        }

        // Parse tags and metaKeywords safely
        let parsedTags = [];
        let parsedMetaKeywords = [];

        try {
            parsedTags = tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [];
        } catch (e) {
            parsedTags = tags ? tags.split(',').map(t => t.trim()) : [];
        }

        try {
            parsedMetaKeywords = metaKeywords ? (typeof metaKeywords === 'string' ? JSON.parse(metaKeywords) : metaKeywords) : [];
        } catch (e) {
            parsedMetaKeywords = metaKeywords ? metaKeywords.split(',').map(k => k.trim()) : [];
        }

        // Fix: Get author info from req.user with fallbacks
        const authorId = req.user?.id || req.user?._id || req.user?.userId;
        const authorName = req.user?.name || req.user?.username || req.user?.fullName || 'Anonymous';
        const authorAvatar = req.user?.avatar || req.user?.profilePicture || req.user?.image || null;

        console.log('Author info:', { authorId, authorName, authorAvatar });

        const blogData = {
            title,
            content,
            excerpt: excerpt || content.substring(0, 200),
            category,
            subCategory,
            tags: parsedTags,
            featuredImage: featuredImageObj,
            gallery: galleryArray,
            author: authorId,
            authorName: authorName,
            authorAvatar: authorAvatar,
            status,
            allowComments: allowComments === true || allowComments === 'true',
            metaTitle: metaTitle || title,
            metaDescription: metaDescription || excerpt || content.substring(0, 160),
            metaKeywords: parsedMetaKeywords,
            scheduledAt: status === "SCHEDULED" ? scheduledAt : null,
            publishedAt: status === "PUBLISHED" ? new Date() : null,
        };

        console.log('Creating blog with data:', JSON.stringify(blogData, null, 2));

        const blog = await Blog.create(blogData);

        // Update category blog count
        await Category.findByIdAndUpdate(category, {
            $inc: { blogCount: 1 }
        });

        // Populate the blog with category and author details
        const populatedBlog = await Blog.findById(blog._id)
            .populate('category', 'name slug')
            .populate('author', 'name avatar');

        res.status(201).json({
            success: true,
            message: "Blog post created successfully",
            data: populatedBlog,
        });
    } catch (error) {
        console.error('Create blog error:', error);
        console.error('Error details:', error.errors);
        res.status(500).json({
            success: false,
            message: "Error creating blog post",
            error: error.message,
            details: error.errors
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
        const blogAuthorId = blog.author.toString();
        const userId = req.user?.id || req.user?._id || req.user?.userId;
        
        if (blogAuthorId !== userId && req.user?.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Not authorized to update this blog post",
            });
        }

        // Handle image uploads for update
        if (req.files?.featuredImage && req.files.featuredImage.length > 0) {
            try {
                const result = await uploadToCloudinary(
                    req.files.featuredImage[0].buffer,
                    'blogs/featured'
                );
                updates.featuredImage = {
                    url: result.secure_url,
                    public_id: result.public_id,
                    altText: updates.title || blog.title,
                };
            } catch (uploadError) {
                console.error('Featured image upload failed:', uploadError);
            }
        }

        // Upload new gallery images if provided
        if (req.files?.gallery && req.files.gallery.length > 0) {
            try {
                const uploadPromises = req.files.gallery.map(file =>
                    uploadToCloudinary(file.buffer, 'blogs/gallery')
                );
                const results = await Promise.all(uploadPromises);
                const newGalleryUrls = results.map((result, index) => ({
                    url: result.secure_url,
                    public_id: result.public_id,
                    altText: `${updates.title || blog.title} gallery image ${index + 1}`,
                }));

                // Merge with existing gallery or replace
                if (updates.appendToGallery) {
                    updates.gallery = [...(blog.gallery || []), ...newGalleryUrls];
                } else {
                    updates.gallery = newGalleryUrls;
                }
            } catch (uploadError) {
                console.error('Gallery upload failed:', uploadError);
            }
        }

        // Add to revision history if content changed
        if (updates.content && updates.content !== blog.content) {
            blog.revisionHistory.push({
                content: blog.content,
                updatedBy: userId,
                updatedAt: new Date(),
            });
            blog.version += 1;
        }

        // Update fields
        Object.keys(updates).forEach(key => {
            if (key !== "_id" && key !== "author" && key !== "appendToGallery") {
                blog[key] = updates[key];
            }
        });

        // Handle status change
        if (updates.status === "PUBLISHED" && !blog.publishedAt) {
            blog.publishedAt = new Date();
        }

        await blog.save();

        // Populate the updated blog
        const populatedBlog = await Blog.findById(blog._id)
            .populate('category', 'name slug')
            .populate('author', 'name avatar');

        res.status(200).json({
            success: true,
            message: "Blog post updated successfully",
            data: populatedBlog,
        });
    } catch (error) {
        console.error('Update blog error:', error);
        res.status(500).json({
            success: false,
            message: "Error updating blog post",
            error: error.message,
        });
    }
};

// @desc    Get all blogs with filtering, sorting, and pagination
// @route   GET /api/blogs
// @access  Public
export const getBlogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            sort = '-createdAt',
            search,
            category,
            status,
            author,
            tag,
            isFeatured,
            isTrending,
            isEditorPick,
        } = req.query;

        // Build filter object
        const filter = {};

        // Text search
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } },
            ];
        }

        // Category filter
        if (category) {
            filter.category = category;
        }

        // Status filter
        if (status) {
            filter.status = status;
        }

        // Author filter
        if (author) {
            filter.author = author;
        }

        // Tag filter
        if (tag) {
            filter.tags = tag;
        }

        // Feature flags
        if (isFeatured === 'true') filter.isFeatured = true;
        if (isTrending === 'true') filter.isTrending = true;
        if (isEditorPick === 'true') filter.isEditorPick = true;

        // Calculate pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Get total count
        const totalBlogs = await Blog.countDocuments(filter);

        // Get blogs with pagination
        const blogs = await Blog.find(filter)
            .populate('category', 'name slug icon')
            .populate('author', 'name avatar')
            .sort(sort)
            .skip(skip)
            .limit(limitNum);

        res.status(200).json({
            success: true,
            count: blogs.length,
            data: blogs,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalBlogs / limitNum),
                totalBlogs,
                limit: limitNum,
            },
        });
    } catch (error) {
        console.error('Get blogs error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching blog posts",
            error: error.message,
        });
    }
};

// @desc    Get single blog by ID
// @route   GET /api/blogs/:id
// @access  Public
export const getBlogById = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id)
            .populate('category', 'name slug icon')
            .populate('author', 'name avatar bio')
            .populate('relatedPosts', 'title slug featuredImage.url excerpt');

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Increment view count
        blog.views += 1;
        await blog.save();

        res.status(200).json({
            success: true,
            data: blog,
        });
    } catch (error) {
        console.error('Get blog by ID error:', error);
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
        const blog = await Blog.findById(req.params.id);

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        // Check ownership (unless admin)
        const blogAuthorId = blog.author.toString();
        const userId = req.user?.id || req.user?._id || req.user?.userId;
        
        if (blogAuthorId !== userId && req.user?.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Not authorized to delete this blog post",
            });
        }

        // Delete images from Cloudinary if needed
        if (blog.featuredImage?.public_id && blog.featuredImage.public_id !== 'default') {
            try {
                await uploadToCloudinary.destroy(blog.featuredImage.public_id);
            } catch (error) {
                console.error('Failed to delete featured image:', error);
            }
        }

        if (blog.gallery && blog.gallery.length > 0) {
            for (const image of blog.gallery) {
                if (image.public_id) {
                    try {
                        await uploadToCloudinary.destroy(image.public_id);
                    } catch (error) {
                        console.error('Failed to delete gallery image:', error);
                    }
                }
            }
        }

        await Blog.findByIdAndDelete(req.params.id);

        // Update category blog count
        if (blog.category) {
            await Category.findByIdAndUpdate(blog.category, {
                $inc: { blogCount: -1 }
            });
        }

        res.status(200).json({
            success: true,
            message: "Blog post deleted successfully",
        });
    } catch (error) {
        console.error('Delete blog error:', error);
        res.status(500).json({
            success: false,
            message: "Error deleting blog post",
            error: error.message,
        });
    }
};

// @desc    Toggle like on blog post
// @route   POST /api/blogs/:id/like
// @access  Private
export const toggleLike = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id);
        const userId = req.user?.id || req.user?._id || req.user?.userId;

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        const isLiked = blog.likes.includes(userId);

        if (isLiked) {
            // Unlike
            blog.likes = blog.likes.filter(id => id.toString() !== userId);
            blog.likeCount = Math.max(0, blog.likeCount - 1);
        } else {
            // Like
            blog.likes.push(userId);
            blog.likeCount += 1;
        }

        await blog.save();

        res.status(200).json({
            success: true,
            data: {
                isLiked: !isLiked,
                likeCount: blog.likeCount,
            },
        });
    } catch (error) {
        console.error('Toggle like error:', error);
        res.status(500).json({
            success: false,
            message: "Error toggling like",
            error: error.message,
        });
    }
};

// @desc    Toggle bookmark on blog post
// @route   POST /api/blogs/:id/bookmark
// @access  Private
export const toggleBookmark = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id);
        const userId = req.user?.id || req.user?._id || req.user?.userId;

        if (!blog) {
            return res.status(404).json({
                success: false,
                message: "Blog post not found",
            });
        }

        const isBookmarked = blog.bookmarks.includes(userId);

        if (isBookmarked) {
            // Remove bookmark
            blog.bookmarks = blog.bookmarks.filter(id => id.toString() !== userId);
            blog.bookmarkCount = Math.max(0, blog.bookmarkCount - 1);
        } else {
            // Add bookmark
            blog.bookmarks.push(userId);
            blog.bookmarkCount += 1;
        }

        await blog.save();

        res.status(200).json({
            success: true,
            data: {
                isBookmarked: !isBookmarked,
                bookmarkCount: blog.bookmarkCount,
            },
        });
    } catch (error) {
        console.error('Toggle bookmark error:', error);
        res.status(500).json({
            success: false,
            message: "Error toggling bookmark",
            error: error.message,
        });
    }
};