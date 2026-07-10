// src/controllers/faceTraining.controller.js
import * as faceApiService from '../../services/faceApi.service.js';

/**
 * POST /api/face/train/single
 * body: employeeId, companyId
 * file: file (multipart)
 */
export async function trainSingle(req, res, next) {
  try {
    const { employeeId, companyId } = req.body;

    if (!employeeId || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'employeeId and companyId are required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A face image file is required (field name: file)',
      });
    }

    const result = await faceApiService.trainSingleFace({
      employeeId,
      companyId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/face/train/batch
 * body: employeeId, companyId
 * files: files[] (multipart, max 5)
 */
export async function trainBatch(req, res, next) {
  try {
    const { employeeId, companyId } = req.body;

    if (!employeeId || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'employeeId and companyId are required',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one face image file is required (field name: files)',
      });
    }

    const result = await faceApiService.trainBatchFaces({
      employeeId,
      companyId,
      files: req.files,
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/face/train/status/:employeeId?companyId=xxx
 */
export async function getStatus(req, res, next) {
  try {
    const { employeeId } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId query parameter is required',
      });
    }

    const result = await faceApiService.getTrainingStatus(employeeId, companyId);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
