// Email sending through Resend (https://resend.com), over its HTTP API so no extra package is needed.
// Off until RESEND_API_KEY and MAIL_FROM are both set. MAIL_FROM is an address on a domain verified
// in Resend, like deliveries@yourdomain.com; each email goes out as "<Studio> via ContentFlows" from it,
// with replies going to the creator's own email.

const KEY = process.env.RESEND_API_KEY || '';
const FROM = (process.env.MAIL_FROM || '').trim();
const enabled = !!(KEY && FROM);
// Which of the two is missing, to show the site owner (null when both or neither are set).
const partlySet = !enabled && (KEY || FROM) ? [!KEY && 'RESEND_API_KEY', !FROM && 'MAIL_FROM'].filter(Boolean) : null;

// The address part of MAIL_FROM, whether it was given as "Name <a@b.c>" or just "a@b.c".
const fromAddress = (FROM.match(/<([^>]+)>/) || [, FROM])[1].trim();
// A display name can't carry quotes, angle brackets or line breaks into the header.
const cleanName = (s) => String(s || '').replace(/["<>\r\n\\]/g, '').trim().slice(0, 70);

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
// "a@x.com, b@y.com" -> { list: ['a@x.com', 'b@y.com'] } (duplicates dropped), or { error: 'empty' | 'invalid' | 'many' }.
function parseRecipients(input, max = 5) {
  const list = [...new Set(String(input || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { error: 'empty' };
  if (list.some((e) => !EMAIL_RE.test(e) || e.length > 254)) return { error: 'invalid' };
  if (list.length > max) return { error: 'many' };
  return { list };
}

async function send({ to, subject, html, text, fromName, replyTo }) {
  if (!enabled) throw new Error('Email is not set up on this server.');
  const name = cleanName(fromName);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: name ? `${name} <${fromAddress}>` : FROM,
      to, subject, html, text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Resend answered ${res.status}`);
  return body.id;
}

// ---------- the delivery email ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RED = '#D93A24';
const INK = '#111113';
const MUTED = '#6B6B70';

// Email apps don't show SVG, so a logo only goes in when it's a PNG, JPG or WebP; otherwise the studio name does.
const emailLogo = (brand, origin) => {
  const src = brand && (brand.dark || brand.light);
  return src && !/\.svg$/i.test(src) ? `${origin}${src}` : null;
};

function deliveryEmail({ project: p, brand, link, origin, fileCount, totalSize, fmtSize, fmtDate, typeLabel }) {
  const studio = brand.name;
  const logo = emailLogo(brand, origin);
  const hello = p.client_name ? `Hi ${p.client_name.split(/\s+/)[0]},` : 'Hi,';
  const what = typeLabel ? typeLabel.toLowerCase() : 'project';
  const facts = [
    fileCount ? `${fileCount} file${fileCount === 1 ? '' : 's'} · ${fmtSize(totalSize)}` : null,
    p.expires_at ? `Available until ${fmtDate(p.expires_at)}` : null,
    p.password_hash ? `Password protected. ${studio} will send you the password.` : null,
  ].filter(Boolean);
  const subject = `${studio} sent you ${p.title}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F2EE;">
<div style="display:none;max-height:0;overflow:hidden;">Your ${esc(what)} is ready to view and download.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;"><tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;">
    <tr><td style="padding:36px 40px 8px;font-family:Helvetica,Arial,sans-serif;">
      ${logo
        ? `<img src="${esc(logo)}" alt="${esc(studio)}" height="40" style="display:block;height:40px;width:auto;max-width:220px;border:0;">`
        : `<p style="margin:0;font-size:15px;font-weight:600;letter-spacing:.02em;color:${INK};">${esc(studio)}</p>`}
    </td></tr>
    <tr><td style="padding:28px 40px 0;font-family:Helvetica,Arial,sans-serif;color:${INK};">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};">${esc(typeLabel || 'Delivery')}</p>
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;font-weight:600;">${esc(p.title)}</h1>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.55;">${esc(hello)}</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.55;">Your ${esc(what)} from ${esc(studio)} is ready. Open the link to view everything and download it in full quality.</p>
      ${p.message ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;white-space:pre-line;border-left:3px solid ${RED};padding-left:14px;">${esc(p.message)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 40px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${RED};">
        <a href="${esc(link)}" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:999px;">View your files</a>
      </td></tr></table>
    </td></tr>
    ${facts.length ? `<tr><td style="padding:12px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${MUTED};">${facts.map(esc).join('<br>')}</td></tr>` : ''}
    <tr><td style="padding:20px 40px 36px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:${MUTED};">
      If the button doesn't work, copy this link:<br><a href="${esc(link)}" style="color:${INK};word-break:break-all;">${esc(link)}</a>
    </td></tr>
  </table>
  <p style="margin:20px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};">Reply to this email to reach ${esc(studio)}. Sent with <a href="${esc(origin)}" style="color:${MUTED};">ContentFlows</a>.</p>
</td></tr></table>
</body></html>`;

  const text = [
    hello, '',
    `Your ${what} from ${studio} is ready: ${p.title}`,
    ...(p.message ? ['', p.message] : []),
    '', `View and download: ${link}`,
    ...(facts.length ? ['', ...facts] : []),
    '', `Reply to this email to reach ${studio}.`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { enabled, partlySet, send, parseRecipients, deliveryEmail };
