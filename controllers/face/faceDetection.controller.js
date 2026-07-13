// src/controllers/faceDetection.controller.js
import * as faceApiService from '../../services/faceApi.service.js';
import {
  DEFAULT_FACE_MATCH_THRESHOLD, SUPPORTED_IMAGE_FORMATS,
  MAX_FILE_SIZE,
  DETECTION_SETTINGS
} from '../../config/faceApi.config.js';


/**
 * POST /api/face/detect
 * 
 * Generic face detection without matching or storage.
 * Supports optional company/employee context.
 * 
 * Body (multipart/form-data):
 * - file: File (required) - image to detect faces in
 * - check_spoofing: boolean (optional, default: false) - enable anti-spoofing
 * - company_id: string (optional) - company context
 * - employee_id: string (optional) - employee context with quick match
 */
export async function detectFaces(req, res, next) {
  try {
    const {
      check_spoofing: rawCheckSpoofing,
      company_id: companyId,
      employee_id: employeeId
    } = req.body;

    // Validate file presence
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Validate file type
    if (!SUPPORTED_IMAGE_FORMATS.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${req.file.mimetype}. Supported: ${SUPPORTED_IMAGE_FORMATS.join(', ')}`,
      });
    }

    // Validate file size
    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      });
    }

    // Parse check_spoofing
    const checkSpoofing = rawCheckSpoofing === 'true' || rawCheckSpoofing === true;

    // Log detection request
    console.log('Face detection request:', {
      companyId: companyId || 'not specified',
      employeeId: employeeId || 'not specified',
      checkSpoofing,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      timestamp: new Date().toISOString()
    });

    // Choose detection type based on parameters
    let result;

    if (employeeId && companyId) {
      // Employee-specific detection with quick match
      result = await faceApiService.detectFaceForEmployee({
        companyId,
        employeeId,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        checkSpoofing,
      });
      result.detection_mode = 'employee_specific';
    } else if (companyId) {
      // Company-specific detection
      result = await faceApiService.detectFaceForCompany({
        companyId,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        checkSpoofing,
      });
      result.detection_mode = 'company_specific';
    } else {
      // Generic detection
      result = await faceApiService.detectFace({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        checkSpoofing,
        companyId: companyId || null,
        employeeId: employeeId || null,
      });
      result.detection_mode = 'generic';
    }

    // Enhance response with metadata
    if (result && result.data) {
      result.image_info = {
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        file_size: req.file.size,
        file_size_formatted: formatFileSize(req.file.size),
      };
      result.request_timestamp = new Date().toISOString();

      // Add human-readable summary
      const faceCount = result.data.face_count || 0;
      if (faceCount === 0) {
        result.summary = {
          message: 'No face detected in the image',
          suggestions: [
            'Ensure the face is clearly visible',
            'Check lighting conditions',
            'Make sure the face is not obstructed',
            'Try a different angle',
          ],
        };
      } else if (faceCount === 1) {
        const face = result.data.faces?.[0];
        result.summary = {
          message: 'One face detected successfully',
          quality: face?.quality || 'unknown',
          is_enrollment_ready: result.data.is_enrollment_ready || false,
        };

        if (face?.match_info) {
          result.summary.quick_match = {
            employee_id: face.match_info.employee_id,
            similarity: face.match_info.similarity,
            confidence: face.match_info.confidence_level,
            is_potential_match: face.match_info.is_potential_match,
          };
        }
      } else {
        result.summary = {
          message: `Multiple faces detected (${faceCount})`,
          warning: 'Only one face should be present for verification or enrollment',
        };
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/detect/company
 * 
 * Detect faces specifically for a company context.
 * Includes company enrollment statistics and recent activity.
 * 
 * Body (multipart/form-data):
 * - company_id: string (required)
 * - file: File (required)
 * - check_spoofing: boolean (optional)
 */
export async function detectForCompany(req, res, next) {
  try {
    const {
      company_id: companyId,
      check_spoofing: rawCheckSpoofing
    } = req.body;

    // Validate required fields
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'company_id is required for company-specific detection',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Validate file
    if (!SUPPORTED_IMAGE_FORMATS.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${req.file.mimetype}`,
      });
    }

    const checkSpoofing = rawCheckSpoofing === 'true' || rawCheckSpoofing === true;

    // Log request
    console.log('Company-specific detection request:', {
      companyId,
      checkSpoofing,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString()
    });

    // Perform company-specific detection
    const result = await faceApiService.detectFaceForCompany({
      companyId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      checkSpoofing,
    });

    // Enhance response
    if (result && result.data) {
      result.detection_mode = 'company_specific';
      result.company_id = companyId;
      result.image_info = {
        original_name: req.file.originalname,
        file_size_formatted: formatFileSize(req.file.size),
      };
      result.request_timestamp = new Date().toISOString();

      // Add company-specific summary
      const context = result.data.company_context || {};
      result.company_summary = {
        total_enrolled: context.total_enrolled || 0,
        active_employees: context.active_employees || 0,
        has_enrolled_faces: context.has_enrolled_faces || false,
        can_verify: (context.active_employees || 0) > 0,
      };
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/detect/employee
 * 
 * Detect face for specific employee with quick preliminary match.
 * 
 * Body (multipart/form-data):
 * - company_id: string (required)
 * - employee_id: string (required)
 * - file: File (required)
 * - check_spoofing: boolean (optional)
 */
export async function detectForEmployee(req, res, next) {
  try {
    const {
      company_id: companyId,
      employee_id: employeeId,
      check_spoofing: rawCheckSpoofing
    } = req.body;

    // Validate required fields
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'company_id is required',
      });
    }

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'employee_id is required for employee-specific detection',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    // Validate file
    if (!SUPPORTED_IMAGE_FORMATS.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${req.file.mimetype}`,
      });
    }

    const checkSpoofing = rawCheckSpoofing === 'true' || rawCheckSpoofing === true;

    // Log request
    console.log('Employee-specific detection request:', {
      companyId,
      employeeId,
      checkSpoofing,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString()
    });

    // Perform employee-specific detection
    const result = await faceApiService.detectFaceForEmployee({
      companyId,
      employeeId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      checkSpoofing,
    });

    // Enhance response
    if (result && result.data) {
      result.detection_mode = 'employee_specific';
      result.company_id = companyId;
      result.employee_id = employeeId;
      result.image_info = {
        original_name: req.file.originalname,
        file_size_formatted: formatFileSize(req.file.size),
      };
      result.request_timestamp = new Date().toISOString();

      // Add employee-specific summary
      const empContext = result.data.employee_context || {};
      const quickMatch = result.data.quick_match;

      result.employee_summary = {
        is_enrolled: empContext.is_enrolled || false,
        enrollment_status: empContext.enrollment_status || 'unknown',
        active_images: empContext.active_images || 0,
        is_locked: empContext.is_locked || false,
        last_verified: empContext.last_verified_at || null,
      };

      if (quickMatch) {
        result.match_summary = {
          is_match: quickMatch.is_potential_match || false,
          confidence: quickMatch.confidence_level || 'unknown',
          similarity: quickMatch.similarity || 0,
          recommendation: quickMatch.is_potential_match
            ? 'Face likely matches this employee - proceed with verification'
            : 'Face may not match this employee - consider re-enrollment',
        };
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/detect/validate-enrollment
 * 
 * Validate if an image is suitable for face enrollment.
 * 
 * Body (multipart/form-data):
 * - file: File (required)
 * - company_id: string (optional)
 * - employee_id: string (optional) - to check existing images count
 */
export async function validateEnrollment(req, res, next) {
  try {
    const {
      company_id: companyId,
      employee_id: employeeId
    } = req.body;

    // Validate file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    if (!SUPPORTED_IMAGE_FORMATS.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${req.file.mimetype}`,
      });
    }

    // Log request
    console.log('Enrollment validation request:', {
      companyId: companyId || 'not specified',
      employeeId: employeeId || 'not specified',
      fileName: req.file.originalname,
      timestamp: new Date().toISOString()
    });

    // Validate for enrollment
    const result = await faceApiService.validateForEnrollment({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      companyId: companyId || null,
      employeeId: employeeId || null,
    });

    // Enhance response
    if (result && result.data) {
      result.validation_type = 'enrollment';
      result.image_info = {
        original_name: req.file.originalname,
        file_size_formatted: formatFileSize(req.file.size),
      };
      result.request_timestamp = new Date().toISOString();

      // Add actionable feedback
      const validationData = result.data;
      if (!validationData.is_valid) {
        result.recommendations = generateEnrollmentRecommendations(validationData.reason);
      } else {
        result.recommendations = [
          'Image is suitable for enrollment',
          'Proceed to submit for face training',
        ];
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/face/detect/health
 * 
 * Health check for face detection service.
 */
export async function health(req, res, next) {
  try {
    const result = await faceApiService.checkDetectionHealth();
    return res.status(200).json({
      ...result,
      local_timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/detect/batch
 * 
 * Batch detection for multiple images (useful for bulk enrollment validation).
 * 
 * Body (multipart/form-data):
 * - files: File[] (required) - multiple images
 * - company_id: string (optional)
 * - employee_id: string (optional)
 */
export async function batchDetect(req, res, next) {
  try {
    const { company_id: companyId, employee_id: employeeId } = req.body;

    // Validate files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one image file is required (field name: files)',
      });
    }

    if (req.files.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 images allowed per batch detection',
      });
    }

    // Process each file
    const results = [];
    for (const file of req.files) {
      try {
        // Validate file type
        if (!SUPPORTED_IMAGE_FORMATS.includes(file.mimetype)) {
          results.push({
            file_name: file.originalname,
            success: false,
            error: `Unsupported file type: ${file.mimetype}`,
          });
          continue;
        }

        // Perform detection
        const result = await faceApiService.detectFace({
          fileBuffer: file.buffer,
          fileName: file.originalname,
          mimeType: file.mimetype,
          companyId: companyId || null,
          employeeId: employeeId || null,
        });

        results.push({
          file_name: file.originalname,
          success: true,
          data: result.data,
        });
      } catch (error) {
        results.push({
          file_name: file.originalname,
          success: false,
          error: error.message,
        });
      }
    }

    // Generate batch summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    return res.status(200).json({
      success: true,
      data: {
        total: req.files.length,
        successful: successful.length,
        failed: failed.length,
        results,
        summary: {
          enrollment_ready_count: successful.filter(r =>
            r.data?.is_enrollment_ready
          ).length,
          total_faces_detected: successful.reduce((sum, r) =>
            sum + (r.data?.face_count || 0), 0
          ),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

// Utility functions
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function generateEnrollmentRecommendations(reason) {
  const recommendations = [];

  if (reason.includes('No face detected')) {
    recommendations.push('Ensure the face is clearly visible in the frame');
    recommendations.push('Check that lighting is adequate');
    recommendations.push('Remove any obstructions (masks, sunglasses, etc.)');
  }

  if (reason.includes('Multiple faces')) {
    recommendations.push('Ensure only one person is in the frame');
    recommendations.push('Remove background people or photo frames');
  }

  if (reason.includes('quality is poor')) {
    recommendations.push('Use better lighting conditions');
    recommendations.push('Ensure the camera is focused on the face');
    recommendations.push('Move closer to the camera');
    recommendations.push('Use a higher resolution camera');
  }

  if (reason.includes('Face too small')) {
    recommendations.push('Move closer to the camera');
    recommendations.push('Ensure face occupies at least 30% of the image');
  }

  if (reason.includes('maximum allowed images')) {
    recommendations.push('Remove some existing images before adding new ones');
    recommendations.push('Consider re-enrollment instead of adding more images');
  }

  if (recommendations.length === 0) {
    recommendations.push('Please try with a different image');
    recommendations.push('Ensure all enrollment requirements are met');
  }

  return recommendations;
}

export default {
  detectFaces,
  detectForCompany,
  detectForEmployee,
  validateEnrollment,
  batchDetect,
  health,
};