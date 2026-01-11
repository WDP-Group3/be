import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to verify JWT token
export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        status: 'error',
        message: 'Không có token xác thực',
      });
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Token không hợp lệ',
      });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.userId;
      next();
    } catch (error) {
      console.error('❌ JWT Verify Error:', error.message);
      console.error('Token:', token.substring(0, 20) + '...');
      console.error('JWT_SECRET:', JWT_SECRET ? 'Set' : 'Not set');
      return res.status(401).json({
        status: 'error',
        message: 'Token không hợp lệ hoặc đã hết hạn',
      });
    }
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Optional authentication (doesn't fail if no token)
export const optionalAuthenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return next();
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
      } catch (error) {
        // Ignore invalid tokens in optional auth
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};
