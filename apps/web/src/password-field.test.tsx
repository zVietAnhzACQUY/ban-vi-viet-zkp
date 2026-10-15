import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PasswordField } from "./PasswordField";
test("password defaults to hidden and toggle is accessible, never submit", () => {
  const html = renderToStaticMarkup(<PasswordField label="Mật khẩu mới" name="newPassword" required minLength={10} maxLength={128} autoComplete="new-password" />);
  assert.match(html, /type="password"/);
  assert.match(html, /type="button"/);
  assert.match(html, /Hiển thị mật khẩu/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /minLength="10"/i);
  assert.match(html, /maxLength="128"/i);
  assert.match(html, /autoComplete="new-password"/i);
});
test("Caps Lock and cursor handling never capture or log password values", () => {
  const source = readFileSync(new URL("./PasswordField.tsx", import.meta.url), "utf8");
  assert.match(source, /getModifierState\("CapsLock"\)/);
  assert.match(source, /Caps Lock đang bật/);
  assert.match(source, /setSelectionRange/);
  assert.match(source, /setCapsLock\(false\)/);
  assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|\.value/);
});
test("all Website password forms use the common field", () => {
  const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  for (const label of ["Mật khẩu", "Mật khẩu hiện tại", "Mật khẩu mới", "Nhập lại mật khẩu mới"])
    assert.ok(source.includes(`<PasswordField label="${label}"`));
  assert.match(source, /values\.newPassword !== values\.confirmPassword/);
});
