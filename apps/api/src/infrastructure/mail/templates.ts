import { type MailMessage } from './mail.service';

/** Escapa texto para insertarlo en HTML (nombres de personas e instituciones). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ActionEmail {
  to: string;
  subject: string;
  greetingName: string;
  institutionName: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  expiresText: string;
  footer: string;
}

function actionEmail(email: ActionEmail): MailMessage {
  const text = [
    `Hola, ${email.greetingName}:`,
    '',
    email.intro,
    '',
    `${email.actionLabel}: ${email.actionUrl}`,
    '',
    email.expiresText,
    email.footer,
    '',
    `— ${email.institutionName} · EduCore`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #101828; line-height: 1.5;">
    <p>Hola, ${escapeHtml(email.greetingName)}:</p>
    <p>${escapeHtml(email.intro)}</p>
    <p>
      <a href="${escapeHtml(email.actionUrl)}"
         style="display: inline-block; background: #2453c4; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">
        ${escapeHtml(email.actionLabel)}
      </a>
    </p>
    <p style="font-size: 13px; color: #556070;">
      Si el botón no funciona, copia este enlace en tu navegador:<br />${escapeHtml(email.actionUrl)}
    </p>
    <p style="font-size: 13px; color: #556070;">${escapeHtml(email.expiresText)} ${escapeHtml(email.footer)}</p>
    <p style="font-size: 13px; color: #556070;">— ${escapeHtml(email.institutionName)} · EduCore</p>
  </body>
</html>`;

  return { to: email.to, subject: email.subject, text, html };
}

export function passwordResetEmail(params: {
  to: string;
  name: string;
  institutionName: string;
  url: string;
  expiresInMinutes: number;
}): MailMessage {
  return actionEmail({
    to: params.to,
    subject: 'Restablece tu contraseña de EduCore',
    greetingName: params.name,
    institutionName: params.institutionName,
    intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
    actionLabel: 'Restablecer contraseña',
    actionUrl: params.url,
    expiresText: `El enlace vence en ${params.expiresInMinutes} minutos y solo puede usarse una vez.`,
    footer: 'Si no solicitaste este cambio, ignora este mensaje: tu contraseña no cambiará.',
  });
}

export function accountActivationEmail(params: {
  to: string;
  name: string;
  institutionName: string;
  url: string;
  expiresInHours: number;
}): MailMessage {
  return actionEmail({
    to: params.to,
    subject: `Activa tu cuenta de EduCore · ${params.institutionName}`,
    greetingName: params.name,
    institutionName: params.institutionName,
    intro: `${params.institutionName} creó una cuenta para ti en EduCore. Para empezar, define tu contraseña.`,
    actionLabel: 'Activar mi cuenta',
    actionUrl: params.url,
    expiresText: `El enlace vence en ${params.expiresInHours} horas y solo puede usarse una vez.`,
    footer: 'Si no esperabas este mensaje, ignóralo o comunícate con la institución.',
  });
}
