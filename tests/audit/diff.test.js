import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diff, formatDiffForDisplay, extractAuditSnapshot } from '../../services/audit/diff.js';

describe('diff()', () => {
    it('returns noChange when both inputs are null', () => {
        const r = diff(null, null);
        assert.equal(r.noChange, true);
        assert.deepEqual(r.changedFields, []);
        assert.deepEqual(r.changes, []);
    });

    it('returns all keys changed when only newDoc exists (CREATE)', () => {
        const r = diff(null, { name: 'Alice', age: 30 });
        assert.equal(r.noChange, false);
        assert.deepEqual(r.oldData, null);
        assert.deepEqual(r.newData, { name: 'Alice', age: 30 });
        // One-sided: changedFields stays empty (CREATE case)
        assert.deepEqual(r.changedFields, []);
    });

    it('returns empty changedFields when only oldDoc exists (DELETE)', () => {
        const r = diff({ name: 'Alice' }, null);
        assert.equal(r.noChange, false);
        assert.deepEqual(r.oldData, { name: 'Alice' });
        assert.deepEqual(r.newData, null);
        assert.deepEqual(r.changedFields, []);
    });

    it('detects simple scalar changes', () => {
        const r = diff(
            { a: 1, b: 'old', c: true },
            { a: 1, b: 'new', c: true },
        );
        assert.equal(r.noChange, false);
        assert.deepEqual(r.changedFields, ['b']);
        assert.equal(r.changes.length, 1);
        assert.equal(r.changes[0].field, 'b');
        assert.equal(r.changes[0].oldValue, 'old');
        assert.equal(r.changes[0].newValue, 'new');
    });

    it('ignores updatedAt, createdAt, __v', () => {
        const r = diff(
            { name: 'Alice', updatedAt: '2026-01-01', createdAt: '2026-01-01', __v: 5 },
            { name: 'Alice', updatedAt: '2026-02-02', createdAt: '2026-01-01', __v: 6 },
        );
        assert.equal(r.noChange, true);
    });

    it('ignores _id-prefixed fields', () => {
        const r = diff(
            { _id: 'x', _internal: 1, name: 'A' },
            { _id: 'y', _internal: 2, name: 'A' },
        );
        assert.equal(r.noChange, true);
    });

    it('detects nested object changes via dotted paths', () => {
        const r = diff(
            { salaryStructure: { basic: 10000, allowance: 2000 } },
            { salaryStructure: { basic: 15000, allowance: 2000 } },
        );
        assert.deepEqual(r.changedFields, ['salaryStructure.basic']);
        assert.equal(r.changes[0].oldValue, 10000);
        assert.equal(r.changes[0].newValue, 15000);
    });

    it('detects deeply nested changes', () => {
        const old = { a: { b: { c: { d: 1 } } } };
        const nw  = { a: { b: { c: { d: 2 } } } };
        const r = diff(old, nw);
        assert.deepEqual(r.changedFields, ['a.b.c.d']);
    });

    it('detects array changes', () => {
        const r = diff(
            { weeklyOff: ['Monday', 'Tuesday'] },
            { weeklyOff: ['Monday', 'Wednesday'] },
        );
        assert.deepEqual(r.changedFields, ['weeklyOff']);
        assert.equal(r.changes[0].oldValue[0], 'Monday');
        assert.equal(r.changes[0].newValue[1], 'Wednesday');
    });

    it('treats arrays of same primitives as equal', () => {
        const r = diff(
            { roles: ['a', 'b'] },
            { roles: ['b', 'a'] }, // order matters in JSON.stringify comparison
        );
        // order matters — [b,a] !== [a,b] by JSON.stringify
        assert.deepEqual(r.changedFields, ['roles']);
    });

    it('detects null → value transition', () => {
        const r = diff({ phone: null }, { phone: '1234567890' });
        assert.deepEqual(r.changedFields, ['phone']);
        assert.equal(r.changes[0].oldValue, null);
        assert.equal(r.changes[0].newValue, '1234567890');
    });

    it('detects value → null transition', () => {
        const r = diff({ phone: '1234567890' }, { phone: null });
        assert.deepEqual(r.changedFields, ['phone']);
    });

    it('detects added keys in nested objects', () => {
        const r = diff(
            { officeLocation: { coordinates: [0, 0] } },
            { officeLocation: { coordinates: [0, 0], radius: 200 } },
        );
        assert.deepEqual(r.changedFields, ['officeLocation.radius']);
    });

    it('reports changes array with empty oldValue for added keys', () => {
        const r = diff(
            { bankDetails: {} },
            { bankDetails: { accountNumber: '1234' } },
        );
        assert.equal(r.changes[0].oldValue, null);
        assert.equal(r.changes[0].newValue, '1234');
    });

    it('handles identical objects as noChange', () => {
        const obj = { a: 1, nested: { b: 2 }, arr: [1, 2, 3] };
        const r = diff(obj, structuredClone(obj));
        assert.equal(r.noChange, true);
    });
});

describe('formatDiffForDisplay()', () => {
    it('generates field/value pairs from changedFields', () => {
        const oldDoc = { a: 1, b: 2 };
        const newDoc = { a: 1, b: 3 };
        const r = formatDiffForDisplay(oldDoc, newDoc, ['b']);
        assert.deepEqual(r, [{ field: 'b', oldValue: 2, newValue: 3 }]);
    });

    it('handles empty changedFields', () => {
        assert.deepEqual(formatDiffForDisplay({}, {}, []), []);
    });

    it('handles null inputs gracefully', () => {
        const r = formatDiffForDisplay(null, null, ['x']);
        assert.deepEqual(r, [{ field: 'x', oldValue: null, newValue: null }]);
    });

    it('supports dotted nested paths', () => {
        const oldDoc = { a: { b: { c: 'old' } } };
        const newDoc = { a: { b: { c: 'new' } } };
        const r = formatDiffForDisplay(oldDoc, newDoc, ['a.b.c']);
        assert.deepEqual(r, [{ field: 'a.b.c', oldValue: 'old', newValue: 'new' }]);
    });
});

describe('extractAuditSnapshot()', () => {
    it('strips __v, updatedAt, createdAt, password, token', () => {
        const doc = {
            name: 'Alice',
            __v: 3,
            updatedAt: new Date(),
            createdAt: new Date(),
            password: 'secret123',
            token: 'abc',
            age: 30,
        };
        const r = extractAuditSnapshot(doc);
        assert.equal(r.name, 'Alice');
        assert.equal(r.age, 30);
        assert.equal(r.__v, undefined);
        assert.equal(r.updatedAt, undefined);
        assert.equal(r.createdAt, undefined);
        assert.equal(r.password, undefined);
        assert.equal(r.token, undefined);
    });

    it('recursively cleans nested docs', () => {
        const doc = { outer: { password: 'secret', inner: { token: 'xyz' } } };
        const r = extractAuditSnapshot(doc);
        assert.equal(r.outer.password, undefined);
        assert.equal(r.outer.inner.token, undefined);
    });

    it('returns null for non-object input', () => {
        assert.equal(extractAuditSnapshot(null), null);
        assert.equal(extractAuditSnapshot(undefined), null);
        assert.equal(extractAuditSnapshot(123), null);
    });

    it('preserves arrays', () => {
        const doc = { roles: ['admin', 'manager'], password: 'x' };
        const r = extractAuditSnapshot(doc);
        assert.deepEqual(r.roles, ['admin', 'manager']);
        assert.equal(r.password, undefined);
    });
});
