/**
 * Company ID Resolver for Multi-Tenant SaaS
 * 
 * Handles different user types and their company associations:
 * - super_admin: accesses all companies (uses _id as companyId)
 * - partner: IS the company (uses _id as companyId)
 * - employee: has companyId field referencing their partner
 * - Viewer/other types: default to user's company
 */

export const resolveCompanyId = (req) => {
  const user = req.user || {};

  // super_admin: can access everything
  if (user.type === 'super_admin') {
    return user.companyId || user._id;
  }

  // partner: the user IS the company
  if (user.type === 'partner') {
    logger.info(`User ${user._id} is a partner; using _id as companyId`);
    return user._id;

  }

  // employee: has explicit companyId
  if (user.companyId) {
    return user.companyId;
  }

  // employee fallback: use _id (legacy or special case)
  if (user.type === 'user' || user.type === 'employee') {
    logger.warn(`User ${user._id} of type ${user.type} has no companyId; using _id as fallback`);
    return user.companyId || user._id;
  }

  // Default: try to get from user
  return user.companyId || user._id;
};

/**
 * Validate that user has access to a specific company
 * Returns companyId if valid, or throws error
 */
export const validateCompanyAccess = (req, allowedTypes = ['super_admin', 'partner', 'employee']) => {
  const user = req.user;

  if (!user) {
    throw new Error('User not authenticated');
  }

  if (!allowedTypes.includes(user.type)) {
    throw new Error(`User type ${user.type} not allowed for company-scoped operations`);
  }

  return resolveCompanyId(req);
};

/**
 * Check if user can access company-scoped resource
 * @param {Object} req - Express request
 * @param {String} resourceType - Type of resource being accessed
 * @returns {Boolean} - Whether access is allowed
 */
export const checkCompanyResourceAccess = (req, resourceType) => {
  const user = req.user;

  if (!user) return false;

  // super_admin and partner can access all
  if (user.type === 'super_admin' || user.type === 'partner') {
    return true;
  }

  // employee can only access their own company's resources
  if (user.type === 'employee' || user.type === 'user') {
    // The resource should have companyId matching user's companyId
    // This is checked at the controller/db level
    return true; // placeholder - actual check in query
  }

  return false;
};

/**
 * Get company ID from request, with fallback logic
 * Used in routes before any database operations
 * @param {Object} req - Express request object
 * @returns {ObjectId|String} - Company ID
 */
export const getCompanyIdFromRequest = (req) => {
  // Priority order:
  // 1. Explicit companyId in query/body params (for cross-company admin actions)
  // 2. User's companyId (for employee/partner scoped access)
  // 3. User's _id as companyId (for partner type)
  // 4. super_admin: use req.params.companyId or req.body.companyId

  const user = req.user;

  if (!user) {
    return null;
  }

  // If explicit companyId provided in request, use it (for super_admin cross-company)
  if (req.params && req.params.companyId) {
    return req.params.companyId;
  }
  if (req.body && req.body.companyId) {
    return req.body.companyId;
  }

  // Otherwise use user's company association
  if (user.type === 'partner') {
    return user._id;
  }

  if (user.type === 'super_admin') {
    // super_admin can specify which company, or use default
    return user.companyId || user._id;
  }

  if (user.companyId) {
    return user.companyId;
  }

  // fallback
  return user._id;
};

export default {
  resolveCompanyId,
  validateCompanyAccess,
  checkCompanyResourceAccess,
  getCompanyIdFromRequest
};