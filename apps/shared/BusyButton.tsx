import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Keep the idle label in layout while a spinner replaces it visually. */
export function BusyButton({ busy, busyLabel, children, className = "", disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { busy: boolean; busyLabel: string; children: ReactNode }) {
  return <button {...props} disabled={disabled || busy} aria-busy={busy}
    aria-label={busy ? busyLabel : props["aria-label"]}
    className={className + " stable-busy-button"}>
    <span className="stable-busy-content" aria-hidden={busy || undefined}>{children}</span>
    {busy && <span className="stable-busy-spinner" aria-hidden="true" />}
  </button>;
}
