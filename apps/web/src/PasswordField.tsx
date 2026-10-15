import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number | null; end: number | null } | null>(null);
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  useLayoutEffect(() => {
    if (!selection.current || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(selection.current.start, selection.current.end);
    selection.current = null;
  }, [visible]);
  return <div className="password-field-group">
    <label htmlFor={id}>{label}</label>
    <span className="password-control">
      <input {...props} id={id} ref={input} type={visible ? "text" : "password"}
        aria-describedby={[props["aria-describedby"], id + "-caps"].filter(Boolean).join(" ")}
        onKeyDown={event => { setCapsLock(event.getModifierState("CapsLock")); props.onKeyDown?.(event); }}
        onKeyUp={event => { setCapsLock(event.getModifierState("CapsLock")); props.onKeyUp?.(event); }}
        onBlur={event => { setCapsLock(false); props.onBlur?.(event); }} />
      <button type="button" className="icon" disabled={props.disabled}
        aria-label={visible ? "Ẩn mật khẩu" : "Hiển thị mật khẩu"} aria-controls={id} aria-pressed={visible}
        onPointerDown={event => event.preventDefault()}
        onClick={() => {
          selection.current = { start: input.current?.selectionStart ?? null, end: input.current?.selectionEnd ?? null };
          setVisible(value => !value);
        }}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </span>
    <small className="caps-lock-hint" id={id + "-caps"} role="status" aria-live="polite">{capsLock ? "Caps Lock đang bật" : ""}</small>
  </div>;
}
