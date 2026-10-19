import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface Branding {
  name: string;
  legalName: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
}

export const brandingQueryKey = ['institution', 'branding'] as const;

/** Marca pública de la institución (disponible antes de iniciar sesión). */
export function useBranding() {
  return useQuery({
    queryKey: brandingQueryKey,
    queryFn: ({ signal }) =>
      apiClient.get<Branding>('/institution/branding', { signal, anonymous: true }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Luminancia relativa WCAG de un color #RRGGBB. */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texto legible sobre un fondo: blanco sobre colores oscuros, casi negro sobre claros. */
export function readableTextOn(hex: string): string {
  const luminance = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithDark = (luminance + 0.05) / (0.0156 + 0.05);
  return contrastWithWhite >= contrastWithDark ? '#ffffff' : '#101828';
}
