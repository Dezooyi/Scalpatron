import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ icon: Icon, title, description, className = "" }: PageHeaderProps) {
  return (
    <div className={`flex items-center gap-3 mb-6 ${className}`}>
      <Icon className="h-8 w-8 text-primary" />
      <div>
        <h1 className="text-3xl font-bold tracking-tighter">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1">{description}</p>
        )}
      </div>
    </div>
  );
}
