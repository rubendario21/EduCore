import { BrandMark } from '@/features/branding/brand-mark';
import { type ReactNode } from 'react';
import { productBrand } from '@/app/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { useBranding } from '@/features/branding/branding';

/** Marco de las pantallas públicas (login y recuperación): marca de la institución y del producto. */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { data: branding } = useBranding();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex justify-end p-4">
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 sm:items-center">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <BrandMark size="lg" />
            <div>
              <p className="text-lg font-semibold">{branding?.name ?? productBrand.name}</p>
              <p className="text-xs text-muted-foreground">
                {productBrand.name} · {productBrand.family}
              </p>
            </div>
          </div>
          <section className="rounded-lg border bg-surface p-6 shadow-xs">
            <h1 className="text-xl font-semibold">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            <div className="mt-5">{children}</div>
          </section>
          <p className="mt-6 text-center text-xs text-muted-foreground">{productBrand.tagline}</p>
        </div>
      </main>
    </div>
  );
}
