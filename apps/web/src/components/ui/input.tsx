import { type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const controlClasses =
  'w-full min-w-0 rounded-md border bg-surface text-sm shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/30';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(controlClasses, 'h-9 px-3 placeholder:text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Selector nativo: accesible y usable en móviles sin JavaScript adicional. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(controlClasses, 'h-9 px-2', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 rounded border accent-[var(--color-primary)]', className)}
      {...props}
    />
  );
}
