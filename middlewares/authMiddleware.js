import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

const authMiddleware = async (req, res, next) => {
  try {
    let token;

    // Extract token
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Verify
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Fetch user (plain object)
    const user = await User.findById(decoded.id)
      .select('-password -otp -__v')
      .lean();

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Merge (JWT has priority)
    req.user = {
      ...decoded,
      ...user
    };

    next();

  } catch (error) {
    console.error('Auth Middleware Error:', error.message);

    return res.status(401).json({
      message: 'Authentication failed',
      error: error.message
    });
  }
};

export default authMiddleware;








