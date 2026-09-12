import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskInvitation from '../../models/tasks/taskInvitationModel.js';
import User from '../../models/userModel.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';

export const getAssignedUsers = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const {
      page = 1,
      limit = 50,
      search,
      taskId
    } = req.query;

    const filter = { companyId };
    if (taskId) filter.taskId = taskId;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const matchingUsers = await User.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex }
        ]
      }).select('_id').lean();
      const userIds = matchingUsers.map(u => u._id);
      if (userIds.length === 0) {
        return res.json({ success: true, count: 0, total: 0, page: pageNum, pages: 0, data: [] });
      }
      filter.userId = { $in: userIds };
    }

    const distinctAssignments = await TaskAssignment.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$userId',
          statuses: { $addToSet: '$status' },
          latestAssignment: { $max: '$assignedAt' }
        }
      },
      { $sort: { latestAssignment: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    ]);

    const totalAgg = await TaskAssignment.aggregate([
      { $match: filter },
      { $group: { _id: '$userId' } },
      { $count: 'total' }
    ]);
    const total = totalAgg.length > 0 ? totalAgg[0].total : 0;

    const userIds = distinctAssignments.map(a => a._id);
    const users = await User.find({ _id: { $in: userIds } })
      .select('uid name email accountStatus type')
      .lean();

    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const data = distinctAssignments.map(a => ({
      user: userMap[a._id.toString()] || null,
      status: a.statuses
    })).filter(d => d.user !== null);

    res.json({
      success: true,
      count: data.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data
    });
  } catch (error) {
    console.error('Get assigned users error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'USER_LIST_ERROR', message: 'Failed to fetch assigned users' }
    });
  }
};

export const getInvitedUsers = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const {
      page = 1,
      limit = 50,
      search,
      taskId
    } = req.query;

    const filter = { companyId };
    if (taskId) filter.taskId = taskId;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const matchingUsers = await User.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex }
        ]
      }).select('_id').lean();
      const userIds = matchingUsers.map(u => u._id);
      if (userIds.length === 0) {
        return res.json({ success: true, count: 0, total: 0, page: pageNum, pages: 0, data: [] });
      }
      filter.invitedUserId = { $in: userIds };
    }

    const distinctInvitations = await TaskInvitation.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$invitedUserId',
          statuses: { $addToSet: '$status' },
          latestInvitation: { $max: '$createdAt' }
        }
      },
      { $sort: { latestInvitation: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    ]);

    const totalAgg = await TaskInvitation.aggregate([
      { $match: filter },
      { $group: { _id: '$invitedUserId' } },
      { $count: 'total' }
    ]);
    const total = totalAgg.length > 0 ? totalAgg[0].total : 0;

    const userIds = distinctInvitations.map(a => a._id);
    const users = await User.find({ _id: { $in: userIds } })
      .select('uid name email accountStatus type')
      .lean();

    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const data = distinctInvitations.map(a => ({
      user: userMap[a._id.toString()] || null,
      status: a.statuses
    })).filter(d => d.user !== null);

    res.json({
      success: true,
      count: data.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data
    });
  } catch (error) {
    console.error('Get invited users error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'USER_LIST_ERROR', message: 'Failed to fetch invited users' }
    });
  }
};
