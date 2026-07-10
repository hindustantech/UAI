// src/controllers/faceRecognition.controller.js
import * as faceApiService from '../../services/faceApi.service.js';

const VALID_PURPOSES = ['punch_in', 'punch_out', 're_verification', 'spot_check'];

/**
 * POST /api/face/verify
 * body: companyId, purpose (optional), deviceInfo (optional JSON string)
 * file: file (multipart)
 */
export async function verify(req, res, next) {
  try {
    const { companyId, purpose = 'punch_in' } = req.body;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }

    if (!VALID_PURPOSES.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: `purpose must be one of: ${VALID_PURPOSES.join(', ')}`,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    let deviceInfo = {};
    if (req.body.deviceInfo) {
      try {
        deviceInfo =
          typeof req.body.deviceInfo === 'string'
            ? JSON.parse(req.body.deviceInfo)
            : req.body.deviceInfo;
      } catch (_) {
        deviceInfo = {};
      }
    }

    const result = await faceApiService.verifyFace({
      companyId,
      purpose,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      deviceInfo,
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/identify
 * body: companyId, threshold (optional)
 * file: file (multipart)
 */
export async function identify(req, res, next) {
  try {
    const { companyId, threshold } = req.body;

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

    const result = await faceApiService.identifyFace({
      companyId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      threshold: threshold ? parseFloat(threshold) : undefined,
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
