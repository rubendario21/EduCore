import { useEffect } from 'react';
import { productBrand } from '@/app/brand';
import { readableTextOn, useBranding } from './branding';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Aplica los colores de la institución al tema claro mediante variables CSS.
 * El tema oscuro conserva su paleta para garantizar el contraste.
 */
export function BrandingStyles() {
  const { data } = useBranding();

  useEffect(() => {
    const root = document.documentElement.style;
    const apply = (name: 'primary' | 'accent', color: string | null | undefined) => {
      if (color && HEX.test(color)) {
        root.setProperty(`--brand-${name}`, color);
        root.setProperty(`--brand-${name}-foreground`, readableTextOn(color));
      } else {
        root.removeProperty(`--brand-${name}`);
        root.removeProperty(`--brand-${name}-foreground`);
      }
    };
    apply('primary', data?.primaryColor);
    apply('accent', data?.accentColor);
    document.title = data ? `${data.name} · ${productBrand.name}` : productBrand.name;
  }, [data]);

  return null;
}
