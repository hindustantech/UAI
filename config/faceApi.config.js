// src/config/faceApi.config.js
export const BASE_URL = process.env.FACE_API_BASE_URL || 'https://face.praecore.in';

// Must match whatever verify_api_key() expects in the Python service
export const API_KEY = process.env.FACE_API_KEY || '';

export const ENDPOINTS = {
  DETECT: '/api/v1/face-detection/detect',
  DETECT_COMPANY: '/api/v1/face-detection/detect-company',
  DETECT_EMPLOYEE: '/api/v1/face-detection/detect-employee',
  VALIDATE_ENROLLMENT: '/api/v1/face-detection/validate-enrollment',
  DETECTION_HEALTH: '/api/v1/face-detection/health',

  TRAIN_SINGLE: '/api/v1/face-training/single',
  TRAIN_BATCH: '/api/v1/face-training/batch',
  TRAIN_STATUS: (employeeId) => `/api/v1/face-training/status/${employeeId}`,
  TRAIN_DELETE_IMAGE: '/api/v1/face-training/image',
  TRAIN_DELETE_ALL: (employeeId) => `/api/v1/face-training/${employeeId}`,

  VERIFY: '/api/v1/face-recognition/verify',           // Supports both 1:1 and 1:N
  VERIFY_EMPLOYEE: '/api/v1/face-recognition/verify-employee',  // Explicit 1:1
  IDENTIFY: '/api/v1/face-recognition/identify',        // Top N matches
  SEARCH: '/api/v1/face-recognition/search',            // Alias for identify

  HEALTH: '/health',
  DOCS: '/api/docs',
};

export const TIMEOUT_MS = parseInt(process.env.FACE_API_TIMEOUT_MS || '20000', 10);
export const BATCH_TIMEOUT_MS = parseInt(process.env.FACE_API_BATCH_TIMEOUT_MS || '60000', 10);

// Default thresholds
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.65;
export const DEFAULT_IDENTIFY_MAX_RESULTS = 10;
export const DEFAULT_DETECTION_MIN_CONFIDENCE = 0.5;

// Supported image formats
export const SUPPORTED_IMAGE_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Detection settings
export const DETECTION_SETTINGS = {
  MIN_FACE_SIZE: 100, // Minimum face size in pixels
  IDEAL_FACE_SIZE: 150, // Ideal face size for best accuracy
  MAX_FACES_FOR_ENROLLMENT: 5, // Maximum faces allowed per employee
  SPOOFING_CHECK_ENABLED: process.env.ENABLE_ANTI_SPOOFING === 'true' || false,
};

export default {
  BASE_URL,
  API_KEY,
  ENDPOINTS,
  TIMEOUT_MS,
  BATCH_TIMEOUT_MS,
  DEFAULT_FACE_MATCH_THRESHOLD,
  DEFAULT_IDENTIFY_MAX_RESULTS,
  DEFAULT_DETECTION_MIN_CONFIDENCE,
  SUPPORTED_IMAGE_FORMATS,
  MAX_FILE_SIZE,
  DETECTION_SETTINGS,
};
