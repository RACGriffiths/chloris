import http from 'node:http';
import net from 'node:net';

/**
 * A pretend mail server for the end-to-end tests, run by Playwright (playwright.config.ts) with
 * `node tests/mailbox.ts`. It accepts every message sent to it over SMTP without delivering any,
 * and lists them over HTTP for the tests to read: `GET /messages?to=<address>`.
 *
 * It speaks just enough SMTP for Nodemailer: no TLS, no sign-in, nothing checked.
 */

interface Message {
	to: string[];
	/** The whole message as sent: headers, a blank line, then the body. */
	raw: string;
}

const smtpPort = Number(process.env.MAILBOX_SMTP_PORT);
const httpPort = Number(process.env.MAILBOX_HTTP_PORT);
const messages: Message[] = [];

net
	.createServer((socket) => {
		socket.setEncoding('utf8');
		let buffer = '';
		let inData = false;
		let to: string[] = [];
		const reply = (line: string) => socket.write(`${line}\r\n`);

		reply('220 localhost Chloris test mailbox');
		socket.on('data', (chunk: string) => {
			buffer += chunk;
			for (;;) {
				if (inData) {
					// The message ends with a line holding only a dot.
					const end = buffer.indexOf('\r\n.\r\n');
					if (end === -1) return;
					messages.push({ to, raw: buffer.slice(0, end).replace(/^\.\./gm, '.') });
					buffer = buffer.slice(end + 5);
					inData = false;
					to = [];
					reply('250 Accepted');
					continue;
				}
				const lineEnd = buffer.indexOf('\r\n');
				if (lineEnd === -1) return;
				const line = buffer.slice(0, lineEnd);
				buffer = buffer.slice(lineEnd + 2);
				const command = line.slice(0, 4).toUpperCase();
				if (command === 'RCPT') {
					to.push(/<([^>]*)>/.exec(line)?.[1]?.toLowerCase() ?? '');
					reply('250 OK');
				} else if (command === 'DATA') {
					inData = true;
					reply('354 End with a line holding only a dot');
				} else if (command === 'QUIT') {
					reply('221 Bye');
					socket.end();
					return;
				} else if (command === 'RSET') {
					to = [];
					reply('250 OK');
				} else if (['EHLO', 'HELO', 'MAIL', 'NOOP'].includes(command)) {
					reply('250 OK');
				} else {
					reply('502 Not implemented');
				}
			}
		});
		socket.on('error', () => socket.destroy());
	})
	.listen(smtpPort, '127.0.0.1');

http
	.createServer((request, response) => {
		const url = new URL(request.url ?? '/', `http://127.0.0.1:${httpPort}`);
		const to = url.searchParams.get('to')?.toLowerCase();
		const found = to ? messages.filter((message) => message.to.includes(to)) : messages;
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify(url.pathname === '/messages' ? found : { ok: true }));
	})
	.listen(httpPort, '127.0.0.1');
