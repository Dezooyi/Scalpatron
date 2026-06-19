import * as React from "react";

interface SelectContextValue {
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext(): SelectContextValue {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select components must be used within <Select>");
  return ctx;
}

export interface SelectProps {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const ctx: SelectContextValue = { value, onChange: onValueChange, open, setOpen };
  return (
    <SelectContext.Provider value={ctx}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const ctx = useSelectContext();
  return (
    <button
      type="button"
      onClick={() => ctx.setOpen(!ctx.open)}
      className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  const ctx = useSelectContext();
  return <span>{ctx.value || placeholder}</span>;
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  const ctx = useSelectContext();
  if (!ctx.open) return null;
  return (
    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
      <div className="max-h-72 overflow-auto p-1">{children}</div>
    </div>
  );
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = useSelectContext();
  return (
    <div
      onClick={() => {
        ctx.onChange(value);
        ctx.setOpen(false);
      }}
      className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-3 pr-2 text-sm hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </div>
  );
}
