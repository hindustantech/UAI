import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRequestBody, sanitizeSnapshot, maskFinancialMetadata } from '../../services/audit/sanitizer.js';

describe('sanitizeRequestBody()', () => {
    it('redacts password fields', () => {
        const body = { name: 'Alice', password: 'secret123', confirmPassword: 'secret123' };
        const r = sanitizeRequestBody(body);
        assert.equal(r.name, 'Alice');
        assert.equal(r.password, '[REDACTED]');
        assert.equal(r.confirmPassword, '[REDACTED]');
    });

    it('recursively redacts nested sensitive fields', () => {
        const body = { user: { token: 'abc', email: 'a@b.com' } };
        const r = sanitizeRequestBody(body);
        assert.equal(r.user.token, '[REDACTED]');
        assert.equal(r.user.email, 'a@b.com');
    });

    it('returns null for null', () => {
        assert.equal(sanitizeRequestBody(null), null);
    });

    it('returns parsed JSON-stringified body for objects that can be serialized', () => {
        const r = sanitizeRequestBody({ ok: true });
        assert.ok(typeof r === 'object');
    });

    it('handles non-object input by returning null', () => {
        assert.equal(sanitizeRequestBody(undefined), null);
        assert.equal(sanitizeRequestBody('string'), null);
        assert.equal(sanitizeRequestBody(42), null);
    });
});

describe('sanitizeSnapshot()', () => {
    it('redacts sensitive keys at all levels', () => {
        const data = { name: 'Bob', otp: '1234', creds: { password: 'x', apiKey: 'y' } };
        const r = sanitizeSnapshot(data);
        assert.equal(r.name, 'Bob');
        assert.equal(r.otp, '[REDACTED]');
        assert.equal(r.creds.password, '[REDACTED]');
        assert.equal(r.creds.apiKey, '[REDACTED]');
    });

    it('converts Date to ISO string at top level', () => {
        const r = sanitizeSnapshot({ ts: new Date('2026-01-15T00:00:00.000Z') });
        assert.equal(r.ts, '2026-01-15T00:00:00.000Z');
    });

    it('converts nested Date fields to ISO strings', () => {
        const doc = { outer: { createdAt: new Date('2026-03-01T00:00:00.000Z') } };
        const r = sanitizeSnapshot(doc);
        assert.equal(r.outer.createdAt, '2026-03-01T00:00:00.000Z');
    });

    it('converts ObjectId to string', () => {
        const id = { toString: () => '6a8e9c696c5d99ed8ca7abb4', toHexString: () => '6a8e9c696c5d99ed8ca7abb4' };
        const r = sanitizeSnapshot({ _id: id });
        assert.equal(r._id, '6a8e9c696c5d99ed8ca7abb4');
    });

    it('returns primitives unchanged', () => {
        assert.equal(sanitizeSnapshot(null), null);
        assert.equal(sanitizeSnapshot(42), 42);
        assert.equal(sanitizeSnapshot('hello'), 'hello');
        assert.equal(sanitizeSnapshot(true), true);
    });

    it('handles arrays (sanitized + length-capped)', () => {
        const arr = Array.from({ length: 100 }, (_, i) => ({ token: 'x', i }));
        const r = sanitizeSnapshot(arr);
        assert.ok(r.length <= 50);
        assert.equal(r[0].token, '[REDACTED]');
    });

    it('handles circular references without throwing', () => {
        const obj = { name: 'A' };
        obj.self = obj; // circular
        const r = sanitizeSnapshot(obj);
        assert.equal(r.name, 'A');
        assert.equal(r.self, '[Circular]');
    });
});

describe('maskFinancialMetadata()', () => {
    it('masks card numbers keeping last 4', () => {
        const r = maskFinancialMetadata({ cardNumber: '4111111111111234' });
        assert.ok(r.cardNumber.endsWith('1234'));
        assert.ok(r.cardNumber.startsWith('*'));
    });

    it('masks nested card numbers keeping last 4', () => {
        const r = maskFinancialMetadata({ payment: { cardNumber: '4111222233334444' } });
        assert.ok(r.payment.cardNumber.endsWith('4444'));
        assert.ok(r.payment.cardNumber.startsWith('*'));
    });

    it('masks accountNumber keeping last 4', () => {
        const r = maskFinancialMetadata({ accountNumber: '123456789012' });
        assert.ok(r.accountNumber.endsWith('9012'));
        assert.ok(r.accountNumber.startsWith('*'));
    });

    it('redacts passwords while masking financial fields in same object', () => {
        const r = maskFinancialMetadata({
            password: 'secret',
            amount: 25000,
            cardNumber: '4111111111111234',
        });
        assert.equal(r.password, '[REDACTED]');
        assert.equal(r.amount, 25000);
        assert.ok(r.cardNumber.endsWith('1234'));
    });

    it('returns null/undefined as-is', () => {
        assert.equal(maskFinancialMetadata(null), null);
        assert.equal(maskFinancialMetadata(undefined), undefined);
    });
});