import Advertistment from "../../models/Attandance/Advertistment.js";
import AdvertisementCategory from "../../models/Attandance/AdvertisementCategory.js";
import mongoose from "mongoose";
import { uploadToCloudinary } from "../../utils/Cloudinary.js";
import fs from 'fs';
import path from 'path';




// @desc    Create a new advertisement with image upload
// @route   POST /api/advertisements
// @access  Private/Admin
export const createAdvertisementAdmin = async (req, res) => {
    try {
        const { title, description, linkUrl, category, status, companyId } = req.body;

        // Validate required fields
        if (!title || !description || !linkUrl || !category) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required fields: title, description, linkUrl, category"
            });
        }

        // Check if category exists
        const categoryExists = await AdvertisementCategory.findById(category);
        if (!categoryExists) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        let imageUrl = '';

        // Handle image upload if file is present
        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'advertisements');
                imageUrl = uploadResult.secure_url;
            } catch (uploadError) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to upload image",
                    error: uploadError.message
                });
            }
        } else if (req.body.imageUrl) {
            // If no file but imageUrl is provided in body (for backward compatibility)
            imageUrl = req.body.imageUrl;
        } else {
            return res.status(400).json({
                success: false,
                message: "Please provide an image (file upload or URL)"
            });
        }

        // Create advertisement
        const advertisement = await Advertistment.create({
            title,
            description,
            companyId,
            imageUrl,
            linkUrl,
            category,
            status: status || 'active'
        });

        // Populate category details
        const populatedAd = await Advertistment.findById(advertisement._id)
            .populate('category', 'name slug status');

        res.status(201).json({
            success: true,
            message: "Advertisement created successfully",
            data: populatedAd
        });

    } catch (error) {
        console.error('Create advertisement error:', error);
        res.status(500).json({
            success: false,
            message: "Error creating advertisement",
            error: error.message
        });
    }
};

export const createAdvertisement = async (req, res) => {
    try {
        const { title, description, linkUrl, category, status } = req.body;
        // Validate required fields
        const companyId = req.user?._id || req.user?.id

        if (!title || !description || !linkUrl || !category) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required fields: title, description, linkUrl, category"
            });
        }

        // Check if category exists
        const categoryExists = await AdvertisementCategory.findById(category);
        if (!categoryExists) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        let imageUrl = '';

        // Handle image upload if file is present
        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'advertisements');
                imageUrl = uploadResult.secure_url;
            } catch (uploadError) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to upload image",
                    error: uploadError.message
                });
            }
        } else if (req.body.imageUrl) {
            // If no file but imageUrl is provided in body (for backward compatibility)
            imageUrl = req.body.imageUrl;
        } else {
            return res.status(400).json({
                success: false,
                message: "Please provide an image (file upload or URL)"
            });
        }

        // Create advertisement
        const advertisement = await Advertistment.create({
            title,
            description,
            companyId,
            imageUrl,
            linkUrl,
            category,
            status: status || 'active'
        });

        // Populate category details
        const populatedAd = await Advertistment.findById(advertisement._id)
            .populate('category', 'name slug status');

        res.status(201).json({
            success: true,
            message: "Advertisement created successfully",
            data: populatedAd
        });

    } catch (error) {
        console.error('Create advertisement error:', error);
        res.status(500).json({
            success: false,
            message: "Error creating advertisement",
            error: error.message
        });
    }
};

// @desc    Update an existing advertisement with optional image upload
// @route   PUT /api/advertisements/:id
// @access  Private/Admin
export const updateAdvertisementadmin = async (req, res) => {
    try {
        const { id } = req.params;

        const { title, description, linkUrl, category, status, companyId } = req.body;

        // Validate ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid advertisement ID format"
            });
        }

        // Check if advertisement exists
        const advertisement = await Advertistment.findById(id);
        if (!advertisement) {
            return res.status(404).json({
                success: false,
                message: "Advertisement not found"
            });
        }

        // If category is being updated, check if it exists
        if (category) {
            const categoryExists = await AdvertisementCategory.findById(category);
            if (!categoryExists) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid category ID"
                });
            }
        }

        // Prepare update data
        const updateData = {
            companyId: companyId || advertisement.companyId,
            title: title || advertisement.title,
            description: description || advertisement.description,
            linkUrl: linkUrl || advertisement.linkUrl,
            category: category || advertisement.category,
            status: status || advertisement.status
        };

        // Handle image upload if new file is provided
        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'advertisements');
                updateData.imageUrl = uploadResult.secure_url;
            } catch (uploadError) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to upload new image",
                    error: uploadError.message
                });
            }
        } else if (req.body.imageUrl && req.body.imageUrl !== advertisement.imageUrl) {
            // If imageUrl is provided in body and it's different from current
            updateData.imageUrl = req.body.imageUrl;
        }

        // Update advertisement
        const updatedAdvertisement = await Advertistment.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('category', 'name slug status');

        res.status(200).json({
            success: true,
            message: "Advertisement updated successfully",
            data: updatedAdvertisement
        });

    } catch (error) {
        console.error('Update advertisement error:', error);
        res.status(500).json({
            success: false,
            message: "Error updating advertisement",
            error: error.message
        });
    }
};

export const updateAdvertisement = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?._id || req.user?.id
        const { title, description, linkUrl, category, status } = req.body;

        // Validate ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid advertisement ID format"
            });
        }

        // Check if advertisement exists
        const advertisement = await Advertistment.findById(id);
        if (!advertisement) {
            return res.status(404).json({
                success: false,
                message: "Advertisement not found"
            });
        }

        // If category is being updated, check if it exists
        if (category) {
            const categoryExists = await AdvertisementCategory.findById(category);
            if (!categoryExists) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid category ID"
                });
            }
        }

        // Prepare update data
        const updateData = {
            companyId: companyId || advertisement.companyId,
            title: title || advertisement.title,
            description: description || advertisement.description,
            linkUrl: linkUrl || advertisement.linkUrl,
            category: category || advertisement.category,
            status: status || advertisement.status
        };

        // Handle image upload if new file is provided
        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'advertisements');
                updateData.imageUrl = uploadResult.secure_url;
            } catch (uploadError) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to upload new image",
                    error: uploadError.message
                });
            }
        } else if (req.body.imageUrl && req.body.imageUrl !== advertisement.imageUrl) {
            // If imageUrl is provided in body and it's different from current
            updateData.imageUrl = req.body.imageUrl;
        }

        // Update advertisement
        const updatedAdvertisement = await Advertistment.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('category', 'name slug status');

        res.status(200).json({
            success: true,
            message: "Advertisement updated successfully",
            data: updatedAdvertisement
        });

    } catch (error) {
        console.error('Update advertisement error:', error);
        res.status(500).json({
            success: false,
            message: "Error updating advertisement",
            error: error.message
        });
    }
};

// @desc    Delete an advertisement
// @route   DELETE /api/advertisements/:id
// @access  Private/Admin
export const deleteAdvertisement = async (req, res) => {
    try {
        const { id } = req.params;

        const advertisement = await Advertistment.findById(id);
        if (!advertisement) {
            return res.status(404).json({
                success: false,
                message: "Advertisement not found"
            });
        }

        await advertisement.deleteOne();

        res.status(200).json({
            success: true,
            message: "Advertisement deleted successfully"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting advertisement",
            error: error.message
        });
    }
};

// @desc    Toggle advertisement status (active/inactive)
// @route   PATCH /api/advertisements/:id/toggle-status
// @access  Private/Admin
export const toggleAdvertisementStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const advertisement = await Advertistment.findById(id);
        if (!advertisement) {
            return res.status(404).json({
                success: false,
                message: "Advertisement not found"
            });
        }

        // Toggle status
        advertisement.status = advertisement.status === "active" ? "inactive" : "active";
        await advertisement.save();

        const updatedAd = await Advertistment.findById(id)
            .populate('category', 'name slug');

        res.status(200).json({
            success: true,
            message: `Advertisement status toggled to ${advertisement.status}`,
            data: updatedAd
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error toggling advertisement status",
            error: error.message
        });
    }
};

// @desc    Get only active advertisements
// @route   GET /api/advertisements/active
// @access  Public
export const getActiveAdvertisements = async (req, res) => {
    try {
        // Pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Filter by category if provided
        const filter = { status: "active" };
        if (req.query.category) {
            filter.category = req.query.category;
        }

        const advertisements = await Advertistment.find(filter)
            .populate('category', 'name slug description')
            .sort('-createdAt')
            .skip(skip)
            .limit(limit);

        const total = await Advertistment.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: advertisements,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching active advertisements",
            error: error.message
        });
    }
};

// @desc    Get all advertisements (with filters and pagination)
// @route   GET /api/advertisements
// @access  Public/Admin
export const getAllAdminAdvertisements = async (req, res) => {
    try {
        // Pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Build filter
        const filter = {};

        // Filter by status
        if (req.query.status) {
            filter.status = req.query.status;
        }

        // Filter by category
        if (req.query.category) {
            filter.category = req.query.category;
        }

        // Search by title or description
        if (req.query.search) {
            filter.$or = [
                { title: { $regex: req.query.search, $options: 'i' } },
                { description: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        // Date range filter
        if (req.query.startDate || req.query.endDate) {
            filter.createdAt = {};
            if (req.query.startDate) {
                filter.createdAt.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filter.createdAt.$lte = new Date(req.query.endDate);
            }
        }

        // Sorting
        const sort = {};
        if (req.query.sortBy) {
            const parts = req.query.sortBy.split(':');
            sort[parts[0]] = parts[1] === 'desc' ? -1 : 1;
        } else {
            sort.createdAt = -1; // Default sort by newest
        }

        const advertisements = await Advertistment.find(filter)
            .populate('category', 'name slug description status')
            .sort(sort)
            .skip(skip)
            .limit(limit);

        const total = await Advertistment.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: advertisements,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching advertisements",
            error: error.message
        });
    }
};



export const getAllAdvertisements = async (req, res) => {
    try {
        // ==============================
        // 1. INPUT EXTRACTION
        // ==============================
        const {
            companyId: queryCompanyId,
            status,
            category,
            search,
            startDate,
            endDate,
            sortBy,
            page = 1,
            limit = 10
        } = req.query;

        const userCompanyId = req.user?._id || req.user?.id;

        const parsedPage = Math.max(parseInt(page), 1);
        const parsedLimit = Math.min(parseInt(limit), 100);
        const skip = (parsedPage - 1) * parsedLimit;

        // ==============================
        // 2. FILTER BUILDER (Clean)
        // ==============================
        const filter = {};

        // 🔥 Company Logic (Corrected)
        if (queryCompanyId) {
            filter.companyId = new mongoose.Types.ObjectId(queryCompanyId);
        } else if (userCompanyId) {
            filter.companyId = new mongoose.Types.ObjectId(userCompanyId);
        } else {
            // Only global ads
            filter.companyId = null;
        }

        // Status filter
        if (status) {
            filter.status = status;
        }

        // Category filter
        if (category) {
            filter.category = new mongoose.Types.ObjectId(category);
        }

        // Search (indexed + safe)
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } }
            ];
        }

        // Date filter (normalized)
        if (startDate || endDate) {
            filter.createdAt = {};

            if (startDate) {
                filter.createdAt.$gte = new Date(startDate + "T00:00:00.000Z");
            }

            if (endDate) {
                filter.createdAt.$lte = new Date(endDate + "T23:59:59.999Z");
            }
        }

        // ==============================
        // 3. SORTING
        // ==============================
        let sort = { createdAt: -1 };

        if (sortBy) {
            const [field, order] = sortBy.split(":");
            sort = { [field]: order === "desc" ? -1 : 1 };
        }

        // ==============================
        // 4. QUERY EXECUTION (Optimized)
        // ==============================
        const [advertisements, total] = await Promise.all([
            Advertistment.find(filter)
                .populate("category", "name slug")
                .populate("companyId", "name email")
                .sort(sort)
                .skip(skip)
                .limit(parsedLimit)
                .lean(), // 🔥 performance boost

            Advertistment.countDocuments(filter)
        ]);

        // ==============================
        // 5. RESPONSE
        // ==============================
        return res.status(200).json({
            success: true,
            data: advertisements,
            meta: {
                type: queryCompanyId || userCompanyId ? "company_specific" : "global",
                pagination: {
                    page: parsedPage,
                    limit: parsedLimit,
                    total,
                    pages: Math.ceil(total / parsedLimit)
                }
            }
        });

    } catch (error) {
        console.error("Advertisement Fetch Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch advertisements",
            error: error.message
        });
    }
};


// @desc    Get single advertisement by ID
// @route   GET /api/advertisements/:id
// @access  Public
export const getAdvertisementById = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid advertisement ID format"
            });
        }

        const advertisement = await Advertistment.findById(id)
            .populate('category', 'name slug description');

        if (!advertisement) {
            return res.status(404).json({
                success: false,
                message: "Advertisement not found"
            });
        }

        res.status(200).json({
            success: true,
            data: advertisement
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching advertisement",
            error: error.message
        });
    }
};




// @desc    Get advertisements by category
// @route   GET /api/advertisements/category/:categoryId
// @access  Public

export const getAdvertisementsByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;

        let companyId = req.query.companyId || req.user?._id;

        // Normalize companyId
        if (!companyId || ["null", "undefined", ""].includes(companyId)) {
            companyId = null;
        }

        if (companyId && typeof companyId === "string") {
            if (!mongoose.Types.ObjectId.isValid(companyId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid companyId format"
                });
            }
            companyId = new mongoose.Types.ObjectId(companyId);
        }

        // Validate category
        const category = await AdvertisementCategory.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found"
            });
        }

        // Pagination
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // ================= CORE FILTER =================
        const baseFilter = {
            category: new mongoose.Types.ObjectId(categoryId),
            status: req.query.status || "active"
        };

        let companyFilter;

        if (companyId) {
            // Company + Global
            companyFilter = {
                $or: [
                    { companyId: companyId },
                    { companyId: null }
                ]
            };
        } else {
            // Only Global
            companyFilter = {
                companyId: null
            };
        }

        const finalFilter = {
            ...baseFilter,
            ...companyFilter
        };

        // ================= QUERY =================
        const [advertisements, total] = await Promise.all([
            Advertistment.find(finalFilter)
                .populate('category', 'name slug')
                .populate('companyId', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            Advertistment.countDocuments(finalFilter)
        ]);

        return res.status(200).json({
            success: true,
            category: {
                id: category._id,
                name: category.name,
                slug: category.slug
            },
            data: advertisements,
            type: companyId ? "company_and_global" : "global_only",
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Error in getAdvertisementsByCategory:", error);
        return res.status(500).json({
            success: false,
            message: "Error fetching advertisements",
            error: error.message
        });
    }
};




export const getWithEmpAdvertisementsByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;

        // ================= VALIDATION =================
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid categoryId"
            });
        }

        // ================= CHECK CATEGORY =================
        const category = await AdvertisementCategory.findById(categoryId)
            .select("name slug")
            .lean();

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found"
            });
        }

        // ================= PAGINATION =================
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 10, 50); // cap at 50
        const skip = (page - 1) * limit;

        // ================= FILTER =================
        const filter = {
            category: new mongoose.Types.ObjectId(categoryId),
            companyId: null   // ✅ only ads without company
        };

        if (req.query.status) {
            filter.status = req.query.status;
        }

        // ================= QUERY (PARALLEL) =================
        const [advertisements, total] = await Promise.all([
            Advertistment.find(filter)
                .populate("category", "name slug")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            Advertistment.countDocuments(filter)
        ]);

        // ================= RESPONSE =================
        return res.status(200).json({
            success: true,
            category: {
                id: category._id,
                name: category.name,
                slug: category.slug
            },
            data: advertisements,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("getWithEmpAdvertisementsByCategory Error:", error);

        return res.status(500).json({
            success: false,
            message: "Error fetching advertisements by category",
            error: error.message
        });
    }
};
// @desc    Bulk update advertisements status
// @route   PATCH /api/advertisements/bulk-status
// @access  Private/Admin
export const bulkUpdateStatus = async (req, res) => {
    try {
        const { advertisementIds, status } = req.body;

        if (!advertisementIds || !Array.isArray(advertisementIds) || advertisementIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide an array of advertisement IDs"
            });
        }

        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Status must be either 'active' or 'inactive'"
            });
        }

        const result = await Advertistment.updateMany(
            { _id: { $in: advertisementIds } },
            { $set: { status } }
        );

        res.status(200).json({
            success: true,
            message: `Updated ${result.modifiedCount} advertisements`,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error bulk updating advertisements",
            error: error.message
        });
    }
};

// @desc    Delete multiple advertisements
// @route   DELETE /api/advertisements/bulk
// @access  Private/Admin
export const bulkDeleteAdvertisements = async (req, res) => {
    try {
        const { advertisementIds } = req.body;

        if (!advertisementIds || !Array.isArray(advertisementIds) || advertisementIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide an array of advertisement IDs"
            });
        }

        const result = await Advertistment.deleteMany({
            _id: { $in: advertisementIds }
        });

        res.status(200).json({
            success: true,
            message: `Deleted ${result.deletedCount} advertisements`,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error bulk deleting advertisements",
            error: error.message
        });
    }
};