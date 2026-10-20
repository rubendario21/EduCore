import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { downloadFile, getErrorMessage } from '@/lib/api-client';
import { formatDate, fullName } from '@/lib/format';
import {
  AUTHORIZER_ROLE_LABELS,
  CONSENT_METHOD_LABELS,
  type Consent,
  privacyService,
} from '../privacy.service';

function RevokeDialog({ consent, onClose }: { consent: Consent | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => privacyService.revoke(consent!.id, { reason: reason.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['data-consents'] });
      toast.success('Autorización revocada. El registro se conserva.');
      setReason('');
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  return (
    <FormDialog
      open={consent !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Revocar autorización"
      description="La revocación queda registrada con su fecha y motivo; la autorización no se borra."
      submitLabel="Revocar"
      danger
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (reason.trim().length < 5) return setError('Indica el motivo (al menos 5 caracteres).');
        setError(null);
        mutation.mutate();
      }}
    >
      <Field label="Motivo o solicitud del titular" required>
        {(c) => (
          <Textarea
            {...c}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

/** Autorizaciones con sus decisiones, soporte y revocación. */
export function ConsentList({
  consents,
  canManage,
  showStudent = false,
}: {
  consents: Consent[];
  canManage: boolean;
  showStudent?: boolean;
}) {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<Consent | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      privacyService.attachEvidence(id, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['data-consents'] });
      toast.success('Soporte adjuntado.');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <>
      <ul className="flex flex-col divide-y">
        {consents.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {c.status === 'ACTIVE' ? 'Vigente' : 'Revocada'}
              </Badge>
              {showStudent && <span className="font-medium">{fullName(c.student)}</span>}
              <span className="text-muted-foreground">
                Política {c.policy.version} · {formatDate(c.consentedOn)} ·{' '}
                {CONSENT_METHOD_LABELS[c.method]}
              </span>
            </div>
            <p>
              Autorizó: <span className="font-medium">{fullName(c.authorizer)}</span> (
              {AUTHORIZER_ROLE_LABELS[c.authorizerRole]})
            </p>
            <div className="flex flex-wrap gap-1">
              {c.decisions.map((d) => (
                <Badge key={d.purposeId} tone={d.granted ? 'success' : 'danger'}>
                  {d.granted ? 'Sí' : 'No'}: {d.name}
                </Badge>
              ))}
            </div>
            {c.revocation && (
              <p className="text-muted-foreground">
                Revocada el {formatDate(c.revocation.date)}: {c.revocation.reason}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {c.evidence ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void downloadFile(
                      `/data-consents/${c.id}/evidence`,
                      c.evidence!.fileName,
                    ).catch((e: unknown) => toast.error(getErrorMessage(e)))
                  }
                >
                  <Download aria-hidden /> Soporte
                </Button>
              ) : (
                canManage &&
                c.status === 'ACTIVE' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={upload.isPending}
                    onClick={() => {
                      setUploadFor(c.id);
                      fileInput.current?.click();
                    }}
                  >
                    <Paperclip aria-hidden /> Adjuntar soporte
                  </Button>
                )
              )}
              {canManage && c.status === 'ACTIVE' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setRevoking(c)}
                >
                  Revocar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && uploadFor) upload.mutate({ id: uploadFor, file });
        }}
      />
      <RevokeDialog consent={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}
