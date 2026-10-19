import { describe, expect, it } from 'vitest';
import { diffChanges } from './audit.service';

describe('diffChanges', () => {
  it('registra solo los campos que cambiaron', () => {
    const before = { name: 'Sede Norte', city: 'Bogotá', phone: '601' };
    const after = { name: 'Sede Principal', city: 'Bogotá', phone: '601' };
    expect(diffChanges(before, after, ['name', 'city', 'phone'])).toEqual({
      name: { from: 'Sede Norte', to: 'Sede Principal' },
    });
  });

  it('nunca incluye campos sensibles', () => {
    const before = { email: 'a@b.co', passwordHash: 'hash-viejo' };
    const after = { email: 'c@d.co', passwordHash: 'hash-nuevo' };
    const changes = diffChanges(before, after, ['email', 'passwordHash']);
    expect(changes).toEqual({ email: { from: 'a@b.co', to: 'c@d.co' } });
    expect(JSON.stringify(changes)).not.toContain('hash');
  });

  it('representa creación y fechas de forma serializable', () => {
    const date = new Date('2026-02-01T00:00:00.000Z');
    expect(diffChanges(null, { startsOn: date }, ['startsOn'])).toEqual({
      startsOn: { from: null, to: '2026-02-01T00:00:00.000Z' },
    });
  });
});
