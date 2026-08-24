import mongoose from 'mongoose';

/**
 * Atomic sequence counter per hash-chain scope.
 * Each scope (organizationId string or '__GLOBAL__') has exactly one doc.
 * Sequence numbers are allocated via atomic $inc (safe across processes).
 *
 * Gaps are possible if a process crashes between $inc and the AuditLog
 * insert — the verifier treats gaps as tolerable (or strict via env flag).
 */
const AuditSequenceSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true,
    },
    seq: {
        type: Number,
        default: 0,
    },
}, { timestamps: true, versionKey: false });

export default mongoose.model('AuditSequence', AuditSequenceSchema);