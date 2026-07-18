import { Router } from 'express';
import { getAllQueueStats, getAllTierQueues, notificationQueue, reportQueue, schedulerQueue, retryQueue, deadLetterQueue, emailQueue, whatsappQueue } from '../queues/index.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { getPriorityMetrics } from '../priority/metrics.js';
import { getCircuitBreakerStatus } from '../priority/loadShedder.js';

import DeadLetter from '../models/DeadLetter.js';
import Notification from '../models/Notification.js';
import { notificationLogger } from '../index.js';
import { getChannelStatus, setChannelEnabled, syncChannelFromRedis } from '../utils/channelManager.js';

const router = Router();

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const queueStats = await getAllQueueStats();

    const [totalSent, totalFailed, totalQueued] = await Promise.all([
      Notification.countDocuments({ status: 'success' }),
      Notification.countDocuments({ status: { $in: ['failed', 'dead_letter'] } }),
      Notification.countDocuments({ status: 'queued' }),
    ]);

    const deadLetterCount = await DeadLetter.countDocuments({ status: 'pending' });

    res.json({
      success: true,
      data: {
        queues: queueStats,
        notifications: { totalSent, totalFailed, totalQueued },
        deadLetter: { pending: deadLetterCount },
      },
    });
  } catch (error) {
    notificationLogger.error('Failed to get notification stats', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/priority', requireAdmin, async (req, res) => {
  try {
    const metrics = await getPriorityMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/circuit-breaker', requireAdmin, async (req, res) => {
  try {
    const status = await getCircuitBreakerStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



router.get('/channels', requireAdmin, async (req, res) => {
  try {
    await Promise.all(['email', 'whatsapp', 'push'].map(syncChannelFromRedis));
    const status = await getChannelStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/channels/:channel/:action', requireAdmin, async (req, res) => {
  try {
    const { channel, action } = req.params;
    const validChannels = ['email', 'whatsapp', 'push'];
    if (!validChannels.includes(channel)) {
      return res.status(400).json({ success: false, error: `Invalid channel: ${channel}. Valid: ${validChannels.join(', ')}` });
    }
    if (!['enable', 'disable'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Action must be "enable" or "disable"' });
    }
    const enabled = action === 'enable';
    await setChannelEnabled(channel, enabled);
    notificationLogger.info(`Channel ${action}d via admin API`, { channel });
    res.json({ success: true, data: { channel, enabled } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/failed', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const failed = await Notification.find({
      status: { $in: ['failed', 'dead_letter'] },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, data: failed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/queue/:queueName', requireAdmin, async (req, res) => {
  try {
    const { queueName } = req.params;
    const state = req.query.state || 'waiting';
    const limit = parseInt(req.query.limit) || 50;

    const tierQueues = getAllTierQueues();
    const queueMap = {
      notificationQueue, reportQueue, schedulerQueue, retryQueue, deadLetterQueue,
      emailQueue, whatsappQueue,
    };

    for (const { name, queue } of tierQueues) {
      queueMap[name] = queue;
    }

    const queue = queueMap[queueName];
    if (!queue) {
      return res.status(400).json({ success: false, error: `Unknown queue: ${queueName}` });
    }

    const validStates = ['waiting', 'active', 'completed', 'failed', 'delayed'];
    if (!validStates.includes(state)) {
      return res.status(400).json({ success: false, error: `Invalid state: ${state}` });
    }

    const jobs = await queue.getJobs([state], 0, limit);
    const jobData = await Promise.all(jobs.map(async (job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      returnvalue: job.returnvalue,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      delay: job.delay,
    })));

    res.json({ success: true, data: jobData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dead', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const entries = await DeadLetter.find({ status: 'pending' })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/retry/:deadLetterId', requireAdmin, async (req, res) => {
  try {
    const { deadLetterId } = req.params;
    const deadLetter = await DeadLetter.findById(deadLetterId);

    if (!deadLetter) {
      return res.status(404).json({ success: false, error: 'Dead letter entry not found' });
    }

    if (deadLetter.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Dead letter is already ${deadLetter.status}` });
    }

    await retryQueue.add('retry', { deadLetterId }, {
      attempts: 1,
      delay: 1000,
    });

    await DeadLetter.findByIdAndUpdate(deadLetterId, { status: 'retrying' });

    notificationLogger.info('Dead letter retry queued', { deadLetterId });

    res.json({ success: true, message: 'Retry job queued' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
