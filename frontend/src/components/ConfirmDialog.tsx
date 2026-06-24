import { createContext, useContext, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConfirmToggle {
  label: string;
  defaultChecked?: boolean;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  toggle?: ConfirmToggle;
}

export interface ConfirmResult {
  confirmed: boolean;
  toggleValue?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: ConfirmResult) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [toggleOn, setToggleOn] = useState<boolean>(false);

  const confirm = useCallback((options: ConfirmOptions): Promise<ConfirmResult> => {
    return new Promise((resolve) => {
      setToggleOn(options.toggle?.defaultChecked ?? false);
      setPending({ ...options, resolve });
    });
  }, []);

  function handleResolve(value: boolean) {
    if (!pending) return;
    pending.resolve({ confirmed: value, toggleValue: pending.toggle ? toggleOn : undefined });
    setPending(null);
  }

  const variantStyles = {
    danger:  { icon: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/30",    IconComp: ShieldAlert },
    warning: { icon: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", IconComp: AlertTriangle },
    info:    { icon: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/30",   IconComp: Info },
  };

  const v = pending?.variant ?? "danger";
  const { icon, bg, border, IconComp } = variantStyles[v];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => handleResolve(false)}
          />

          {/* Dialog card — Master Template */}
          <div className={`relative z-10 w-full max-w-sm mx-4
            bg-black/85 backdrop-blur-2xl border ${border}
            rounded-xl shadow-2xl p-6 space-y-4
            animate-in fade-in zoom-in-95 duration-200`}
          >
            {/* Top gradient line */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent rounded-t-xl pointer-events-none" />
            {/* Top glow */}
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none rounded-t-xl" />

            {/* Header */}
            <div className="flex items-start gap-3 relative">
              <div className={`p-1.5 ${bg} rounded-lg border ${border} shrink-0`}>
                <IconComp className={`h-4 w-4 ${icon}`} />
              </div>
              <div className="space-y-1 min-w-0">
                {pending.title && (
                  <p className="font-bold text-sm text-zinc-100">{pending.title}</p>
                )}
                <p className="text-sm text-zinc-400 leading-relaxed">{pending.message}</p>
              </div>
            </div>

            {/* Optional inline toggle */}
            {pending.toggle && (
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 cursor-pointer select-none hover:bg-white/[0.05] transition-colors">
                <span className="text-sm text-zinc-200">{pending.toggle.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={toggleOn}
                  onClick={(e) => { e.preventDefault(); setToggleOn(v => !v); }}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors duration-150
                    ${toggleOn ? "bg-primary/80 border-primary" : "bg-zinc-700 border-zinc-600"}`}
                >
                  <span
                    className={`pointer-events-none absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150
                      ${toggleOn ? "translate-x-4" : "translate-x-0"}`}
                  />
                </button>
              </label>
            )}

            {/* Footer */}
            <div className="flex gap-2 justify-end pt-1 border-t border-white/5">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-zinc-200"
                onClick={() => handleResolve(false)}
              >
                {pending.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={v === "danger" ? "destructive" : "default"}
                size="sm"
                onClick={() => handleResolve(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </ConfirmContext.Provider>
  );
}
