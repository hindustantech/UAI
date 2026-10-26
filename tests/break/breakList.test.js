import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeBreakState, sortBreakList } from '../../services/breakList.service.js';

const employee = {
    _id: 'emp-1',
    userId: { _id: 'user-1', name: 'Alice', profileImage: 'alice.png' },
    user_name: 'Alice',
    empCode: 'EMP001',
    employeeType: 'non_sales',
    jobInfo: { department: 'Engineering', designation: 'Developer' },
    shift: { shiftName: 'General Shift' }
};

const now = new Date('2026-10-26T10:00:00.000Z');

describe('buildEmployeeBreakState()', () => {
    it('marks an employee with an active break as on_break', () => {
        const attendance = {
            punchIn: new Date('2026-10-26T09:00:00.000Z'),
            status: 'present',
            breaks: [
                {
                    type: 'lunch',
                    breakName: 'Lunch Break',
                    status: 'active',
                    startTime: new Date('2026-10-26T09:45:00.000Z'),
                    allowedMinutes: 30,
                    isPaid: false
                }
            ]
        };

        const result = buildEmployeeBreakState(employee, attendance, now);

        assert.equal(result.breakStatus, 'on_break');
        assert.equal(result.onBreak, true);
        assert.equal(result.hasBreak, true);
        assert.equal(result.activeBreak.elapsedMinutes, 15);
        assert.equal(result.activeBreak.allowedMinutes, 30);
        assert.equal(result.activeBreak.breakName, 'Lunch Break');
    });

    it('marks completed breaks as break_taken and totals durations', () => {
        const attendance = {
            punchIn: new Date('2026-10-26T09:00:00.000Z'),
            status: 'present',
            breaks: [
                {
                    type: 'lunch',
                    breakName: 'Lunch Break',
                    status: 'completed',
                    startTime: new Date('2026-10-26T09:10:00.000Z'),
                    durationMinutes: 25,
                    exceededMinutes: 0
                },
                {
                    type: 'tea',
                    breakName: 'Tea Break',
                    status: 'completed',
                    startTime: new Date('2026-10-26T09:30:00.000Z'),
                    durationMinutes: 15,
                    exceededMinutes: 5
                }
            ]
        };

        const result = buildEmployeeBreakState(employee, attendance, now);

        assert.equal(result.breakStatus, 'break_taken');
        assert.equal(result.onBreak, false);
        assert.equal(result.completedBreaks, 2);
        assert.equal(result.totalBreakMinutes, 40);
        assert.equal(result.totalBreakExceededMinutes, 5);
        assert.equal(result.activeBreak, null);
    });

    it('marks punched-in employees without breaks as no_break', () => {
        const attendance = {
            punchIn: new Date('2026-10-26T09:00:00.000Z'),
            status: 'present',
            breaks: []
        };

        const result = buildEmployeeBreakState(employee, attendance, now);

        assert.equal(result.breakStatus, 'no_break');
        assert.equal(result.hasBreak, false);
        assert.equal(result.totalBreakMinutes, 0);
    });

    it('marks employees without attendance as not_checked_in', () => {
        const result = buildEmployeeBreakState(employee, null, now);

        assert.equal(result.breakStatus, 'not_checked_in');
        assert.equal(result.hasBreak, false);
        assert.equal(result.attendanceStatus, null);
    });

    it('falls back to populated user name and safe defaults', () => {
        const result = buildEmployeeBreakState(
            { _id: 'emp-2', userId: { name: 'Bob' } },
            null,
            now
        );

        assert.equal(result.employeeName, 'Bob');
        assert.equal(result.empCode, 'N/A');
        assert.equal(result.department, 'N/A');
        assert.equal(result.shiftName, null);
    });
});

describe('sortBreakList()', () => {
    it('orders on_break first, then break_taken, no_break and not_checked_in', () => {
        const list = [
            { employeeName: 'Zara', breakStatus: 'not_checked_in' },
            { employeeName: 'Bob', breakStatus: 'no_break' },
            { employeeName: 'Alice', breakStatus: 'break_taken' },
            { employeeName: 'Yash', breakStatus: 'on_break' }
        ];

        const sorted = sortBreakList(list).map(item => item.employeeName);

        assert.deepEqual(sorted, ['Yash', 'Alice', 'Bob', 'Zara']);
    });

    it('sorts alphabetically within the same status', () => {
        const list = [
            { employeeName: 'Charlie', breakStatus: 'break_taken' },
            { employeeName: 'Alice', breakStatus: 'break_taken' },
            { employeeName: 'Bob', breakStatus: 'break_taken' }
        ];

        const sorted = sortBreakList(list).map(item => item.employeeName);

        assert.deepEqual(sorted, ['Alice', 'Bob', 'Charlie']);
    });

    it('does not mutate the input list', () => {
        const list = [
            { employeeName: 'Zara', breakStatus: 'no_break' },
            { employeeName: 'Yash', breakStatus: 'on_break' }
        ];

        sortBreakList(list);

        assert.equal(list[0].employeeName, 'Zara');
    });
});
