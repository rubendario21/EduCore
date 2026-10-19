import { SystemStatusCard } from '../components/system-status-card';

export function SystemStatusPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Estado del sistema</h1>
        <p className="text-sm text-muted-foreground">
          Verificación técnica de la instalación de EduCore.
        </p>
      </div>
      <SystemStatusCard />
    </div>
  );
}
