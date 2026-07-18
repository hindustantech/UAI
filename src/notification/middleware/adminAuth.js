import jwt from 'jsonwebtoken';
import User from '../../../models/userModel.js';

export async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const adminTypes = ['admin', 'super_admin'];
    if (!adminTypes.includes(user.type)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name?.startsWith('Mongo') || error.name === 'MongooseError') {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}
