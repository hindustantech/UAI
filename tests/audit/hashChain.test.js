import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, computeEventHash } from '../../services/audit/hashChain.js';

describe('hash canonicalization', () => {
    it('canonicalJson produces deterministic output for plain object', () => {
        const obj = { b: 2, a: 1, c: 'hello' };
        const r1 = canonicalJson(obj);
        const r2 = canonicalJson(obj);
        assert.equal(r1, r2);
    });

    it('sorts keys at every level and quotes keys via JSON.stringify', () => {
        const obj = { z: 1, a: { y: 2, x: 3 }, arr: [1, 2, 3] };
        const r = canonicalJson(obj);
        assert.equal(r, '{"a":{"x":3,"y":2},"arr":[1,2,3],"z":1}');
    });

    it('handles null and undefined as null', () => {
        assert.equal(canonicalJson(null), 'null');
        assert.equal(canonicalJson(undefined), 'null');
    });

    it('handles numbers and booleans', () => {
        assert.equal(canonicalJson(42), '42');
        assert.equal(canonicalJson(true), 'true');
        assert.equal(canonicalJson(false), 'false');
    });

    it('escapes strings via JSON.stringify', () => {
        assert.equal(canonicalJson('hello'), '"hello"');
        assert.equal(canonicalJson('hello "world"'), '"hello \\"world\\""');
    });

    it('serializes Date to quoted ISO string', () => {
        const d = new Date('2026-08-26T07:57:29.647Z');
        assert.equal(canonicalJson(d), '"2026-08-26T07:57:29.647Z"');
    });

    it('serializes ObjectId-like values via toString()', () => {
        const id = {
            hex: '6a8e9c696c5d99ed8ca7abb4',
            toHexString() { return this.hex; },
            toString() { return this.hex; },
        };
        assert.equal(canonicalJson(id), '"6a8e9c696c5d99ed8ca7abb4"');
    });

    it('excludes SYSTEM_KEYS from object hashing', () => {
        // _id, __v, updatedAt, createdAt are excluded by stringifyValue
        const a = canonicalJson({ name: 'x', _id: 'AAA', __v: 1, createdAt: '2020' });
        const b = canonicalJson({ name: 'x', _id: 'BBB', __v: 9, createdAt: '2029' });
        assert.equal(a, b); // system fields must not affect hash
    });

    it('computeEventHash is deterministic and SHA-256 length', () => {
        const evt = {
            eventId: 'test-123',
            timestamp: new Date('2026-08-26T07:57:29.647Z'),
            actorType: 'USER',
            actorId: '69c11d9fef51e3f596428862',
            action: 'EMPLOYEE.UPDATE',
            resource: 'Employee',
            resourceId: '6a58a5c6ad4df40e1a122ea8',
            requestId: null,
            success: true,
            oldData: { basic: 100 },
            newData: { basic: 200 },
            previousHash: 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000',
        };
        const h1 = computeEventHash(evt);
        const h2 = computeEventHash(evt);
        assert.equal(h1, h2);
        assert.equal(h1.length, 64);
    });

    it('computeEventHash changes when content is tampered', () => {
        const evt = {
            eventId: 'test-123',
            timestamp: new Date('2026-08-26T07:57:29.647Z'),
            actorType: 'USER',
            actorId: '69c11d9fef51e3f596428862',
            action: 'EMPLOYEE.UPDATE',
            resource: 'Employee',
            resourceId: '6a58a5c6ad4df40e1a122ea8',
            requestId: null,
            success: true,
            oldData: { basic: 100 },
            newData: { basic: 200 },
            previousHash: 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000',
        };
        const original = computeEventHash(evt);
        const tampered = computeEventHash({ ...evt, newData: { basic: 999999 } });
        assert.notEqual(original, tampered);
    });
});