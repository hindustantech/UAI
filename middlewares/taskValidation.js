import moment from 'moment';

export const validateTask = async (req, res, next) => {
  try {
    const { title, description, startDate, dueDate, estimatedDurationSeconds, priority, taskType, recurringDays, recurringDates } = req.body;

    // Title is required for creation (not update)
    if (req.method === 'POST' && !title) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Title is required' }
      });
    }

    // Title length
    if (title && title.length > 200) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Title cannot exceed 200 characters' }
      });
    }

    // Priority validation
    if (priority && !['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'].includes(priority)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid priority' }
      });
    }

    // Task type validation
    if (taskType && !['daily', 'days', 'dates'].includes(taskType)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid taskType. Must be daily, days, or dates' }
      });
    }

    // Recurring days validation (only valid for taskType 'days')
    if (taskType === 'days' && recurringDays) {
      const validDays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const invalidDays = recurringDays.filter(day => !validDays.includes(day));
      if (invalidDays.length > 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid day(s) in recurringDays: ' + invalidDays.join(', '), validDays }
        });
      }
    }

    // Recurring dates validation (only valid for taskType 'dates')
    if (taskType === 'dates' && recurringDates) {
      const outOfRange = recurringDates.filter(d => d < 1 || d > 31);
      if (outOfRange.length > 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Date(s) out of range in recurringDates: must be 1-31' }
        });
      }
    }

    // Date validation
    if (startDate && dueDate) {
      const start = moment(startDate);
      const due = moment(dueDate);
      if (due.isBefore(start)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Due date must be after start date' }
        });
      }
    }

    // Estimated duration validation
    if (estimatedDurationSeconds !== undefined && estimatedDurationSeconds < 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Estimated duration cannot be negative' }
      });
    }

    // Description length
    if (description && description.length > 5000) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Description cannot exceed 5000 characters' }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};