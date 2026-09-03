import moment from 'moment';

export const validateTask = async (req, res, next) => {
  try {
    const { title, description, startDate, dueDate, estimatedDurationSeconds, priority } = req.body;

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