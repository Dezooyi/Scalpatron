import { createContext, useContext, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function handleResolve(value: boolean) {
    pending?.resolve(value);
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
