// src/middleware/errorHandler.middleware.js
// Mount this LAST in server.js, after all routes.

export default function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;

  console.error(`[FaceAPI Error] ${req.method} ${req.originalUrl} ->`, err.message);

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Something went wrong',
    details: err.details || undefined,
  });
}
