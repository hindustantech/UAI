// src/config/faceApi.config.js
export const BASE_URL = process.env.FACE_API_BASE_URL || 'https://face.praecore.in';

// Must match whatever verify_api_key() expects in the Python service
export const API_KEY = process.env.FACE_API_KEY || '';

export const ENDPOINTS = {
  DETECT: '/api/v1/face-detection/detect',
  TRAIN_SINGLE: '/api/v1/face-training/single',
  TRAIN_BATCH: '/api/v1/face-training/batch',
  TRAIN_STATUS: (employeeId) => `/api/v1/face-training/status/${employeeId}`,
  VERIFY: '/api/v1/face-recognition/verify',
  IDENTIFY: '/api/v1/face-recognition/identify',
  HEALTH: '/health',
};

export const TIMEOUT_MS = parseInt(process.env.FACE_API_TIMEOUT_MS || '20000', 10);
export const BATCH_TIMEOUT_MS = parseInt(process.env.FACE_API_BATCH_TIMEOUT_MS || '60000', 10);

export default { BASE_URL, API_KEY, ENDPOINTS, TIMEOUT_MS, BATCH_TIMEOUT_MS };
