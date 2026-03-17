import { createContext, useContext, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
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

  const variantIcon: Record<string, string> = {
    danger:  "text-red-400",
    warning: "text-yellow-400",
    info:    "text-blue-400",
  };
  const variantBorder: Record<string, string> = {
    danger:  "border-red-500/30",
    warning: "border-yellow-500/30",
    info:    "border-blue-500/30",
  };

  const v = pending?.variant ?? "danger";

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

          {/* Dialog */}
          <div className={`relative z-10 w-full max-w-sm mx-4 bg-zinc-900 border ${variantBorder[v]} rounded-xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${variantIcon[v]}`} />
              <div className="space-y-1 min-w-0">
                {pending.title && (
                  <p className="font-semibold text-sm text-zinc-100">{pending.title}</p>
                )}
                <p className="text-sm text-zinc-400 leading-relaxed">{pending.message}</p>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
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
