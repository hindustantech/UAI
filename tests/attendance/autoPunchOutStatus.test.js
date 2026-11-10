import test from "node:test";
import assert from "node:assert/strict";

import {
    resolveAutoPunchOutStatus,
    buildAutoPunchOutRemarks,
} from "../../controllers/attandance/autoPunchOutStatus.js";

// Local-time construction avoids timezone-dependent weekday shifts.
const SUNDAY = new Date(2026, 10, 8, 12, 0, 0); // 8 Nov 2026
const MONDAY = new Date(2026, 10, 9, 12, 0, 0); // 9 Nov 2026

test("employee weekly off marks weekly_off", () => {
    const status = resolveAutoPunchOutStatus(
        { weeklyOff: ["Sunday"] },
        { weeklyOff: [] },
        SUNDAY
    );

    assert.equal(status, "weekly_off");
});

test("falls back to shift weekly off when employee has none", () => {
    const status = resolveAutoPunchOutStatus(
        { weeklyOff: [] },
        { weeklyOff: ["Sunday"] },
        SUNDAY
    );

    assert.equal(status, "weekly_off");
});

test("employee weekly off wins over shift weekly off", () => {
    // Employee has a weekly off list, so the shift is not consulted.
    const status = resolveAutoPunchOutStatus(
        { weeklyOff: ["Monday"] },
        { weeklyOff: ["Sunday"] },
        SUNDAY
    );

    assert.equal(status, "absent");
});

test("working day is marked absent", () => {
    const status = resolveAutoPunchOutStatus(
        { weeklyOff: ["Sunday"] },
        { weeklyOff: ["Sunday"] },
        MONDAY
    );

    assert.equal(status, "absent");
});

test("missing employee and shift falls back to absent", () => {
    assert.equal(resolveAutoPunchOutStatus(null, null, SUNDAY), "absent");
});

test("missing date falls back to absent", () => {
    assert.equal(
        resolveAutoPunchOutStatus({ weeklyOff: ["Sunday"] }, null, null),
        "absent"
    );
});

test("remarks reflect the resolved status", () => {
    assert.match(
        buildAutoPunchOutRemarks("weekly_off", "System Auto Punch-Out"),
        /weekly_off/
    );
    assert.match(
        buildAutoPunchOutRemarks("absent", "System Auto Punch-Out"),
        /absent/
    );
});
