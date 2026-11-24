import { describe, expect, it } from 'vitest';
import { securityHeaders, withHeaders } from './headers';

describe('securityHeaders', () => {
	it('asks browsers to keep to HTTPS only when the origin uses it', () => {
		expect(securityHeaders('https://plants.example.com')).toMatchObject({
			'strict-transport-security': 'max-age=63072000',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'same-origin'
		});
		expect(securityHeaders('http://localhost:5173')).not.toHaveProperty(
			'strict-transport-security'
		);
	});
});

describe('withHeaders', () => {
	const headers = { 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff' };

	it('adds the headers, keeping any the route set itself', () => {
		const response = new Response('ok', { headers: { 'referrer-policy': 'strict-origin' } });

		const sent = withHeaders(response, headers);

		expect(sent.headers.get('referrer-policy')).toBe('strict-origin');
		expect(sent.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('copies a response whose headers are fixed', async () => {
		const fixed = Response.redirect('http://localhost/elsewhere', 303);

		const sent = withHeaders(fixed, headers);

		expect(sent.status).toBe(303);
		expect(sent.headers.get('location')).toBe('http://localhost/elsewhere');
		expect(sent.headers.get('x-content-type-options')).toBe('nosniff');
		expect(await sent.text()).toBe('');
	});
});
