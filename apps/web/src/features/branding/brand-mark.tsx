import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBranding } from './branding';

/** Logo de la institución o, si no hay (o no carga), el símbolo de EduCore. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { data } = useBranding();
  const [failed, setFailed] = useState<string | null>(null);
  const box = size === 'lg' ? 'size-12 rounded-xl' : 'size-8 rounded-md';

  if (data?.logoUrl && failed !== data.logoUrl) {
    return (
      <img
        src={data.logoUrl}
        alt={`Logo de ${data.name}`}
        className={cn(box, 'shrink-0 bg-surface object-contain')}
        onError={() => setFailed(data.logoUrl)}
      />
    );
  }
  return (
    <span
      className={cn(box, 'grid shrink-0 place-items-center bg-primary text-primary-foreground')}
    >
      <GraduationCap className={size === 'lg' ? 'size-7' : 'size-5'} aria-hidden />
    </span>
  );
}
