import * as faceApiService from '../../services/faceApi.service.js';

export async function getHealthStatus(req, res, next) {
    try {
        const healthStatus = await faceApiService.getHealthStatus();    

        return res.status(200).json({
            success: true,
            message: 'Face API health status retrieved successfully',
            data: healthStatus,
        });
    }
    catch (err) {
        next(err);
    }
}

export async function getDocs(req, res, next) {
    try {
        const docs = await faceApiService.getDocs();
        return res.status(200).json({
            success: true,
            message: 'Face API documentation retrieved successfully',
            data: docs,
        });
    }
    catch (err) {
        next(err);
    }
}
