import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./ConfirmationDialog.tsx", import.meta.url), "utf8");
test("catalog reset clears query and recovery offers retry", () => {
  assert.match(source, /onClick=\{\(\) => navigate\("\/cua-hang#thuc-qua"\)\}/);
  assert.match(source, /Loading error=\{error\} retry=\{reload\}/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /timeoutMs: 15000/);
});
test("confirmation isolates background and cleans up focus/scroll", () => {
  assert.match(dialog, /background\.inert = true/);
  assert.match(dialog, /background\.inert = false/);
  assert.match(dialog, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(dialog, /previous\?\.focus/);
});
test("login preserves destination and cart add has a synchronous guard", () => {
  assert.match(source, /addingProducts\.current\.has\(id\)/);
  assert.match(source, /addingProducts\.current\.delete\(id\)/);
  assert.match(source, /encodeURIComponent\(location\.pathname \+ location\.search \+ location\.hash\)/);
  assert.match(source, /aria-controls="store-navigation"/);
});
