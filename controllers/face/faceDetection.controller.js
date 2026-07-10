// src/controllers/faceDetection.controller.js
import * as faceApiService from '../../services/faceApi.service.js';

/**
 * POST /api/face/detect
 * body: checkSpoofing (optional, "true"/"false")
 * file: file (multipart)
 *
 * Pre-check only — does NOT touch the database, does NOT store anything.
 */
export async function detect(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    const checkSpoofing = req.body.checkSpoofing === 'true' || req.body.checkSpoofing === true;

    const result = await faceApiService.detectFace({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      checkSpoofing,
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
