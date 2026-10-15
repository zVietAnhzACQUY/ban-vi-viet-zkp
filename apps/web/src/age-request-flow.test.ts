import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ageDetailPath,
  ageStatusCopy,
  issuerReceiveUrl,
  startAgePolling,
  terminalAgeStatus,
} from "./age-request-flow";

test("AGE customer status copy and fixed routes", () => {
  assert.equal(ageStatusCopy.PENDING, "Issuer đang chờ đối chiếu hồ sơ");
  assert.equal(
    ageStatusCopy.APPROVED,
    "Yêu cầu đã được phê duyệt và đang chờ phát hành",
  );
  assert.equal(ageStatusCopy.ISSUING, "Issuer đang phát hành thông tin xác minh");
  assert.equal(ageDetailPath("abc"), "/account/age-verification/abc");
  assert.equal(
    issuerReceiveUrl("http://127.0.0.1:5175", "abc"),
    "http://127.0.0.1:5175/receive-age/abc",
  );
  assert.equal(terminalAgeStatus("PENDING"), false);
  assert.equal(terminalAgeStatus("ISSUED"), true);
});

test("AGE polling cleanup cancels its timer", () => {
  let stopped = 0;
  const stop = startAgePolling(
    () => {},
    7000,
    () => 42 as unknown as ReturnType<typeof setInterval>,
    (timer) => {
      stopped = Number(timer);
    },
  );
  stop();
  assert.equal(stopped, 42);
});

test("Website has minimal status flow and no credential claim transport", () => {
  const website =
    readFileSync(new URL("./App.tsx", import.meta.url), "utf8") +
    readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.match(website, /\/account\/age-verification\/:id/);
  assert.match(website, /Tiếp tục nhận tại Issuer/);
  assert.match(website, /walletReceived/);
  assert.match(website, /Đã nhận vào Ví/);
  assert.match(website, /window\.addEventListener\("focus", refetch\)/);
  assert.match(website, /document\.addEventListener\("visibilitychange", refetch\)/);
  assert.equal(website.includes("/issuer/age/claims"), false);
  assert.equal(website.includes("claimUrl"), false);
  for (const field of ["dob", "salt", "holderSecret", "privateKey"])
    assert.equal(website.includes(field), false);
  assert.equal(website.includes(".witness"), false);
  assert.equal(website.includes('"witness":'), false);
});
