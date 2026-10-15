import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyButton } from "./BusyButton";
import React from "react";

test("busy button preserves label layout and blocks duplicate interaction", () => {
  const idle = renderToStaticMarkup(<BusyButton busy={false} busyLabel="Đang lưu">Lưu vào Ví</BusyButton>);
  const busy = renderToStaticMarkup(<BusyButton busy busyLabel="Đang lưu">Lưu vào Ví</BusyButton>);
  assert.match(idle, /stable-busy-content/);
  assert.match(busy, /stable-busy-content/);
  assert.match(busy, /Lưu vào Ví/);
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /aria-label="Đang lưu"/);
  assert.match(busy, /stable-busy-spinner/);
  assert.doesNotMatch(idle, /stable-busy-spinner/);
});
test("idle button retains disabled, type and accessible label", () => {
  const html = renderToStaticMarkup(<BusyButton busy={false} busyLabel="Chờ" disabled type="button" aria-label="Lưu">Lưu</BusyButton>);
  assert.match(html, /disabled=""/);
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Lưu"/);
});
test("motion is shared, touch-safe, bounded and reduced-motion aware", () => {
  const css = readFileSync(new URL("./interactions.css", import.meta.url), "utf8");
  assert.match(css, /180ms/);
  assert.match(css, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /transform: none !important/);
  assert.match(css, /:disabled/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /position: absolute; inset: 0/);
  for (const app of ["web", "wallet", "issuer-portal"]) {
    const entry = readFileSync(new URL(`../${app}/src/main.tsx`, import.meta.url), "utf8");
    assert.match(entry, /shared\/interactions.css/);
  }
});
