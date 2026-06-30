import Category from "../../models/Blog/Category.js";
import Blog from "../../models/Blog/Blog.js";
import { uploadToCloudinary } from "../../utils/Cloudinary.js";


// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
export const createCategory = async (req, res) => {
    try {
        const { name, description, icon, subCategories, parentCategory } = req.body;

        // Validate required fields
        if (!name || name.trim() === '') {
            return res.status(400).json({
                success: false,
                message: "Category name is required",
            });
        }

        // Check if category exists
        const existingCategory = await Category.findOne({ 
            name: { $regex: new RegExp(`^${name}$`, 'i') } 
        });
        
        if (existingCategory) {
            return res.status(400).json({
                success: false,
                message: "Category with this name already exists",
            });
        }

        // Handle image upload if file is provided
        let imageUrl = null;
        if (req.file) {
            try {
                const result = await uploadToCloudinary(req.file.buffer, 'categories');
                imageUrl = result.secure_url;
            } catch (uploadError) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to upload image",
                    error: uploadError.message,
                });
            }
        }

        const category = await Category.create({
            name: name.trim(),
            description: description || '',
            image: imageUrl,
            icon: icon || '📁',
            subCategories: subCategories || [],
            parentCategory: parentCategory || null,
            createdBy: req.user.id,
        });

        res.status(201).json({
            success: true,
            message: "Category created successfully",
            data: category,
        });
    } catch (error) {
        // Handle validation errors specifically
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation error",
                errors: errors,
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Error creating category",
            error: error.message,
        });
    }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };

        // Validate name if provided
        if (updates.name && updates.name.trim() === '') {
            return res.status(400).json({
                success: false,
                message: "Category name cannot be empty",
            });
        }

        // Check if category exists with new name
        if (updates.name) {
            const existingCategory = await Category.findOne({
                name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
                _id: { $ne: id }
            });
            
            if (existingCategory) {
                return res.status(400).json({
                    success: false,
                    message: "Category with this name already exists",
                });
            }
        }

        // Handle image upload if new file is provided
        if (req.file) {
            try {
                const result = await uploadToCloudinary(req.file.buffer, 'categories');
                updates.image = result.secure_url;
            } catch (uploadError) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to upload image",
                    error: uploadError.message,
                });
            }
        }

        // Clean up updates
        if (updates.name) updates.name = updates.name.trim();

        const category = await Category.findByIdAndUpdate(id, updates, {
            new: true,
            runValidators: true,
        });

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Category updated successfully",
            data: category,
        });
    } catch (error) {
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation error",
                errors: errors,
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Error updating category",
            error: error.message,
        });
    }
};

// ... rest of your controller remains the same

// @desc    Get all categories with subcategories
// @route   GET /api/categories
// @access  Public
export const getAllCategories = async (req, res) => {
    try {
        const { parentOnly, includeInactive } = req.query;

        let query = {};

        if (parentOnly === "true") {
            query.parentCategory = null;
        }

        if (!includeInactive) {
            query.isActive = true;
        }

        const categories = await Category.find(query)
            .sort({ order: 1, name: 1 })
            .populate("parentCategory", "name slug");

        res.status(200).json({
            success: true,
            count: categories.length,
            data: categories,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching categories",
            error: error.message,
        });
    }
};

// @desc    Get single category with subcategories
// @route   GET /api/categories/:id
// @access  Public
export const getCategoryById = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await Category.findById(id)
            .populate("parentCategory", "name slug");

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        // Get blog count for this category
        const blogCount = await Blog.countDocuments({
            category: id,
            status: "PUBLISHED"
        });

        res.status(200).json({
            success: true,
            data: {
                ...category.toObject(),
                blogCount,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching category",
            error: error.message,
        });
    }
};

// @desc    Get category by slug
// @route   GET /api/categories/slug/:slug
// @access  Public
export const getCategoryBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        const category = await Category.findOne({ slug })
            .populate("parentCategory", "name slug");

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        res.status(200).json({
            success: true,
            data: category,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching category",
            error: error.message,
        });
    }
};



// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
export const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if category has blogs
        const blogCount = await Blog.countDocuments({ category: id });
        if (blogCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete category. It has ${blogCount} blog posts. Please reassign or delete them first.`,
            });
        }

        const category = await Category.findByIdAndDelete(id);

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Category deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting category",
            error: error.message,
        });
    }
};

// @desc    Add subcategory to category
// @route   POST /api/categories/:id/subcategories
// @access  Private/Admin
export const addSubCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, image } = req.body;

        const category = await Category.findById(id);

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        // Check if subcategory already exists
        const subExists = category.subCategories.some(
            sub => sub.name.toLowerCase() === name.toLowerCase()
        );

        if (subExists) {
            return res.status(400).json({
                success: false,
                message: "Subcategory with this name already exists in this category",
            });
        }

        category.subCategories.push({
            name,
            description,
            image,
            order: category.subCategories.length,
        });

        await category.save();

        res.status(200).json({
            success: true,
            message: "Subcategory added successfully",
            data: category,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error adding subcategory",
            error: error.message,
        });
    }
};

// @desc    Get blogs by category
// @route   GET /api/categories/:id/blogs
// @access  Public
export const getBlogsByCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 10, sort = "-createdAt" } = req.query;

        const blogs = await Blog.find({
            category: id,
            status: "PUBLISHED"
        })
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate("author", "name avatar")
            .populate("category", "name slug")
            .select("title slug excerpt featuredImage author authorName createdAt views likeCount commentCount averageRating readTime");

        const total = await Blog.countDocuments({
            category: id,
            status: "PUBLISHED"
        });

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
            message: "Error fetching blogs by category",
            error: error.message,
        });
    }
};