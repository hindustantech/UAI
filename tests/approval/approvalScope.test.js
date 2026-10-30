import test from "node:test";
import assert from "node:assert/strict";

import {
    normalizeDepartment,
    isSameDepartment,
    isEligibleRole,
    resolveApprovalScope,
    isDepartmentInScope,
    evaluateApproval,
    canApproveRequest
} from "../../utils/approvalScope.js";

const makeScope = (overrides = {}) => ({
    eligible: true,
    companyId: "company-1",
    employee: { _id: "approver-employee" },
    department: "Sales",
    reason: null,
    ...overrides
});

const makeRequest = (overrides = {}) => ({
    companyId: "company-1",
    employeeId: "requester-employee",
    ...overrides
});

const makeRequester = (department = "Sales") => ({
    _id: "requester-employee",
    jobInfo: { department }
});

test("normalizeDepartment trims, collapses whitespace and lowercases", () => {
    assert.equal(normalizeDepartment("  Sales "), "sales");
    assert.equal(normalizeDepartment("SALES"), "sales");
    assert.equal(normalizeDepartment("Human   Resources"), "human resources");
    assert.equal(normalizeDepartment(null), "");
    assert.equal(normalizeDepartment(undefined), "");
    assert.equal(normalizeDepartment(0), "0");
});

test("isSameDepartment compares case-insensitively after trimming", () => {
    assert.equal(isSameDepartment("Sales", "sales"), true);
    assert.equal(isSameDepartment("  Sales  ", "SALES"), true);
    assert.equal(isSameDepartment("Human  Resources", "human resources"), true);
    assert.equal(isSameDepartment("Sales", "Marketing"), false);
});

test("isSameDepartment rejects empty or missing departments", () => {
    assert.equal(isSameDepartment("", ""), false);
    assert.equal(isSameDepartment("Sales", ""), false);
    assert.equal(isSameDepartment(null, null), false);
    assert.equal(isSameDepartment(undefined, "Sales"), false);
});

test("isEligibleRole only allows hr, manager and admin", () => {
    assert.equal(isEligibleRole("admin"), true);
    assert.equal(isEligibleRole("manager"), true);
    assert.equal(isEligibleRole("hr"), true);
    assert.equal(isEligibleRole("super_admin"), false);
    assert.equal(isEligibleRole("employee"), false);
    assert.equal(isEligibleRole("sales"), false);
    assert.equal(isEligibleRole(undefined), false);
});

test("evaluateApproval rejects ineligible scope", () => {
    const result = evaluateApproval(
        makeScope({ eligible: false, reason: "Forbidden: insufficient permissions" }),
        makeRequest(),
        makeRequester()
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /insufficient permissions/i);
});

test("evaluateApproval rejects a different company", () => {
    const result = evaluateApproval(
        makeScope({ companyId: "company-2" }),
        makeRequest(),
        makeRequester()
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /another company/i);
});

test("evaluateApproval rejects when approver has no employee record", () => {
    const result = evaluateApproval(
        makeScope({ employee: null }),
        makeRequest(),
        makeRequester()
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /approver employee record/i);
});

test("evaluateApproval rejects self approval", () => {
    const result = evaluateApproval(
        makeScope({ employee: { _id: "requester-employee" } }),
        makeRequest({ employeeId: "requester-employee" }),
        makeRequester()
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /own leave request/i);
});

test("evaluateApproval rejects a missing requester employee", () => {
    const result = evaluateApproval(makeScope(), makeRequest(), null);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Requester employee record not found/i);
});

test("evaluateApproval rejects a missing requester id", () => {
    const result = evaluateApproval(
        makeScope(),
        makeRequest({ employeeId: null }),
        null
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Requester employee record not found/i);
});

test("evaluateApproval rejects a different department", () => {
    const result = evaluateApproval(
        makeScope({ department: "Sales" }),
        makeRequest(),
        makeRequester("Marketing")
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /own department/i);
});

test("evaluateApproval allows the same department with different casing/space", () => {
    const result = evaluateApproval(
        makeScope({ department: " sales " }),
        makeRequest(),
        makeRequester("SALES")
    );
    assert.equal(result.allowed, true);
    assert.equal(result.reason, null);
});

test("evaluateApproval rejects empty departments", () => {
    const result = evaluateApproval(
        makeScope({ department: "" }),
        makeRequest(),
        makeRequester("")
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /own department/i);
});

test("evaluateApproval supports populated requester employee ids", () => {
    const result = evaluateApproval(
        makeScope(),
        makeRequest({ employeeId: { _id: "requester-employee" } }),
        makeRequester("Sales")
    );
    assert.equal(result.allowed, true);
});

test("evaluateApproval compares ObjectId-like company ids by string value", () => {
    const result = evaluateApproval(
        makeScope({ companyId: { toString: () => "company-1" } }),
        makeRequest({ companyId: { toString: () => "company-1" } }),
        makeRequester()
    );
    assert.equal(result.allowed, true);
});

test("canApproveRequest returns allowed when requester is supplied", async () => {
    const result = await canApproveRequest(
        makeScope(),
        makeRequest(),
        { requester: makeRequester("Sales") }
    );
    assert.equal(result.allowed, true);
});

test("canApproveRequest returns denied for a department mismatch", async () => {
    const result = await canApproveRequest(
        makeScope(),
        makeRequest(),
        { requester: makeRequester("Marketing") }
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /own department/i);
});

test("canApproveRequest returns denied for an ineligible approver", async () => {
    const result = await canApproveRequest(
        makeScope({ eligible: false, reason: "Forbidden: insufficient permissions" }),
        makeRequest(),
        { requester: makeRequester("Sales") }
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /insufficient permissions/i);
});

test("canApproveRequest returns denied for self approval", async () => {
    const result = await canApproveRequest(
        makeScope({ employee: { _id: "requester-employee" } }),
        makeRequest({ employeeId: "requester-employee" }),
        { requester: makeRequester("Sales") }
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /own leave request/i);
});

test("resolveApprovalScope defaults to own department", () => {
    assert.deepEqual(resolveApprovalScope(undefined), {
        type: "department",
        departments: []
    });
    assert.deepEqual(resolveApprovalScope({ type: "department" }), {
        type: "department",
        departments: []
    });
    assert.deepEqual(resolveApprovalScope({ type: "unknown" }), {
        type: "department",
        departments: []
    });
});

test("resolveApprovalScope normalizes selected departments", () => {
    assert.deepEqual(
        resolveApprovalScope({
            type: "departments",
            departments: ["  Sales ", "sales", "Human   Resources"]
        }),
        {
            type: "departments",
            departments: ["Sales", "Human Resources"]
        }
    );
});

test("resolveApprovalScope falls back when departments are empty", () => {
    assert.deepEqual(
        resolveApprovalScope({ type: "departments", departments: [] }),
        { type: "department", departments: [] }
    );
    assert.deepEqual(
        resolveApprovalScope({ type: "departments", departments: ["  "] }),
        { type: "department", departments: [] }
    );
});

test("resolveApprovalScope keeps company-wide scope", () => {
    assert.deepEqual(
        resolveApprovalScope({ type: "company", departments: ["Sales"] }),
        { type: "company", departments: [] }
    );
    assert.deepEqual(resolveApprovalScope("company"), {
        type: "company",
        departments: []
    });
});

test("isDepartmentInScope allows any department for company scope", () => {
    assert.equal(
        isDepartmentInScope({ type: "company" }, "Sales", "Marketing"),
        true
    );
});

test("isDepartmentInScope matches selected departments case-insensitively", () => {
    const scope = { type: "departments", departments: ["Sales", "Human Resources"] };
    assert.equal(isDepartmentInScope(scope, "Finance", " sales "), true);
    assert.equal(isDepartmentInScope(scope, "Finance", "human   resources"), true);
    assert.equal(isDepartmentInScope(scope, "Finance", "Marketing"), false);
    assert.equal(isDepartmentInScope(scope, "Finance", ""), false);
});

test("isDepartmentInScope uses own department by default", () => {
    assert.equal(isDepartmentInScope(undefined, "Sales", "sales"), true);
    assert.equal(isDepartmentInScope(undefined, "Sales", "Marketing"), false);
});

test("evaluateApproval allows another department with company scope", () => {
    const result = evaluateApproval(
        makeScope({ approvalScope: { type: "company", departments: [] } }),
        makeRequest(),
        makeRequester("Marketing")
    );
    assert.equal(result.allowed, true);
    assert.equal(result.reason, null);
});

test("evaluateApproval allows a department listed in the assignment", () => {
    const result = evaluateApproval(
        makeScope({
            department: "Finance",
            approvalScope: { type: "departments", departments: ["Sales", "HR"] }
        }),
        makeRequest(),
        makeRequester("SALES")
    );
    assert.equal(result.allowed, true);
});

test("evaluateApproval rejects a department outside the assignment", () => {
    const result = evaluateApproval(
        makeScope({
            department: "Sales",
            approvalScope: { type: "departments", departments: ["HR"] }
        }),
        makeRequest(),
        makeRequester("Marketing")
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /departments assigned to you/i);
});

test("evaluateApproval allows global approvers without an employee record", () => {
    const result = evaluateApproval(
        makeScope({ isGlobal: true, employee: null }),
        makeRequest({ companyId: "another-company" }),
        null
    );
    assert.equal(result.allowed, true);
    assert.equal(result.reason, null);
});

test("canApproveRequest allows a global partner approver", async () => {
    const result = await canApproveRequest(
        makeScope({ isGlobal: true, employee: null }),
        makeRequest(),
        { requester: makeRequester("Marketing") }
    );
    assert.equal(result.allowed, true);
});

test("evaluateApproval still rejects self approval under company scope", () => {
    const result = evaluateApproval(
        makeScope({
            employee: { _id: "requester-employee" },
            approvalScope: { type: "company", departments: [] }
        }),
        makeRequest({ employeeId: "requester-employee" }),
        makeRequester("Sales")
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason, /own leave request/i);
});
