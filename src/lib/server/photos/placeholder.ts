/**
 * What is sent in place of a photo whose file is missing from disk, such as after restoring an
 * older photo backup (docs/spec.md, Photos and backups): a grey square with a broken-image mark,
 * rather than an error.
 */
export const MISSING_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#e5e7eb"/>
<g fill="none" stroke="#9ca3af" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<rect x="30" y="32" width="40" height="36" rx="4"/>
<path d="M30 60l12-12 10 10 6-6 12 12"/>
<path d="M25 75L75 25"/>
</g>
</svg>`;
