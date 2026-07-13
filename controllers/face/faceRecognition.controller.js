// src/controllers/faceRecognition.controller.js
import * as faceApiService from '../../services/faceApi.service.js';
import { DEFAULT_FACE_MATCH_THRESHOLD } from '../../config/faceApi.config.js';

const VALID_PURPOSES = ['punch_in', 'punch_out', 're_verification', 'spot_check', 'attendance'];

/**
 * POST /api/face/verify
 * 
 * Supports both 1:1 and 1:N verification:
 * - 1:1: Provide employeeId to verify if face matches specific employee
 * - 1:N: Omit employeeId to find matching employee in company
 * 
 * Body (multipart/form-data):
 * - companyId: string (required)
 * - employeeId: string (optional) - for 1:1 verification
 * - purpose: string (optional, default: 'punch_in')
 * - deviceInfo: JSON string (optional) - device metadata
 * - file: File (required) - face image
 */
export async function verify(req, res, next) {
  try {
    const { 
      companyId, 
      employeeId = null,  // Optional: for 1:1 verification
      purpose = 'punch_in',
      deviceInfo: rawDeviceInfo 
    } = req.body;

    // Validate required fields
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Validate purpose
    if (!VALID_PURPOSES.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: `Invalid purpose. Must be one of: ${VALID_PURPOSES.join(', ')}`,
      });
    }

    // Parse device info
    let deviceInfo = {};
    if (rawDeviceInfo) {
      try {
        deviceInfo = typeof rawDeviceInfo === 'string' 
          ? JSON.parse(rawDeviceInfo) 
          : rawDeviceInfo;
      } catch (parseError) {
        console.warn('Failed to parse deviceInfo:', parseError.message);
        deviceInfo = { raw: rawDeviceInfo };
      }
    }

    // Log verification attempt
    console.log('Face verification request:', {
      companyId,
      employeeId: employeeId || 'not specified (1:N mode)',
      purpose,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      timestamp: new Date().toISOString()
    });

    // Perform verification
    const result = await faceApiService.verifyFace({
      companyId,
      employeeId,  // Pass employeeId for 1:1 verification
      purpose,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      deviceInfo,
    });

    // Enhance response with metadata
    if (result && result.data) {
      result.verification_mode = employeeId ? '1:1' : '1:N';
      result.queried_employee_id = employeeId || null;
      result.request_timestamp = new Date().toISOString();
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/verify-employee
 * 
 * Explicit 1:1 verification endpoint.
 * Verifies if the face in the image belongs to the specified employee.
 * 
 * Body (multipart/form-data):
 * - companyId: string (required)
 * - employeeId: string (required)
 * - purpose: string (optional, default: 'attendance')
 * - deviceInfo: JSON string (optional)
 * - file: File (required) - face image
 */
export async function verifyEmployee(req, res, next) {
  try {
    const { 
      companyId, 
      employeeId, 
      purpose = 'attendance',
      deviceInfo: rawDeviceInfo 
    } = req.body;

    // Validate required fields
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'employeeId is required for 1:1 verification',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Validate purpose
    if (!VALID_PURPOSES.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: `Invalid purpose. Must be one of: ${VALID_PURPOSES.join(', ')}`,
      });
    }

    // Parse device info
    let deviceInfo = {};
    if (rawDeviceInfo) {
      try {
        deviceInfo = typeof rawDeviceInfo === 'string' 
          ? JSON.parse(rawDeviceInfo) 
          : rawDeviceInfo;
      } catch (parseError) {
        console.warn('Failed to parse deviceInfo:', parseError.message);
        deviceInfo = { raw: rawDeviceInfo };
      }
    }

    // Log 1:1 verification attempt
    console.log('1:1 Face verification request:', {
      companyId,
      employeeId,
      purpose,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString()
    });

    // Perform 1:1 verification
    const result = await faceApiService.verifySpecificEmployee({
      companyId,
      employeeId,
      purpose,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      deviceInfo,
    });

    // Enhance response
    if (result && result.data) {
      result.verification_mode = '1:1';
      result.request_timestamp = new Date().toISOString();
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/identify
 * 
 * Identify a face against the enrolled database.
 * Returns top N matches sorted by similarity score.
 * 
 * Body (multipart/form-data):
 * - companyId: string (required)
 * - threshold: number (optional) - minimum similarity threshold (0-1)
 * - maxResults: number (optional, default: 10) - maximum results
 * - file: File (required) - face image
 */
export async function identify(req, res, next) {
  try {
    const { 
      companyId, 
      threshold: rawThreshold,
      maxResults: rawMaxResults 
    } = req.body;

    // Validate required fields
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Parse and validate threshold
    let threshold;
    if (rawThreshold !== undefined && rawThreshold !== null && rawThreshold !== '') {
      threshold = parseFloat(rawThreshold);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        return res.status(400).json({
          success: false,
          message: 'threshold must be a number between 0 and 1',
        });
      }
    }

    // Parse and validate maxResults
    let maxResults = 10; // default
    if (rawMaxResults !== undefined && rawMaxResults !== null && rawMaxResults !== '') {
      maxResults = parseInt(rawMaxResults, 10);
      if (isNaN(maxResults) || maxResults < 1 || maxResults > 50) {
        return res.status(400).json({
          success: false,
          message: 'maxResults must be an integer between 1 and 50',
        });
      }
    }

    // Log identification attempt
    console.log('Face identification request:', {
      companyId,
      threshold: threshold || 'server default',
      maxResults,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString()
    });

    // Perform identification
    const result = await faceApiService.identifyFace({
      companyId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      threshold,
      maxResults,
    });

    // Enhance response with metadata
    if (result && result.data) {
      result.mode = 'identification';
      result.query_params = {
        threshold: threshold || DEFAULT_FACE_MATCH_THRESHOLD,
        max_results: maxResults,
      };
      result.request_timestamp = new Date().toISOString();
      
      // Add match summary
      const matches = result.data.matches || [];
      if (matches.length > 0) {
        result.summary = {
          total_matches: result.data.total_matches || matches.length,
          returned_matches: matches.length,
          best_match_confidence: matches[0]?.similarity 
            ? `${(matches[0].similarity * 100).toFixed(2)}%` 
            : 'N/A',
          best_match_employee: matches[0]?.employee_id || 'N/A',
        };
      } else {
        result.summary = {
          total_matches: 0,
          message: 'No matches found above threshold',
        };
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/search
 * 
 * Search for employees by face image (alias for identify with different defaults).
 * 
 * Body (multipart/form-data):
 * - companyId: string (required)
 * - threshold: number (optional) - minimum similarity threshold
 * - limit: number (optional, default: 5) - maximum results (1-20)
 * - file: File (required) - face image
 */
export async function search(req, res, next) {
  try {
    const { 
      companyId, 
      threshold: rawThreshold,
      limit: rawLimit 
    } = req.body;

    // Validate required fields
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Parse and validate threshold
    let threshold;
    if (rawThreshold !== undefined && rawThreshold !== null && rawThreshold !== '') {
      threshold = parseFloat(rawThreshold);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        return res.status(400).json({
          success: false,
          message: 'threshold must be a number between 0 and 1',
        });
      }
    }

    // Parse and validate limit
    let limit = 5; // default for search
    if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
      limit = parseInt(rawLimit, 10);
      if (isNaN(limit) || limit < 1 || limit > 20) {
        return res.status(400).json({
          success: false,
          message: 'limit must be an integer between 1 and 20',
        });
      }
    }

    // Log search attempt
    console.log('Face search request:', {
      companyId,
      threshold: threshold || 'server default',
      limit,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString()
    });

    // Perform search
    const result = await faceApiService.searchEmployeeByFace({
      companyId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      threshold,
      limit,
    });

    // Enhance response
    if (result && result.data) {
      result.mode = 'search';
      result.query_params = {
        threshold: threshold || DEFAULT_FACE_MATCH_THRESHOLD,
        limit,
      };
      result.request_timestamp = new Date().toISOString();
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/face/health
 * 
 * Check if the face recognition service is healthy.
 */
export async function health(req, res, next) {
  try {
    const result = await faceApiService.checkHealth();
    return res.status(200).json({
      ...result,
      local_timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

// Export all controller functions
export default {
  verify,
  verifyEmployee,
  identify,
  search,
  health,
};