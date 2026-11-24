import nodemailer from 'nodemailer';
import type { SmtpConfig } from '../config';

/**
 * Outgoing email, behind a small interface so the rest of the app doesn't depend on Nodemailer
 * and tests can use a fake (D10). Email is optional: without SMTP settings there is no mailer.
 */

export interface Email {
	to: string;
	subject: string;
	text: string;
	/** An HTML version of `text`, for mail apps that show one. */
	html?: string;
}

export interface Mailer {
	send(email: Email): Promise<void>;
}

export function createSmtpMailer(smtp: SmtpConfig): Mailer {
	const implicitTls = smtp.port === 465;
	const transport = nodemailer.createTransport({
		host: smtp.host,
		port: smtp.port,
		// Port 465 starts with TLS. Other ports upgrade with STARTTLS when the server offers it,
		// and must do so before a password is sent.
		secure: implicitTls,
		requireTLS: !implicitTls && smtp.user !== undefined,
		auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined
	});
	return {
		async send(email) {
			await transport.sendMail({ from: smtp.from, ...email });
		}
	};
}
