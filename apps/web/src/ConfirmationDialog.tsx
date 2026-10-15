import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
type Options = { title: string; description?: string; reason?: boolean };
const Context = createContext<(options: Options) => Promise<string | null>>(
  () => Promise.resolve(null),
);
export const useConfirmation = () => useContext(Context);
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const dialog = useRef<HTMLFormElement>(null);
  const content = useRef<HTMLDivElement>(null);
  function finish(value: string | null) {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }
  useEffect(() => {
    if (!options) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const background = content.current;
    if (background) background.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.querySelector<HTMLElement>("textarea, button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
      if (event.key === "Tab" && root) {
        const nodes = [
          ...root.querySelectorAll<HTMLElement>(
            "button:not(:disabled), textarea",
          ),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (!root.contains(document.activeElement)) {
          event.preventDefault(); first?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (background) background.inert = false;
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [options]);
  useEffect(
    () => () => {
      resolver.current?.(null);
    },
    [],
  );
  return (
    <Context.Provider
      value={(value) =>
        new Promise((resolve) => {
          resolver.current?.(null);
          resolver.current = resolve;
          setReason("");
          setOptions(value);
        })
      }
    >
      <div ref={content}>{children}</div>
      {options && (
        <div className="checkout-modal-backdrop">
          <form
            ref={dialog}
            className="checkout-modal confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            onSubmit={(event) => {
              event.preventDefault();
              finish(options.reason ? reason.trim() : "confirmed");
            }}
          >
            <span className="eyebrow">XÁC NHẬN THAO TÁC</span>
            <h2 id="confirmation-title">{options.title}</h2>
            {options.description && <p>{options.description}</p>}
            {options.reason && (
              <label>
                Lý do thu hồi
                <textarea
                  required
                  maxLength={300}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            )}
            <div className="checkout-modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => finish(null)}
              >
                Hủy
              </button>
              <button
                className="button danger-button"
                disabled={options.reason && !reason.trim()}
              >
                Xác nhận
              </button>
            </div>
          </form>
        </div>
      )}
    </Context.Provider>
  );
}
