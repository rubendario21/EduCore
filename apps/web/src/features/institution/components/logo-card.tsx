import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, LoaderCircle, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { brandingQueryKey } from '@/features/branding/branding';
import { getErrorMessage } from '@/lib/api-client';
import { type Institution, institutionService } from '../institution.service';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

/** Carga del logo. La web hace una revisión rápida; la API verifica el contenido real. */
export function LogoCard({
  institution,
  editable,
}: {
  institution: Institution;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const logoUrl = institution.settings.logoUrl;

  const onSuccess = async (updated: Institution, message: string) => {
    queryClient.setQueryData(['institution'], updated);
    await queryClient.invalidateQueries({ queryKey: brandingQueryKey });
    toast.success(message);
  };

  const upload = useMutation({
    mutationFn: institutionService.uploadLogo,
    onSuccess: (updated) => onSuccess(updated, 'Logo actualizado.'),
    onError: (e) => setError(getErrorMessage(e)),
    onSettled: () => {
      if (input.current) input.current.value = '';
    },
  });
  const remove = useMutation({
    mutationFn: institutionService.removeLogo,
    onSuccess: (updated) => onSuccess(updated, 'Logo quitado.'),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const onFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError('Usa una imagen PNG, JPEG o WebP.');
    if (file.size > MAX_BYTES) return setError('La imagen no puede superar 2 MB.');
    upload.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          PNG, JPEG o WebP de hasta 2 MB. Se muestra en el inicio de sesión y en el menú.
          Preferiblemente cuadrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border bg-surface-muted">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo actual de la institución"
                className="size-full object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">Sin logo</span>
            )}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept={ACCEPTED.join(',')}
                className="sr-only"
                id="logo-input"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={upload.isPending}
                onClick={() => input.current?.click()}
              >
                {upload.isPending ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <ImageUp aria-hidden />
                )}
                {logoUrl ? 'Cambiar logo' : 'Subir logo'}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  <Trash2 aria-hidden /> Quitar
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
