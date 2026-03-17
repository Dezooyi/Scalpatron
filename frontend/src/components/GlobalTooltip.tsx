import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipState {
  content: React.ReactNode;
  x: number;
  y: number;
  maxWidth?: number;
}

interface TooltipContextValue {
  show: (content: React.ReactNode, e: MouseEvent | React.MouseEvent, options?: { maxWidth?: number }) => void;
  hide: () => void;
  move: (e: MouseEvent | React.MouseEvent) => void;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

export function useTooltip() {
  const ctx = useContext(TooltipContext);
  if (!ctx) throw new Error("useTooltip must be used inside <TooltipProvider>");
  return ctx;
}

const OFFSET_X = 12;
const OFFSET_Y = 10;
const EXIT_DURATION = 200;
const ENTER_DURATION = 150;

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = useState<TooltipState>({ content: null, x: 0, y: 0, maxWidth: 400 });
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((content: React.ReactNode, e: MouseEvent | React.MouseEvent, options?: { maxWidth?: number }) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
    }
    // Small delay before showing to prevent flicker on quick mouse movements
    enterTimerRef.current = setTimeout(() => {
      setTip({ content, x: e.clientX, y: e.clientY, maxWidth: options?.maxWidth ?? 400 });
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    }, 50);
  }, []);

  const hide = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    setVisible(false);
    hideTimerRef.current = setTimeout(() => {
      setMounted(false);
    }, EXIT_DURATION);
  }, []);

  const move = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (visible) setTip((prev) => ({ ...prev, x: e.clientX, y: e.clientY }));
  }, [visible]);

  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!mounted || !tipRef.current) return;
    const el = tipRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    const w = rect.width || (tip.maxWidth ?? 400);
    const h = rect.height || 60;
    
    let left = tip.x + OFFSET_X;
    let top = tip.y + OFFSET_Y;
    
    // Flip horizontally if overflow on right
    if (left + w > vw - 8) {
      left = tip.x - w - OFFSET_X;
    }
    // Flip vertically if overflow on bottom
    if (top + h > vh - 8) {
      top = tip.y - h - OFFSET_Y;
    }
    
    setPos({ left, top });
  }, [tip.x, tip.y, mounted, tip.maxWidth]);

  return (
    <TooltipContext.Provider value={{ show, hide, move }}>
      {children}
      {mounted && createPortal(
        <div
          ref={tipRef}
          className="fixed z-[9999] pointer-events-none select-none"
          style={{
            top: pos.top,
            left: pos.left,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0) scale(1)" : "translateY(4px) scale(0.96)",
            transition: `opacity ${ENTER_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${ENTER_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            maxWidth: tip.maxWidth,
          }}
        >
          <div className="bg-zinc-900/98 backdrop-blur-sm border border-white/15 rounded-lg px-3.5 py-2.5 text-[12px] text-zinc-100 shadow-2xl shadow-black/50 whitespace-normal break-words leading-relaxed">
            {tip.content}
          </div>
        </div>,
        document.body
      )}
    </TooltipContext.Provider>
  );
}
