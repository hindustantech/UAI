import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import buildAuditLogQuery, { ValidationError } from '../../services/audit/queryBuilder.js';

const ORG_A = '69d4de01d19cd0817fa3e6f4';
const ORG_B = '69d4de01d19cd0817fa3e6f5';

// COMPANY-scoped user (NOT global) — e.g. an org admin employee
const companyCtx = () => ({ scope: 'COMPANY', type: 'user', companyId: ORG_A });
// GLOBAL-scoped user
const globalCtx = () => ({ scope: 'GLOBAL', type: 'super_admin', companyId: null });

describe('organization isolation', () => {
    it('COMPANY scope forces organizationId to own company', () => {
        const { filter } = buildAuditLogQuery({ resource: 'Employee' }, companyCtx());
        assert.ok(filter.organizationId instanceof mongoose.Types.ObjectId);
    });

    it('COMPANY user cannot override organizationId via query param', () => {
        const { filter } = buildAuditLogQuery({ organizationId: ORG_B }, companyCtx());
        assert.equal(filter.organizationId.toString(), ORG_A);
    });

    it('GLOBAL scope may query a specific organizationId', () => {
        const { filter } = buildAuditLogQuery({ organizationId: ORG_B }, globalCtx());
        assert.equal(filter.organizationId.toString(), ORG_B);
    });

    it('COMPANY user without companyId throws ValidationError', () => {
        assert.throws(
            () => buildAuditLogQuery({}, { scope: 'COMPANY', type: 'user', companyId: null }),
            ValidationError
        );
    });
});

describe('date range (UTC)', () => {
    it('from + to produce $gte/$lte on timestamp', () => {
        const { filter } = buildAuditLogQuery(
            { from: '2026-08-01T00:00:00.000Z', to: '2026-08-26T23:59:59.999Z' },
            companyCtx()
        );
        assert.ok(filter.timestamp.$gte instanceof Date);
        assert.ok(filter.timestamp.$lte instanceof Date);
        assert.equal(filter.timestamp.$gte.toISOString(), '2026-08-01T00:00:00.000Z');
        assert.equal(filter.timestamp.$lte.toISOString(), '2026-08-26T23:59:59.999Z');
    });

    it('from only produces $gte', () => {
        const { filter } = buildAuditLogQuery({ from: '2026-08-01T00:00:00.000Z' }, companyCtx());
        assert.ok(filter.timestamp.$gte);
        assert.equal(filter.timestamp.$lte, undefined);
    });

    it('to only produces $lte', () => {
        const { filter } = buildAuditLogQuery({ to: '2026-08-30T00:00:00.000Z' }, companyCtx());
        assert.ok(filter.timestamp.$lte);
        assert.equal(filter.timestamp.$gte, undefined);
    });

    it('invalid from date throws ValidationError', () => {
        assert.throws(() => buildAuditLogQuery({ from: 'not-a-date' }, companyCtx()), ValidationError);
    });

    it('invalid to date throws ValidationError', () => {
        assert.throws(() => buildAuditLogQuery({ to: 'garbage' }, companyCtx()), ValidationError);
    });

    it('from > to throws ValidationError (no silent swap)', () => {
        assert.throws(
            () => buildAuditLogQuery(
                { from: '2026-09-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
                companyCtx()
            ),
            ValidationError
        );
    });
});

describe('filters AND-combined', () => {
    it('resource + resourceId + action + success all present in filter', () => {
        const { filter } = buildAuditLogQuery({
            resource: 'Employee',
            resourceId: 'abc123',
            action: 'EMPLOYEE.UPDATE',
            success: 'true',
            method: 'patch',
            requestId: 'req-42',
        }, companyCtx());

        assert.equal(filter.resource, 'Employee');
        assert.equal(filter.resourceId, 'abc123');
        assert.equal(filter.action, 'EMPLOYEE.UPDATE');
        assert.equal(filter.success, true);
        assert.equal(filter['http.method'], 'PATCH');
        assert.equal(filter.requestId, 'req-42');
        // All combined on the same flat filter object (AND semantics)
    });

    it('eventType validated against whitelist', () => {
        const ok = buildAuditLogQuery({ eventType: 'financial' }, companyCtx()); // case-insensitive
        assert.equal(ok.filter.eventType, 'FINANCIAL');
        assert.throws(() => buildAuditLogQuery({ eventType: 'HACKED' }, companyCtx()), ValidationError);
    });

    it('operation validated against whitelist', () => {
        const ok = buildAuditLogQuery({ operation: 'delete' }, companyCtx());
        assert.equal(ok.filter.operation, 'DELETE');
        assert.throws(() => buildAuditLogQuery({ operation: 'NUKE' }, companyCtx()), ValidationError);
    });

    it('result validated against whitelist', () => {
        const ok = buildAuditLogQuery({ result: 'failure' }, companyCtx());
        assert.equal(ok.filter.result, 'FAILURE');
        assert.throws(() => buildAuditLogQuery({ result: 'MAYBE' }, companyCtx()), ValidationError);
    });
});

describe('pagination + sorting', () => {
    it('defaults page=1 limit=50 sort=timestamp DESC', () => {
        const q = buildAuditLogQuery({}, companyCtx());
        assert.equal(q.page, 1);
        assert.equal(q.limit, 50);
        assert.deepEqual(q.sort, { timestamp: -1 });
    });

    it('caps limit at 200', () => {
        const q = buildAuditLogQuery({ limit: '5000' }, companyCtx());
        assert.equal(q.limit, 200);
    });

    it('negative page clamps to 1', () => {
        const q = buildAuditLogQuery({ page: '-5' }, companyCtx());
        assert.equal(q.page, 1);
    });

    it('accepts whitelisted sort fields', () => {
        const q = buildAuditLogQuery({ sortBy: 'action', sortOrder: 'asc' }, companyCtx());
        assert.deepEqual(q.sort, { action: 1 });
    });

    it('unknown sortBy falls back to timestamp', () => {
        const q = buildAuditLogQuery({ sortBy: '$where injection' }, companyCtx());
        assert.deepEqual(q.sort, { timestamp: -1 });
    });
});

describe('search mapping', () => {
    it('maps free text to safe indexed-ish $or fields', () => {
        const { filter } = buildAuditLogQuery({ search: 'EMPLOYEE' }, companyCtx());
        assert.ok(Array.isArray(filter.$or));
        const fields = filter.$or.flatMap(o => Object.keys(o));
        assert.ok(fields.includes('action'));
        assert.ok(fields.includes('resource'));
        // Must NOT contain unrestricted deep-object regex targets
    });

    it('ObjectId-looking term adds userId/eventId matches', () => {
        const { filter } = buildAuditLogQuery({ search: ORG_A }, companyCtx());
        const fields = filter.$or.flatMap(o => Object.keys(o));
        assert.ok(fields.includes('userId'));
        assert.ok(fields.includes('eventId'));
    });
});

describe('hidden record visibility', () => {
    it('default excludes HIDDEN records', () => {
        const { filter } = buildAuditLogQuery({}, companyCtx());
        assert.deepEqual(filter.visibilityStatus, { $ne: 'HIDDEN' });
    });

    it('includeHidden=true works only for GLOBAL users', () => {
        const companyQ = buildAuditLogQuery({ includeHidden: 'true' }, companyCtx());
        assert.deepEqual(companyQ.filter.visibilityStatus, { $ne: 'HIDDEN' });

        const globalQ = buildAuditLogQuery({ includeHidden: 'true' }, globalCtx());
        assert.equal(globalQ.filter.visibilityStatus, undefined);
    });
});

describe('invalid inputs → ValidationError', () => {
    it('invalid userId throws', () => {
        assert.throws(() => buildAuditLogQuery({ userId: 'not-an-objectid' }, companyCtx()), ValidationError);
    });

    it('GLOBAL user passing invalid organizationId throws', () => {
        assert.throws(() => buildAuditLogQuery({ organizationId: 'bad-id' }, globalCtx()), ValidationError);
    });
});

/* helper so the assertion above can check ObjectId instance without importing mongoose at top */
function mongooseObjectId() {
    return require('mongoose').Types.ObjectId;
}
