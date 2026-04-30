import mongoose from "mongoose";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";

/**
 * Get all OPEN sessions assigned to a sales person
 * - Filter by employeeId and assignedTo
 * - Only return sessions with SalesStatus: "open"
 * - Optimized with proper indexing and lean queries
 * - Returns paginated results for better performance
 */
export const getOpenSessions = async (req, res) => {
  try {
    const { salesPersonId, page = 1, limit = 20 } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({
        success: false,
        message: "salesPersonId is required"
      });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(salesPersonId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid salesPersonId format"
      });
    }

    const objId = new mongoose.Types.ObjectId(salesPersonId);
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Optimized query using compound index
    const query = {
      employeeId: objId,
      assignedTo: objId,
      SalesStatus: "open"
    };

    // Get total count for pagination metadata
    const totalCount = await SalesSession.countDocuments(query);

    // Execute optimized find with proper projections
    const sessions = await SalesSession.find(query)
      .select(
        "sessionId customer.companyName customer.contactName customer.phoneNumber customer.location status SalesStatus punchInTime punchOutTime updatedAt createdAt"
      )
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
      .exec();

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: sessions,
      pagination: {
        currentPage: pageNum,
        totalPages,
        pageSize: limitNum,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    console.error("Error in getOpenSessions:", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch open sessions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

/**
 * Get OPEN sessions by today's date for a sales person
 * - Filter by employeeId, assignedTo, and SalesStatus: "open"
 * - Check if created or updated TODAY
 * - Optimized with date range query
 */
export const getTodayOpenSessions = async (req, res) => {
  try {
    const { salesPersonId, page = 1, limit = 20 } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({
        success: false,
        message: "salesPersonId is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(salesPersonId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid salesPersonId format"
      });
    }

    const objId = new mongoose.Types.ObjectId(salesPersonId);
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Set date range for today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const query = {
      employeeId: objId,
      assignedTo: objId,
      SalesStatus: "open",
      $or: [
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
        { updatedAt: { $gte: startOfDay, $lte: endOfDay } }
      ]
    };

    const totalCount = await SalesSession.countDocuments(query);

    const sessions = await SalesSession.find(query)
      .select(
        "sessionId customer.companyName customer.contactName customer.phoneNumber customer.location status SalesStatus punchInTime punchOutTime updatedAt createdAt"
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
      .exec();

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: sessions,
      pagination: {
        currentPage: pageNum,
        totalPages,
        pageSize: limitNum,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      dateRange: {
        start: startOfDay.toISOString(),
        end: endOfDay.toISOString()
      }
    });
  } catch (error) {
    console.error("Error in getTodayOpenSessions:", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch today's open sessions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

/**
 * Get nearest OPEN sessions based on reference location
 * - Takes sessionId as reference (for location extraction)
 * - Finds nearest OPEN sessions within 50km
 * - Geospatial query with proper index utilization
 * - Returns limited results (default 4) with distance info
 */
export const getNearestOpenSessions = async (req, res) => {
  try {
    const { sessionId, salesPersonId, maxDistance = 50000, limit = 4 } = req.query;

    if (!sessionId || !salesPersonId) {
      return res.status(400).json({
        success: false,
        message: "Both sessionId and salesPersonId are required"
      });
    }

    // if (!mongoose.Types.ObjectId.isValid(salesPersonId)) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Invalid salesPersonId format"
    //   });
    // }

    const objId = new mongoose.Types.ObjectId(salesPersonId);
    const limitNum = Math.min(20, Math.max(1, parseInt(limit)));
    const maxDist = Math.max(1000, parseInt(maxDistance));

    // Fetch reference session with location
    const refSession = await SalesSession.findOne({ sessionId })
      .select("customer.location")
      .lean()
      .exec();

    if (!refSession?.customer?.location) {
      return res.status(404).json({
        success: false,
        message: "Reference session not found or missing location data"
      });
    }

    const { coordinates } = refSession.customer.location;

    // Validate coordinates
    if (
      !coordinates ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      !coordinates.every(c => isFinite(c))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid location coordinates in reference session"
      });
    }

    // Geospatial query for nearest open sessions
    const sessions = await SalesSession.find({
      employeeId: objId,
      assignedTo: objId,
      SalesStatus: "open",
      sessionId: { $ne: sessionId },
      "customer.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: coordinates
          },
          $maxDistance: maxDist,
          $minDistance: 0
        }
      }
    })
      .select(
        "sessionId customer.companyName customer.contactName customer.phoneNumber customer.location SalesStatus status updatedAt createdAt"
      )
      .limit(limitNum)
      .lean()
      .exec();

    return res.status(200).json({
      success: true,
      data: sessions,
      count: sessions.length,
      metadata: {
        referenceSessionId: sessionId,
        referenceLocation: {
          coordinates: coordinates,
          type: "Point"
        },
        maxRadius: maxDist,
        radiusKm: (maxDist / 1000).toFixed(2)
      }
    });
  } catch (error) {
    console.error("Error in getNearestOpenSessions:", error.message, error.stack);

    // Handle specific MongoDB geospatial errors
    if (error.message.includes("2dsphere") || error.code === 13034) {
      return res.status(500).json({
        success: false,
        message: "Geospatial index error. Ensure customer.location has 2dsphere index.",
        error: process.env.NODE_ENV === "development" ? error.message : undefined
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to fetch nearest open sessions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

/**
 * Get OPEN sessions with advanced filtering
 * - Filter by SalesStatus: "open"
 * - Optional filters: companyId, createdAfter, createdBefore, sortBy
 * - Supports pagination and multiple sort options
 * - Fully optimized for performance
 */
export const getFilteredOpenSessions = async (req, res) => {
  try {
    const {
      salesPersonId,
      companyId,
      createdAfter,
      createdBefore,
      sortBy = "updatedAt",
      sortOrder = "desc",
      page = 1,
      limit = 20
    } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({
        success: false,
        message: "salesPersonId is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(salesPersonId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid salesPersonId format"
      });
    }

    const objId = new mongoose.Types.ObjectId(salesPersonId);
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build dynamic query
    const query = {
      employeeId: objId,
      assignedTo: objId,
      SalesStatus: "open"
    };

    // Add optional company filter
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      query.companyId = new mongoose.Types.ObjectId(companyId);
    }

    // Add date range filters
    if (createdAfter || createdBefore) {
      query.createdAt = {};
      if (createdAfter) {
        const afterDate = new Date(createdAfter);
        if (!isNaN(afterDate.getTime())) {
          query.createdAt.$gte = afterDate;
        }
      }
      if (createdBefore) {
        const beforeDate = new Date(createdBefore);
        if (!isNaN(beforeDate.getTime())) {
          query.createdAt.$lte = beforeDate;
        }
      }
      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    // Validate and build sort object
    const validSortFields = ["updatedAt", "createdAt", "sessionId", "status"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "updatedAt";
    const sortDirection = sortOrder === "asc" ? 1 : -1;
    const sortObj = { [sortField]: sortDirection };

    const totalCount = await SalesSession.countDocuments(query);

    const sessions = await SalesSession.find(query)
      .select(
        "sessionId customer.companyName customer.contactName customer.phoneNumber customer.location status SalesStatus punchInTime punchOutTime updatedAt createdAt"
      )
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean()
      .exec();

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: sessions,
      pagination: {
        currentPage: pageNum,
        totalPages,
        pageSize: limitNum,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      filters: {
        companyId: companyId || null,
        createdAfter: createdAfter || null,
        createdBefore: createdBefore || null,
        sortBy: sortField,
        sortOrder: sortOrder
      }
    });
  } catch (error) {
    console.error("Error in getFilteredOpenSessions:", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filtered open sessions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

/**
 * Get summary statistics of OPEN sessions
 * - Count of open sessions by status
 * - Total sessions and breakdown
 * - Last updated timestamp
 * - Quick overview for dashboard
 */
export const getOpenSessionsStats = async (req, res) => {
  try {
    const { salesPersonId } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({
        success: false,
        message: "salesPersonId is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(salesPersonId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid salesPersonId format"
      });
    }

    const objId = new mongoose.Types.ObjectId(salesPersonId);

    // Aggregation pipeline for stats
    const stats = await SalesSession.aggregate([
      {
        $match: {
          employeeId: objId,
          assignedTo: objId,
          SalesStatus: "open"
        }
      },
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          byStatus: [
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ],
          recentUpdates: [
            { $sort: { updatedAt: -1 } },
            { $limit: 1 },
            { $project: { updatedAt: 1 } }
          ],
          withLocation: [
            {
              $match: { "customer.location": { $exists: true, $ne: null } }
            },
            { $count: "count" }
          ]
        }
      }
    ]);

    const result = {
      totalOpenSessions: stats[0]?.totalCount[0]?.count || 0,
      byStatus: stats[0]?.byStatus || [],
      sessionsWithLocation: stats[0]?.withLocation[0]?.count || 0,
      lastUpdate: stats[0]?.recentUpdates[0]?.updatedAt || null
    };

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Error in getOpenSessionsStats:", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch open sessions statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};