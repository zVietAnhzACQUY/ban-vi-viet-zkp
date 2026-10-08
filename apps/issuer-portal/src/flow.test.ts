import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canAccessOperator,
  canReceiveCredential,
  loginDestination,
  receivePath,
  safePortalPath,
  websiteDetailUrl,
} from "./flow";

const requestId = "11111111-1111-4111-8111-111111111111";

test("Portal paths are fixed and reject open redirects", () => {
  assert.equal(receivePath(requestId), `/receive-age/${requestId}`);
  assert.equal(
    websiteDetailUrl("http://127.0.0.1:5173", requestId),
    `http://127.0.0.1:5173/account/age-verification/${requestId}`,
  );
  assert.equal(safePortalPath("https://evil.invalid"), null);
  assert.equal(safePortalPath("//evil.invalid"), null);
  assert.equal(safePortalPath(`/receive-age/${requestId}`), `/receive-age/${requestId}`);
});

test("ISSUER_OPERATOR enters operator; ADMIN and CUSTOMER are blocked", () => {
  assert.equal(loginDestination("ISSUER_OPERATOR", null), "/operator");
  assert.equal(loginDestination("ISSUER_OPERATOR", "/operator"), "/operator");
  assert.equal(loginDestination("ADMIN", "/operator"), "/");
  assert.equal(loginDestination("CUSTOMER", "/operator"), "/");
  assert.equal(
    loginDestination("CUSTOMER", `/receive-age/${requestId}`),
    `/receive-age/${requestId}`,
  );
  assert.equal(canAccessOperator("ISSUER_OPERATOR"), true);
  assert.equal(canAccessOperator("ADMIN"), false);
  assert.equal(canAccessOperator("CUSTOMER"), false);
});

test("Portal receives only ISSUED requests and owns the Delivery call", () => {
  assert.equal(canReceiveCredential("PENDING"), false);
  assert.equal(canReceiveCredential("ISSUED"), true);
  const portal =
    readFileSync(new URL("./App.tsx", import.meta.url), "utf8") +
    readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.match(portal, /path="\/login"/);
  assert.match(portal, /path="\/operator"/);
  assert.match(portal, /path="\/receive-age\/:id"/);
  assert.match(portal, /path="\/verify-age\/:id"/);
  assert.match(portal, /\/issuer\/age\/claims/);
  assert.equal(portal.includes('"/me/age-credential-requests", "POST"'), false);
  assert.equal(portal.includes('window.prompt("Ngày sinh'), false);
  assert.equal(portal.includes('name="dob"'), false);
});

test("commerce Website has no Delivery claim or credential transport", () => {
  const website =
    readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8") +
    readFileSync(new URL("../../web/src/api.ts", import.meta.url), "utf8");
  assert.equal(website.includes("/issuer/age/claims"), false);
  assert.equal(website.includes("claimUrl"), false);
  assert.equal(website.includes("recordChecked"), false);
});

test("Portal operator uses dedicated issuer auth and internal navigation", () => {
  const portal = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const transport = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.match(portal, /\/issuer\/auth\/login/);
  assert.match(portal, /\/issuer\/auth\/logout/);
  assert.match(portal, /\/issuer\/auth\/me/);
  assert.match(transport, /\/issuer\/auth\/csrf/);
  assert.match(portal, /navigate\("\/login", \{ replace: true \}\)/);
  assert.match(portal, /disabled=\{loading\}/);
  assert.match(portal, /Đăng nhập dành cho nhân viên vận hành/);
  assert.match(portal, /Xử lý yêu cầu xác minh/);
  assert.match(portal, /Tài khoản không có quyền vận hành Credential Issuer/);
  assert.match(transport, /credentials: "include"/);
});

test("Portal UI has no internal disclaimers or browser prompts", () => {
  const portal = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  for (const text of ["mô phỏng", "pilot", "demo", "VNeID", "KYC", "window.prompt", "alert("])
    assert.equal(portal.includes(text), false);
  assert.match(portal, /user\?\.role !== "CUSTOMER"/);
  assert.match(portal, /role="dialog"/);
  assert.match(portal, /recordChecked: true/);
});
