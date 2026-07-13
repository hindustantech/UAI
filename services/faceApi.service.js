// src/services/faceApi.service.js
import axios from 'axios';
import FormData from 'form-data';
import { 
  BASE_URL, 
  API_KEY, 
  ENDPOINTS, 
  TIMEOUT_MS, 
  BATCH_TIMEOUT_MS,
  DEFAULT_FACE_MATCH_THRESHOLD,
  DEFAULT_IDENTIFY_MAX_RESULTS 
} from '../config/faceApi.config.js';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
  headers: {
    'X-API-Key': API_KEY,
  },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

/** Normalizes axios errors into a consistent { message, statusCode, details } shape. */
function shapeError(err) {
  if (err.response) {
    const { status, data } = err.response;
    const message =
      (data && (data.detail?.message || data.detail || data.message)) ||
      'Face API request failed';

    const shaped = new Error(message);
    shaped.statusCode = status;
    shaped.details = data;
    return shaped;
  }

  if (err.request) {
    const shaped = new Error(
      `No response from Face API (${BASE_URL}). It may be down or unreachable.`
    );
    shaped.statusCode = 503;
    shaped.details = { code: err.code };
    return shaped;
  }

  const shaped = new Error(err.message || 'Unexpected error calling Face API');
  shaped.statusCode = 500;
  return shaped;
}

/* ------------------------------------------------------------------ */
/* 1. DETECTION — no DB matching, no storage                          */
/* ------------------------------------------------------------------ */



/**
 * Detect face(s) in an image with optional company/employee context.
 * @param {Object} params
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {boolean} [params.checkSpoofing=false] - Enable anti-spoofing check
 * @param {string} [params.companyId] - Company ID for contextual detection
 * @param {string} [params.employeeId] - Employee ID for employee-specific detection
 * @returns {Promise<Object>} Detection results with context
 */
export async function detectFace({ 
  fileBuffer, 
  fileName, 
  mimeType, 
  checkSpoofing = false,
  companyId = null,
  employeeId = null 
}) {
  try {
    const form = new FormData();
    form.append('check_spoofing', String(checkSpoofing));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
    
    if (companyId) {
      form.append('company_id', companyId);
    }
    if (employeeId) {
      form.append('employee_id', employeeId);
    }

    const { data } = await client.post(ENDPOINTS.DETECT, form, { 
      headers: form.getHeaders() 
    });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Detect face specifically for a company context.
 * @param {Object} params
 * @param {string} params.companyId - Company ID
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {boolean} [params.checkSpoofing=false] - Enable anti-spoofing check
 * @returns {Promise<Object>} Company-specific detection results
 */
export async function detectFaceForCompany({ 
  companyId, 
  fileBuffer, 
  fileName, 
  mimeType, 
  checkSpoofing = false 
}) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    form.append('check_spoofing', String(checkSpoofing));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.DETECT_COMPANY, form, { 
      headers: form.getHeaders() 
    });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Detect face for a specific employee with quick match check.
 * @param {Object} params
 * @param {string} params.companyId - Company ID
 * @param {string} params.employeeId - Employee ID
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {boolean} [params.checkSpoofing=false] - Enable anti-spoofing check
 * @returns {Promise<Object>} Employee-specific detection with quick match
 */
export async function detectFaceForEmployee({ 
  companyId, 
  employeeId, 
  fileBuffer, 
  fileName, 
  mimeType, 
  checkSpoofing = false 
}) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    form.append('employee_id', employeeId);
    form.append('check_spoofing', String(checkSpoofing));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.DETECT_EMPLOYEE, form, { 
      headers: form.getHeaders() 
    });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Validate if an image is suitable for face enrollment.
 * @param {Object} params
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {string} [params.companyId] - Company ID for context
 * @param {string} [params.employeeId] - Employee ID to check limits
 * @returns {Promise<Object>} Validation results
 */
export async function validateForEnrollment({ 
  fileBuffer, 
  fileName, 
  mimeType, 
  companyId = null,
  employeeId = null 
}) {
  try {
    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
    
    if (companyId) {
      form.append('company_id', companyId);
    }
    if (employeeId) {
      form.append('employee_id', employeeId);
    }

    const { data } = await client.post(ENDPOINTS.VALIDATE_ENROLLMENT, form, { 
      headers: form.getHeaders() 
    });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}
/* ------------------------------------------------------------------ */
/* 2. TRAINING — enroll faces                                         */
/* ------------------------------------------------------------------ */

/**
 * Train a single face image for an employee.
 * @param {Object} params
 * @param {string} params.employeeId - Employee identifier
 * @param {string} params.companyId - Company identifier
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @returns {Promise<Object>} Training result
 */
export async function trainSingleFace({ employeeId, companyId, fileBuffer, fileName, mimeType }) {
  try {
    const form = new FormData();
    form.append('employee_id', employeeId);
    form.append('company_id', companyId);
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.TRAIN_SINGLE, form, { headers: form.getHeaders() });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Train multiple face images (max 5, enforced server-side) for an employee.
 * @param {Object} params
 * @param {string} params.employeeId - Employee identifier
 * @param {string} params.companyId - Company identifier
 * @param {Array<{buffer: Buffer, originalname: string, mimetype: string}>} params.files - Array of file objects
 * @returns {Promise<Object>} Batch training result
 */
export async function trainBatchFaces({ employeeId, companyId, files }) {
  try {
    const form = new FormData();
    form.append('employee_id', employeeId);
    form.append('company_id', companyId);

    files.forEach((file) => {
      form.append('files', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });
    });

    const { data } = await client.post(ENDPOINTS.TRAIN_BATCH, form, {
      headers: form.getHeaders(),
      timeout: BATCH_TIMEOUT_MS,
    });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Get enrollment/training status for an employee.
 * @param {string} employeeId - Employee identifier
 * @param {string} companyId - Company identifier
 * @returns {Promise<Object>} Training status
 */
export async function getTrainingStatus(employeeId, companyId) {
  try {
    const { data } = await client.get(ENDPOINTS.TRAIN_STATUS(employeeId), {
      params: { company_id: companyId },
    });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/* ------------------------------------------------------------------ */
/* 3. RECOGNITION — match against enrolled faces                      */
/* ------------------------------------------------------------------ */

/**
 * Verify a captured face - supports both 1:1 and 1:N matching.
 * 
 * If employeeId is provided: Performs 1:1 verification (checks if face matches specific employee)
 * If employeeId is omitted: Performs 1:N verification (finds best matching employee in company)
 * 
 * @param {Object} params
 * @param {string} params.companyId - Company identifier (required)
 * @param {string} [params.employeeId] - Employee identifier for 1:1 verification (optional)
 * @param {string} [params.purpose='punch_in'] - Verification purpose (punch_in, punch_out, re_verification, spot_check)
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {Object} [params.deviceInfo={}] - Device information for logging
 * @returns {Promise<Object>} Verification result with match details
 */
export async function verifyFace({ 
  companyId, 
  employeeId = null,
  purpose = 'punch_in', 
  fileBuffer, 
  fileName, 
  mimeType, 
  deviceInfo = {} 
}) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    form.append('purpose', purpose);
    form.append('device_info', JSON.stringify(deviceInfo || {}));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
    
    // Add employee_id for 1:1 verification
    if (employeeId) {
      form.append('employee_id', employeeId);
    }

    const { data } = await client.post(ENDPOINTS.VERIFY, form, { headers: form.getHeaders() });
    
    // Enhance response with verification type info
    if (data && data.data) {
      data.data.verification_type = employeeId ? '1:1' : '1:N';
      data.data.queried_employee_id = employeeId || null;
    }
    
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Verify if a face belongs to a specific employee (explicit 1:1 verification).
 * This is a convenience wrapper around verifyFace with employeeId.
 * 
 * @param {Object} params
 * @param {string} params.employeeId - Employee identifier (required)
 * @param {string} params.companyId - Company identifier (required)
 * @param {string} [params.purpose='attendance'] - Verification purpose
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {Object} [params.deviceInfo={}] - Device information for logging
 * @returns {Promise<Object>} 1:1 verification result
 */
export async function verifySpecificEmployee({ 
  employeeId, 
  companyId, 
  purpose = 'attendance',
  fileBuffer, 
  fileName, 
  mimeType, 
  deviceInfo = {} 
}) {
  try {
    if (!employeeId) {
      throw new Error('employeeId is required for 1:1 verification');
    }
    
    const form = new FormData();
    form.append('company_id', companyId);
    form.append('employee_id', employeeId);
    form.append('purpose', purpose);
    form.append('device_info', JSON.stringify(deviceInfo || {}));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.VERIFY_EMPLOYEE, form, { 
      headers: form.getHeaders() 
    });
    
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Identify a face against the enrolled database for a company.
 * Returns top N matches sorted by similarity score.
 * 
 * @param {Object} params
 * @param {string} params.companyId - Company identifier (required)
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {number} [params.threshold] - Minimum similarity threshold (0-1). Default from server settings.
 * @param {number} [params.maxResults=10] - Maximum number of results to return
 * @returns {Promise<Object>} Identification results with top matches
 */
export async function identifyFace({ 
  companyId, 
  fileBuffer, 
  fileName, 
  mimeType, 
  threshold,
  maxResults = DEFAULT_IDENTIFY_MAX_RESULTS 
}) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    
    if (threshold !== undefined && threshold !== null) {
      form.append('threshold', String(threshold));
    }
    
    form.append('max_results', String(maxResults));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.IDENTIFY, form, { 
      headers: form.getHeaders() 
    });
    
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Search for employees by face image (alias for identify).
 * 
 * @param {Object} params
 * @param {string} params.companyId - Company identifier (required)
 * @param {Buffer} params.fileBuffer - Image buffer
 * @param {string} params.fileName - Original filename
 * @param {string} params.mimeType - MIME type of the image
 * @param {number} [params.threshold] - Minimum similarity threshold (0-1)
 * @param {number} [params.limit=5] - Maximum number of results (1-20)
 * @returns {Promise<Object>} Search results with potential matches
 */
export async function searchEmployeeByFace({ 
  companyId, 
  fileBuffer, 
  fileName, 
  mimeType, 
  threshold,
  limit = 5 
}) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    
    if (threshold !== undefined && threshold !== null) {
      form.append('threshold', String(threshold));
    }
    
    form.append('limit', String(Math.min(limit, 20))); // Max 20 as per server limit
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.SEARCH, form, { 
      headers: form.getHeaders() 
    });
    
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/* ------------------------------------------------------------------ */
/* 4. HEALTH & DOCS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Check if the Face API service is healthy and reachable.
 * @returns {Promise<Object>} Health status
 */
export async function checkHealth() {
  try {
    const { data } = await client.get(ENDPOINTS.HEALTH);
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Get API documentation endpoint.
 * @returns {Promise<Object>} API documentation
 */
export async function getDocs() {
  try {
    const { data } = await client.get(ENDPOINTS.DOCS);
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

export default {
  // Detection
  detectFace,
  
  // Training
  trainSingleFace,
  trainBatchFaces,
  getTrainingStatus,
  
  // Recognition
  verifyFace,              // 1:1 and 1:N
  verifySpecificEmployee,  // Explicit 1:1
  identifyFace,           // Top N matches
  searchEmployeeByFace,   // Alias for identify
  
  // Utilities
  checkHealth,
  getDocs,
};