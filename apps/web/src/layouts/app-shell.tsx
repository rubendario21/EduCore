import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { productBrand } from '@/app/brand';
import { visibleNavigation } from '@/app/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-context';
import { useProfile } from '@/features/auth/profile-context';
import { landingOf, type Profile, PROFILE_INFO } from '@/features/auth/profiles';
import { BrandMark } from '@/features/branding/brand-mark';
import { cn } from '@/lib/utils';

function initials(firstNames: string, lastNames: string): string {
  return `${firstNames.charAt(0)}${lastNames.charAt(0)}`.toUpperCase();
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Menú de usuario">
          <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(user.firstNames, user.lastNames)}
          </span>
          <span className="hidden max-w-40 truncate text-left md:block">
            <span className="block truncate text-sm font-medium">{user.firstNames}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {user.roles.map((r) => r.name).join(', ')}
            </span>
          </span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-md border bg-surface p-1 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">
              {user.firstNames} {user.lastNames}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => navigate('/perfil')}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-highlighted:bg-surface-muted"
          >
            <UserRound className="size-4" aria-hidden /> Mi perfil
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void logout()}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-danger outline-none data-highlighted:bg-danger/10"
          >
            <LogOut className="size-4" aria-hidden /> Cerrar sesión
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Cambiar de perfil (p. ej. de Docente a Acudiente) sin volver a iniciar sesión. */
function ProfileSwitcher() {
  const { profiles, profile, setProfile } = useProfile();
  const navigate = useNavigate();
  if (profiles.length < 2 || !profile) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-muted-foreground sm:inline">Ingresando como</span>
      <Select
        aria-label="Perfil"
        className="h-8 w-auto"
        value={profile}
        onChange={(e) => {
          const next = e.target.value as Profile;
          setProfile(next);
          navigate(landingOf(next));
        }}
      >
        {profiles.map((p) => (
          <option key={p} value={p}>
            {PROFILE_INFO[p].label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, can } = useAuth();
  const { profile } = useProfile();
  const sections = visibleNavigation(can, profile);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Navegación principal"
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-semibold">{user?.institution.name ?? productBrand.name}</p>
            <p className="text-xs text-muted-foreground">
              {productBrand.name} · {productBrand.family}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          >
            <X aria-hidden />
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="size-4" aria-hidden />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <Link to="/perfil" className="hover:text-foreground">
            {productBrand.tagline}
          </Link>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-surface/90 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu aria-hidden />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <ProfileSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main id="contenido" className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
