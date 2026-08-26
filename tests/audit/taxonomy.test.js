import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFromAction, deriveOperation, deriveEventType, deriveSeverity } from '../../services/audit/taxonomy.js';

describe('deriveFromAction()', () => {
    it('derives READ for SHIFT.GET_LIST', () => {
        const r = deriveFromAction('SHIFT.GET_LIST');
        assert.equal(r.eventType, 'READ');
        assert.equal(r.operation, 'READ');
    });

    it('derives WRITE/UPDATE for EMPLOYEE.UPDATE', () => {
        const r = deriveFromAction('EMPLOYEE.UPDATE');
        assert.equal(r.eventType, 'WRITE');
        assert.equal(r.operation, 'UPDATE');
    });

    it('derives WRITE/CREATE for EMPLOYEE.CREATE', () => {
        const r = deriveFromAction('EMPLOYEE.CREATE');
        assert.equal(r.operation, 'CREATE');
    });

    it('derives WRITE/DELETE for EMPLOYEE.DELETE', () => {
        const r = deriveFromAction('EMPLOYEE.DELETE');
        assert.equal(r.operation, 'DELETE');
    });

    it('derives WRITE/ACTIVATE for EMPLOYEE.ACTIVATE', () => {
        assert.equal(deriveFromAction('EMPLOYEE.ACTIVATE').operation, 'ACTIVATE');
    });

    it('derives WRITE/DEACTIVATE for EMPLOYEE.DEACTIVATE', () => {
        assert.equal(deriveFromAction('EMPLOYEE.DEACTIVATE').operation, 'DEACTIVATE');
    });

    it('derives FINANCIAL/PAYMENT for PAYROLL.PAYMENT', () => {
        const r = deriveFromAction('PAYROLL.PAYMENT');
        assert.equal(r.eventType, 'FINANCIAL');
        assert.equal(r.operation, 'PAYMENT');
    });

    it('derives SECURITY/LOGIN for AUTH.LOGIN', () => {
        const r = deriveFromAction('AUTH.LOGIN');
        assert.equal(r.eventType, 'SECURITY');
        assert.equal(r.operation, 'LOGIN');
        assert.equal(r.severity, 'INFO');
    });

    it('derives WARNING severity for AUTH.LOGIN_FAILED', () => {
        const r = deriveFromAction('AUTH.LOGIN_FAILED');
        assert.equal(r.severity, 'WARNING');
    });

    it('derives CRITICAL severity for PAYROLL.PAYMENT_FAILED', () => {
        assert.equal(deriveFromAction('PAYROLL.PAYMENT_FAILED').severity, 'CRITICAL');
    });

    it('derives FINANCIAL for PAYMENT.SUCCESS', () => {
        const r = deriveFromAction('PAYMENT.SUCCESS');
        assert.equal(r.eventType, 'FINANCIAL');
        assert.equal(r.operation, 'PAYMENT');
    });

    it('derives FINANCIAL for PAYMENT.VERIFY_PAYMENT', () => {
        const r = deriveFromAction('PAYMENT.VERIFY_PAYMENT');
        assert.equal(r.eventType, 'FINANCIAL');
    });

    it('derives WRITE/APPROVE for ATTENDANCE.APPROVE', () => {
        const r = deriveFromAction('ATTENDANCE.APPROVE');
        assert.equal(r.operation, 'APPROVE');
    });

    it('falls back to READ heuristic for suffix GET_LIST', () => {
        const r = deriveFromAction('SOMETHING.GET_LIST');
        assert.equal(r.eventType, 'READ');
        assert.equal(r.operation, 'READ');
    });

    it('falls back to CREATE heuristic for suffix ADD', () => {
        const r = deriveFromAction('THING.ADD');
        assert.equal(r.operation, 'CREATE');
    });

    it('falls back to UPDATE heuristic for suffix TOGGLE_STATUS', () => {
        const r = deriveFromAction('PAYROLLRULE.TOGGLE_STATUS');
        assert.equal(r.operation, 'UPDATE');
    });

    it('falls back to DELETE heuristic for suffix DELETE', () => {
        const r = deriveFromAction('MISSING.DELETE');
        assert.equal(r.operation, 'DELETE');
        assert.equal(r.severity, 'WARNING');
    });

    it('falls back to FINANCIAL heuristic for suffix PAYMENT', () => {
        const r = deriveFromAction('UNKNOWNSERVICE.PAYMENT');
        assert.equal(r.eventType, 'FINANCIAL');
    });

    it('returns WRITE/OTHER/INFO for unrecognised action', () => {
        const r = deriveFromAction('WHATEVER.NOTHING');
        assert.equal(r.eventType, 'WRITE');
        assert.equal(r.operation, 'OTHER');
        assert.equal(r.severity, 'INFO');
    });

    it('returns defaults for null/undefined input', () => {
        const r = deriveFromAction(null);
        assert.equal(r.operation, 'OTHER');
    });
});

describe('deriveOperation / deriveEventType / deriveSeverity', () => {
    it('deriveOperation extracts operation', () => {
        assert.equal(deriveOperation('LEAVE.APPROVE'), 'APPROVE');
    });
    it('deriveEventType extracts eventType', () => {
        assert.equal(deriveEventType('LEAVE.APPROVE'), 'WRITE');
    });
    it('deriveSeverity extracts severity', () => {
        assert.equal(deriveSeverity('LEAVE.APPROVE'), 'INFO');
    });
});
