// controllers/dashboardController.js
import User from "../../models/userModel.js";
import { Subscription } from "../../models/Attandance/subscration/Subscription.js";
import Plan from "../../models/Attandance/subscration/plan.js";
import PaymentLog from "../../models/Attandance/subscration/PaymentLog.js";
import mongoose from "mongoose";

/**
 * Get dashboard statistics (KPI cards data)
 * @route GET /api/admin/dashboard/stats
 */
export const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Get total users
    const totalUsers = await User.countDocuments({ 
      accountStatus: "ACTIVE" 
    });
    
    // Get new users this month
    const newUsersThisMonth = await User.countDocuments({
      createdAt: { $gte: startOfMonth },
      accountStatus: "ACTIVE"
    });
    
    // Get new users last month
    const newUsersLastMonth = await User.countDocuments({
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      accountStatus: "ACTIVE"
    });
    
    const userGrowthRate = newUsersLastMonth > 0 
      ? ((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth) * 100 
      : 0;

    // Get active subscriptions
    const activeSubscriptions = await Subscription.countDocuments({
      status: "ACTIVE",
      endDate: { $gt: now }
    });
    
    // Get subscriptions this month
    const subscriptionsThisMonth = await Subscription.countDocuments({
      createdAt: { $gte: startOfMonth },
      status: "ACTIVE"
    });
    
    const subscriptionsLastMonth = await Subscription.countDocuments({
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      status: "ACTIVE"
    });
    
    const subscriptionGrowthRate = subscriptionsLastMonth > 0
      ? ((subscriptionsThisMonth - subscriptionsLastMonth) / subscriptionsLastMonth) * 100
      : 0;

    // Get monthly revenue
    const monthlyRevenue = await PaymentLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth },
          status: "SUCCESS"
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" }
        }
      }
    ]);
    
    const currentMonthRevenue = monthlyRevenue[0]?.total || 0;
    
    // Get last month revenue
    const lastMonthRevenue = await PaymentLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
          status: "SUCCESS"
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" }
        }
      }
    ]);
    
    const previousMonthRevenue = lastMonthRevenue[0]?.total || 0;
    const revenueGrowthRate = previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        userChange: `${userGrowthRate >= 0 ? "+" : ""}${userGrowthRate.toFixed(1)}%`,
        userChangeType: userGrowthRate >= 0 ? "positive" : "negative",
        
        activeSubscriptions,
        subscriptionChange: `${subscriptionGrowthRate >= 0 ? "+" : ""}${subscriptionGrowthRate.toFixed(1)}%`,
        subscriptionChangeType: subscriptionGrowthRate >= 0 ? "positive" : "negative",
        
        monthlyRevenue: currentMonthRevenue,
        revenueChange: `${revenueGrowthRate >= 0 ? "+" : ""}${revenueGrowthRate.toFixed(1)}%`,
        revenueChangeType: revenueGrowthRate >= 0 ? "positive" : "negative",
        
        growthRate: userGrowthRate.toFixed(1),
        growthRateChange: `${(userGrowthRate - 5).toFixed(1)}%`,
        growthRateChangeType: userGrowthRate >= 5 ? "positive" : "negative"
      }
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching dashboard statistics",
      error: error.message
    });
  }
};

/**
 * Get revenue overview data for chart
 * @route GET /api/admin/dashboard/revenue
 */
export const getRevenueOverview = async (req, res) => {
  try {
    const { months = 6 } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));
    
    const revenueData = await PaymentLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: "SUCCESS"
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          revenue: { $sum: "$amount" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      }
    ]);
    
    // Format data for chart
    const formattedData = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < parseInt(months); i++) {
      const monthName = currentDate.toLocaleString('default', { month: 'short' });
      const year = currentDate.getFullYear();
      
      const monthData = revenueData.find(
        item => item._id.year === year && item._id.month === currentDate.getMonth() + 1
      );
      
      formattedData.push({
        month: monthName,
        revenue: monthData?.revenue || 0,
        users: 0 // Will be populated separately
      });
      
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    return res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error("Error fetching revenue overview:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching revenue overview",
      error: error.message
    });
  }
};

/**
 * Get user growth data for chart
 * @route GET /api/admin/dashboard/user-growth
 */
export const getUserGrowth = async (req, res) => {
  try {
    const { months = 6 } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));
    
    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          accountStatus: "ACTIVE"
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          users: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      }
    ]);
    
    // Format data for chart
    const formattedData = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < parseInt(months); i++) {
      const monthName = currentDate.toLocaleString('default', { month: 'short' });
      const year = currentDate.getFullYear();
      
      const monthData = userGrowth.find(
        item => item._id.year === year && item._id.month === currentDate.getMonth() + 1
      );
      
      formattedData.push({
        month: monthName,
        users: monthData?.users || 0
      });
      
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    return res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error("Error fetching user growth:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching user growth data",
      error: error.message
    });
  }
};

/**
 * Get recent users for dashboard table
 * @route GET /api/admin/dashboard/recent-users
 */
export const getRecentUsers = async (req, res) => {
  try  {
    const { limit = 5 } = req.query;
    
    const recentUsers = await User.find({ accountStatus: "ACTIVE" })
      .select("name email phone type profileImage createdAt")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    // Get subscription info for each user
    const usersWithPlans = await Promise.all(
      recentUsers.map(async (user) => {
        const subscription = await Subscription.findOne({
          company: user._id,
          status: "ACTIVE",
          endDate: { $gt: new Date() }
        }).populate("plan", "name");
        
        return {
          id: user._id,
          name: user.name || user.email?.split('@')[0] || "Unknown",
          email: user.email,
          plan: subscription?.plan?.name || "No Plan",
          status: subscription ? "Active" : "Inactive",
          profileImage: user.profileImage
        };
      })
    );
    
    return res.status(200).json({
      success: true,
      data: usersWithPlans
    });
  } catch (error) {
    console.error("Error fetching recent users:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching recent users",
      error: error.message
    });
  }
};

/**
 * Get recent audit logs
 * @route GET /api/admin/dashboard/audit-logs
 */
export const getRecentAuditLogs = async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    
    // Note: You'll need to create an AuditLog model for this
    // This is a mock implementation assuming you have an AuditLog model
    
    const auditLogs = await AuditLog?.find({})
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit)) || [];
    
    // If no audit logs exist, return mock data or empty array
    const formattedLogs = auditLogs.map(log => ({
      id: log._id,
      userName: log.user?.name || log.user?.email || "System",
      action: log.action,
      target: log.target,
      timestamp: log.createdAt
    }));
    
    return res.status(200).json({
      success: true,
      data: formattedLogs
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    // Return empty array if model doesn't exist yet
    return res.status(200).json({
      success: true,
      data: []
    });
  }
};

/**
 * Get plan distribution data
 * @route GET /api/admin/dashboard/plan-distribution
 */
export const getPlanDistribution = async (req, res) => {
  try {
    const distribution = await Subscription.aggregate([
      {
        $match: {
          status: "ACTIVE",
          endDate: { $gt: new Date() }
        }
      },
      {
        $lookup: {
          from: "plans",
          localField: "plan",
          foreignField: "_id",
          as: "planInfo"
        }
      },
      {
        $unwind: "$planInfo"
      },
      {
        $group: {
          _id: "$planInfo.name",
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          name: "$_id",
          count: 1,
          _id: 0
        }
      }
    ]);
    
    return res.status(200).json({
      success: true,
      data: distribution
    });
  } catch (error) {
    console.error("Error fetching plan distribution:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching plan distribution",
      error: error.message
    });
  }
};

/**
 * Get complete dashboard data (all in one)
 * @route GET /api/admin/dashboard
 */
export const getDashboardData = async (req, res) => {
  try {
    const { months = 6, userLimit = 5, logLimit = 5 } = req.query;
    
    // Run all queries in parallel for better performance
    const [
      stats,
      revenueData,
      userGrowthData,
      recentUsers,
      recentLogs,
      planDistribution
    ] = await Promise.all([
      getDashboardStatsData(),
      getRevenueDataForDashboard(parseInt(months)),
      getUserGrowthDataForDashboard(parseInt(months)),
      getRecentUsersData(parseInt(userLimit)),
      getRecentLogsData(parseInt(logLimit)),
      getPlanDistributionData()
    ]);
    
    // Combine revenue and user growth data for charts
    const chartData = revenueData.map((item, index) => ({
      ...item,
      users: userGrowthData[index]?.users || 0
    }));
    
    return res.status(200).json({
      success: true,
      data: {
        kpi: stats,
        revenueChart: chartData,
        userGrowthChart: userGrowthData,
        recentUsers,
        recentAuditLogs: recentLogs,
        planDistribution
      }
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching dashboard data",
      error: error.message
    });
  }
};

// Helper functions for getDashboardData

async function getDashboardStatsData() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  
  const [totalUsers, newUsersThisMonth, newUsersLastMonth, activeSubscriptions, currentMonthRevenue, previousMonthRevenue] = await Promise.all([
    User.countDocuments({ accountStatus: "ACTIVE" }),
    User.countDocuments({ createdAt: { $gte: startOfMonth }, accountStatus: "ACTIVE" }),
    User.countDocuments({ createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }, accountStatus: "ACTIVE" }),
    Subscription.countDocuments({ status: "ACTIVE", endDate: { $gt: now } }),
    PaymentLog.aggregate([{ $match: { createdAt: { $gte: startOfMonth }, status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    PaymentLog.aggregate([{ $match: { createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }, status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" } } }])
  ]);
  
  const userGrowthRate = newUsersLastMonth > 0 ? ((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth) * 100 : 0;
  const revenueGrowthRate = previousMonthRevenue[0]?.total > 0 ? ((currentMonthRevenue[0]?.total - previousMonthRevenue[0]?.total) / previousMonthRevenue[0]?.total) * 100 : 0;
  
  return {
    totalUsers,
    userChange: `${userGrowthRate >= 0 ? "+" : ""}${userGrowthRate.toFixed(1)}%`,
    userChangeType: userGrowthRate >= 0 ? "positive" : "negative",
    activeSubscriptions,
    subscriptionChange: "+8.1%", // You can calculate this similarly
    subscriptionChangeType: "positive",
    monthlyRevenue: currentMonthRevenue[0]?.total || 0,
    revenueChange: `${revenueGrowthRate >= 0 ? "+" : ""}${revenueGrowthRate.toFixed(1)}%`,
    revenueChangeType: revenueGrowthRate >= 0 ? "positive" : "negative",
    growthRate: userGrowthRate.toFixed(1),
    growthRateChange: `${(userGrowthRate - 5).toFixed(1)}%`,
    growthRateChangeType: userGrowthRate >= 5 ? "positive" : "negative"
  };
}

async function getRevenueDataForDashboard(months) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  const revenueData = await PaymentLog.aggregate([
    { $match: { createdAt: { $gte: startDate, $lte: endDate }, status: "SUCCESS" } },
    { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, revenue: { $sum: "$amount" } } },
    { $sort: { "_id.year": 1, "_id.month": 1 } }
  ]);
  
  const formattedData = [];
  const currentDate = new Date(startDate);
  
  for (let i = 0; i < months; i++) {
    const monthName = currentDate.toLocaleString('default', { month: 'short' });
    const year = currentDate.getFullYear();
    const monthData = revenueData.find(item => item._id.year === year && item._id.month === currentDate.getMonth() + 1);
    formattedData.push({ month: monthName, revenue: monthData?.revenue || 0 });
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  
  return formattedData;
}

async function getUserGrowthDataForDashboard(months) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  const userGrowth = await User.aggregate([
    { $match: { createdAt: { $gte: startDate, $lte: endDate }, accountStatus: "ACTIVE" } },
    { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, users: { $sum: 1 } } },
    { $sort: { "_id.year": 1, "_id.month": 1 } }
  ]);
  
  const formattedData = [];
  const currentDate = new Date(startDate);
  
  for (let i = 0; i < months; i++) {
    const monthName = currentDate.toLocaleString('default', { month: 'short' });
    const year = currentDate.getFullYear();
    const monthData = userGrowth.find(item => item._id.year === year && item._id.month === currentDate.getMonth() + 1);
    formattedData.push({ month: monthName, users: monthData?.users || 0 });
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  
  return formattedData;
}

async function getRecentUsersData(limit) {
  const recentUsers = await User.find({ accountStatus: "ACTIVE" })
    .select("name email phone type profileImage createdAt")
    .sort({ createdAt: -1 })
    .limit(limit);
  
  const usersWithPlans = await Promise.all(
    recentUsers.map(async (user) => {
      const subscription = await Subscription.findOne({
        company: user._id,
        status: "ACTIVE",
        endDate: { $gt: new Date() }
      }).populate("plan", "name");
      
      return {
        id: user._id,
        name: user.name || user.email?.split('@')[0] || "Unknown",
        email: user.email,
        plan: subscription?.plan?.name || "No Plan",
        status: subscription ? "Active" : "Inactive",
        profileImage: user.profileImage
      };
    })
  );
  
  return usersWithPlans;
}

async function getRecentLogsData(limit) {
  // Implement based on your AuditLog model
  return [];
}

async function getPlanDistributionData() {
  const distribution = await Subscription.aggregate([
    { $match: { status: "ACTIVE", endDate: { $gt: new Date() } } },
    { $lookup: { from: "plans", localField: "plan", foreignField: "_id", as: "planInfo" } },
    { $unwind: "$planInfo" },
    { $group: { _id: "$planInfo.name", count: { $sum: 1 } } },
    { $project: { name: "$_id", count: 1, _id: 0 } }
  ]);
  
  return distribution;
}