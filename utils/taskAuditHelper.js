import AuditLog from '../models/AuditLog.js';
import { computeEventHash, getPreviousHash } from '../services/audit/hashChain.js';

export const getNextAuditSeq = async (entityId, prefix = 'task') => {
  try {
    const chainScope = `${prefix}-${entityId}`;
    const lastSeq = await AuditLog.findOne({ chainScope })
      .sort({ seq: -1 })
      .select('seq');
    return (lastSeq && lastSeq.seq ? lastSeq.seq + 1 : 1);
  } catch (error) {
    return 1;
  }
};

export const createTaskAuditLog = async (auditData) => {
  try {
    const {
      action,
      entityType,
      entityId,
      actorId,
      companyId,
      before,
      after,
      metadata,
      prefix = 'task',
    } = auditData;

    const chainScope = `${prefix}-${entityId}`;
    const seq = await getNextAuditSeq(entityId, prefix);
    const previousHash = await getPreviousHash(chainScope, seq);
    const timestamp = new Date();
    const eventId = `${action}-${entityId}-${Date.now()}`;

    const auditLog = new AuditLog({
      eventId,
      timestamp,
      actorType: 'USER',
      userId: actorId,
      organizationId: companyId,
      action,
      resource: entityType,
      resourceId: String(entityId),
      oldData: before,
      newData: after,
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope,
      seq,
      previousHash,
      currentHash: computeEventHash({
        eventId,
        timestamp,
        actorType: 'USER',
        actorId,
        action,
        resource: entityType,
        resourceId: String(entityId),
        requestId: null,
        success: true,
        oldData: before,
        newData: after,
        previousHash,
      }),
      metadata
    });

    await auditLog.save();
  } catch (error) {
    console.error('Create audit log error:', error);
  }
};
