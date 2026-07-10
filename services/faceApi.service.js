// src/services/faceApi.service.js
import axios from 'axios';
import FormData from 'form-data';
import { BASE_URL, API_KEY, ENDPOINTS, TIMEOUT_MS, BATCH_TIMEOUT_MS } from '../config/faceApi.config.js';

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
 * Detect face(s) in an image. Pure pre-check: is there 1 clear, real face?
 * @param {{fileBuffer: Buffer, fileName: string, mimeType: string, checkSpoofing?: boolean}} params
 */
export async function detectFace({ fileBuffer, fileName, mimeType, checkSpoofing = false }) {
  try {
    const form = new FormData();
    form.append('check_spoofing', String(checkSpoofing));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.DETECT, form, { headers: form.getHeaders() });
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
 * @param {{employeeId: string, companyId: string, fileBuffer: Buffer, fileName: string, mimeType: string}} params
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
 * @param {{employeeId: string, companyId: string, files: Array<{buffer: Buffer, originalname: string, mimetype: string}>}} params
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
 * @param {string} employeeId
 * @param {string} companyId
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
 * Verify a captured face against enrolled faces for a company (best match).
 * @param {{companyId: string, purpose?: string, fileBuffer: Buffer, fileName: string, mimeType: string, deviceInfo?: object}} params
 */
export async function verifyFace({ companyId, purpose = 'punch_in', fileBuffer, fileName, mimeType, deviceInfo = {} }) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    form.append('purpose', purpose);
    form.append('device_info', JSON.stringify(deviceInfo || {}));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.VERIFY, form, { headers: form.getHeaders() });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/**
 * Identify a face against the enrolled database for a company.
 * @param {{companyId: string, fileBuffer: Buffer, fileName: string, mimeType: string, threshold?: number}} params
 */
export async function identifyFace({ companyId, fileBuffer, fileName, mimeType, threshold }) {
  try {
    const form = new FormData();
    form.append('company_id', companyId);
    if (threshold !== undefined && threshold !== null) {
      form.append('threshold', String(threshold));
    }
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const { data } = await client.post(ENDPOINTS.IDENTIFY, form, { headers: form.getHeaders() });
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

/* ------------------------------------------------------------------ */
/* 4. HEALTH                                                           */
/* ------------------------------------------------------------------ */

export async function checkHealth() {
  try {
    const { data } = await client.get(ENDPOINTS.HEALTH);
    return data;
  } catch (err) {
    throw shapeError(err);
  }
}

export default {
  detectFace,
  trainSingleFace,
  trainBatchFaces,
  getTrainingStatus,
  verifyFace,
  identifyFace,
  checkHealth,
};
