import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Envío de correo con un único punto de entrada. El driver se elige por
 * configuración:
 * - `smtp`: envío real (producción).
 * - `file`: escribe cada correo como .eml en MAIL_OUTBOX_DIR (desarrollo), para
 *   revisarlo sin enviarlo y sin que los enlaces con tokens lleguen al log.
 * - `memory`: los guarda en `outbox` (solo pruebas).
 *
 * En fases posteriores las notificaciones pasarán por una cola con estados
 * (pendiente, enviada, fallida); este servicio será el proveedor de correo.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  /** Correos enviados con el driver `memory` (solo pruebas). */
  readonly outbox: MailMessage[] = [];

  constructor(private readonly config: AppConfigService) {
    const { driver, smtp } = config.mail;
    this.transporter =
      driver === 'smtp'
        ? createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
          })
        : createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }

  async send(message: MailMessage): Promise<void> {
    const { driver, from, outboxDir } = this.config.mail;

    if (driver === 'memory') {
      this.outbox.push(message);
      return;
    }

    const info = await this.transporter.sendMail({ from, ...message });

    if (driver === 'file') {
      const dir = isAbsolute(outboxDir) ? outboxDir : resolve(process.cwd(), outboxDir);
      await mkdir(dir, { recursive: true });
      const file = join(
        dir,
        `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.eml`,
      );
      await writeFile(file, info.message as Buffer);
      // Solo se registra la ubicación del archivo, nunca su contenido.
      this.logger.log(`Correo de desarrollo guardado en ${file}`);
    }
  }
}
