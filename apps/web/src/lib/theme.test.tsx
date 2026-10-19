import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/theme-toggle';
import { ThemeProvider } from './theme';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeProvider', () => {
  it('usa el tema claro por defecto', () => {
    renderToggle();
    expect(document.documentElement).not.toHaveClass('dark');
    expect(screen.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeInTheDocument();
  });

  it('cambia al tema oscuro con el teclado y recuerda la preferencia', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.tab();
    await user.keyboard('{Enter}');

    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('educore.theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Cambiar a tema claro' })).toHaveFocus();
  });

  it('restaura la preferencia guardada', () => {
    window.localStorage.setItem('educore.theme', 'dark');
    renderToggle();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('funciona aunque el almacenamiento local no esté disponible', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('button', { name: 'Cambiar a tema oscuro' }));
    expect(document.documentElement).toHaveClass('dark');
  });
});
