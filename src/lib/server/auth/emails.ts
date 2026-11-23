import type { Email } from '../notify/mailer';
import { SIGN_IN_LINK_MINUTES, type SignInLink } from './index';

/** The email carrying a sign-in link. Plain text, so there is no markup to get wrong. */
export function signInLinkEmail({ email, url }: SignInLink): Email {
	return {
		to: email,
		subject: 'Your Chloris sign-in link',
		text: [
			'Open this link to sign in to Chloris:',
			'',
			url,
			'',
			`It works once, within ${SIGN_IN_LINK_MINUTES} minutes.`,
			"If you didn't ask to sign in, you can ignore this email.",
			''
		].join('\n')
	};
}
