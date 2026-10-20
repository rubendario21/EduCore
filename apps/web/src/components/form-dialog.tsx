import { LoaderCircle } from 'lucide-react';
import { type FormEvent, type ReactNode, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';

/**
 * Diálogo con un formulario: título, campos, aviso de error y botones de
 * cancelar y confirmar. Lo usan las acciones de los módulos (matricular,
 * retirar, aprobar…), para que todas se comporten igual.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  error,
  onSubmit,
  children,
  danger,
  className,
  submitDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: () => void;
  children?: ReactNode;
  danger?: boolean;
  className?: string;
  submitDisabled?: boolean;
}) {
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className={className}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={id}
            variant={danger ? 'danger' : 'default'}
            disabled={pending || submitDisabled}
          >
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={id} noValidate className="flex flex-col gap-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        {children}
      </form>
    </Dialog>
  );
}

/** Lista de pares etiqueta–valor para fichas de detalle. */
export function DetailList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words font-medium">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
