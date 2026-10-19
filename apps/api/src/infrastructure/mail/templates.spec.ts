import { describe, expect, it } from 'vitest';
import { escapeHtml, passwordResetEmail } from './templates';

describe('Plantillas de correo', () => {
  it('escapa el HTML de los datos variables', () => {
    expect(escapeHtml('<script>alert("x")</script> & \'y\'')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
  });

  it('genera el correo de recuperación con texto y HTML seguros', () => {
    const mail = passwordResetEmail({
      to: 'ana@colegio.edu.co',
      name: 'Ana <b>María</b>',
      institutionName: 'Colegio "Ejemplo"',
      url: 'http://127.0.0.1:5173/restablecer-contrasena?token=abc',
      expiresInMinutes: 30,
    });
    expect(mail.subject).toBe('Restablece tu contraseña de EduCore');
    expect(mail.text).toContain('http://127.0.0.1:5173/restablecer-contrasena?token=abc');
    expect(mail.text).toContain('30 minutos');
    expect(mail.html).toContain('Ana &lt;b&gt;María&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>María</b>');
    expect(mail.html).toContain('Colegio &quot;Ejemplo&quot;');
  });
});
