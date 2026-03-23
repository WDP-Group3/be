import User from '../models/User.js';

/**
 * Middleware to check user role
 * @param {...string} allowedRoles - Roles that are allowed to access
 */
export const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.userId) {
        return res.status(401).json({
          status: 'error',
          message: 'Không có quyền truy cập',
        });
      }

      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'User not found',
        });
      }

      const userRole = user.role ? String(user.role).toUpperCase().trim() : '';
      // Support both requireRole('A', 'B') and requireRole(['A', 'B'])
      const flattenedRoles = allowedRoles.flat();
      const upperAllowedRoles = flattenedRoles.map(r => String(r).toUpperCase().trim());

      if (!upperAllowedRoles.includes(userRole)) {
        console.warn(`[requireRole] ACCESS DENIED:
          - Path: ${req.method} ${req.originalUrl}
          - User ID: ${req.userId}
          - User Role: '${userRole}'
          - Allowed Roles: [${upperAllowedRoles.join(', ')}]
        `);
        return res.status(403).json({
          status: 'error',
          message: 'Bạn không có quyền truy cập chức năng này',
        });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }
  };
};
