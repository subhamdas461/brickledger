import { APP_NAME } from '@brickledger/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Most recent messages (console mailer only) - handy in tests and local dev. */
  readonly outbox?: MailMessage[];
}

class ConsoleMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  constructor(private readonly log?: FastifyBaseLogger) {}
  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > 50) this.outbox.shift();
    this.log?.info({ to: message.to, subject: message.subject }, `[mail] ${message.text}`);
  }
}

class SmtpMailer implements Mailer {
  private transport: Promise<any>;
  constructor(url: string, private readonly from: string) {
    this.transport = import('nodemailer').then((m) => (m.default ?? m).createTransport(url));
  }
  async send(message: MailMessage): Promise<void> {
    const t = await this.transport;
    await t.sendMail({ from: this.from, ...message });
  }
}

export function createMailer(config: Config, log?: FastifyBaseLogger): Mailer {
  return config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) : new ConsoleMailer(log);
}

// ---------------------------------------------------------------- templates

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function layout(title: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:18px;font-weight:700;color:#c2410c;padding-bottom:16px">${APP_NAME}</td></tr>
<tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${escape(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#52514e">${body}</td></tr>
${cta ? `<tr><td style="padding-top:24px"><a href="${escape(cta.url)}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escape(cta.label)}</a></td></tr>
<tr><td style="padding-top:16px;font-size:12px;color:#898781;word-break:break-all">Or open: ${escape(cta.url)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

export const emails = {
  resetPassword(name: string, url: string): Omit<MailMessage, 'to'> {
    return {
      subject: `Reset your ${APP_NAME} password`,
      text: `Hi ${name}, reset your password using this link (valid for 1 hour): ${url}`,
      html: layout(
        'Reset your password',
        `Hi ${escape(name)}, we received a request to reset your password. The link is valid for 1 hour. If you didn't ask for this, you can ignore this email.`,
        { label: 'Choose a new password', url },
      ),
    };
  },
  invitation(opts: { inviter: string; project: string; role: string; url: string }): Omit<MailMessage, 'to'> {
    return {
      subject: `${opts.inviter} invited you to "${opts.project}" on ${APP_NAME}`,
      text: `${opts.inviter} invited you to join "${opts.project}" as ${opts.role}. Accept: ${opts.url}`,
      html: layout(
        `Join "${opts.project}"`,
        `${escape(opts.inviter)} invited you to follow the construction of <b>${escape(opts.project)}</b> as <b>${escape(opts.role)}</b> - expenses, progress, photos and more in one place.`,
        { label: 'Accept invitation', url: opts.url },
      ),
    };
  },
};
