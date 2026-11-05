const fs = require('fs');
const path = require('path');
// Inline brand logo so the wordmark and three squares follow the header colour; the red square and dot stay brand red.
const LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'contentflows-logo-color.svg'), 'utf8')
  .replace(/<title>.*?<\/title>/, '')
  .replace(/ width="[^"]*" height="[^"]*"/, '')
  .replace('role="img" aria-label="ContentFlows"', 'class="logo-svg" aria-hidden="true" focusable="false"')
  .replace(/fill="#111113"/g, 'fill="currentColor"')
  .trim();

// The four-square symbol as separate shapes so each one can be animated.
const SYMBOL = (cls = '') => `<svg class="cf-symbol ${cls}" viewBox="5 5 54 54" aria-hidden="true" focusable="false">
  <rect class="sq sq1" x="5" y="5" width="22" height="22" rx="6"/><rect class="sq sq2" x="31" y="5" width="22" height="22" rx="6"/>
  <rect class="sq sq3" x="5" y="31" width="22" height="22" rx="6"/><rect class="sq sq4" x="37" y="37" width="22" height="22" rx="6"/></svg>`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtSize = (n) => {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (d) => d ? new Date(d.replace(' ', 'T') + (d.length <= 10 ? '' : 'Z'))
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const TYPES = { photoshoot: 'Photoshoot', music_video: 'Music video', commercial: 'Commercial', film: 'Film', podcast: 'Podcast', project: 'Final project' };

// Header + "Explore" menu panel, adapted from the 1367 Studio navigation.
// nav = { home, logo, left: [{href,label}], right: [{href,label,cta}], primary: [{href,label,form}],
//         secondary: [{href,label,form}], images: [{href,src}], eyebrow }
function word(label) {
  const t = esc(label);
  return `<span class="menu-mask"><span class="menu-line"><span class="menu-word">${t}</span><span class="menu-word" aria-hidden="true">${t}</span></span></span>`;
}
function navLink(l, cls) {
  if (l.form) return `<button type="submit" form="${l.form}" class="${cls}">${word(l.label)}</button>`;
  return `<a href="${esc(l.href)}" class="${cls}">${word(l.label)}</a>`;
}
function siteNav(nav) {
  if (!nav) return '';
  const icon = `<svg class="icon-menu" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" stroke-width="1.4"/></svg>
    <svg class="icon-close hidden" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.4"/></svg>`;
  const top = (l) => l.form
    ? `<button type="submit" form="${l.form}" class="nav-link">${esc(l.label)}</button>`
    : `<a href="${esc(l.href)}" class="nav-link${l.cta ? ' nav-cta' : ''}">${esc(l.label)}</a>`;
  return `
<header id="site-header" data-theme="${nav.theme || 'light'}">
  <div id="header-pill">
    <nav class="nav-side left">${(nav.left || []).map(top).join('')}</nav>
    <a class="header-logo${nav.logo ? '' : ' is-brand'}" href="${esc(nav.home || '/')}" aria-label="${esc(nav.logo || 'ContentFlows home')}">${nav.logo ? esc(nav.logo) : LOGO}</a>
    <nav class="nav-side right">${(nav.right || []).map(top).join('')}
      <button id="menu-btn" class="menu-btn" aria-label="Open menu" aria-controls="menu-panel" aria-expanded="false">${icon}</button></nav>
  </div>
</header>
<div id="menu-panel" aria-hidden="true" role="dialog" aria-label="Menu">
  <div class="menu-bg"></div>
  <div class="menu-topbar"><span class="menu-fade menu-eyebrow">${esc(nav.eyebrow || 'Explore')}</span>
    <button id="menu-close" class="menu-close menu-fade" aria-label="Close menu"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.4"/></svg></button></div>
  <nav class="menu-primary">${(nav.primary || []).map((l, i) => navLink(l, 'menu-primary-link').replace('class="menu-line"', `class="menu-line" style="--i:${i}"`)).join('')}</nav>
  ${nav.secondary?.length ? `<nav class="menu-secondary">${nav.secondary.map((l, i) => navLink(l, 'menu-secondary-link').replace('class="menu-line"', `class="menu-line" style="--i:${i + (nav.primary || []).length}"`)).join('')}</nav>` : ''}
  ${nav.images?.length ? `<div class="menu-images menu-fade">${nav.images.slice(0, 3).map((im) => `<a class="menu-image" href="${esc(im.href)}"><img src="${esc(im.src)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
</div>
<form id="logout-form" method="post" action="/logout" hidden></form>`;
}

// Marketing header adapted from Antimetal (via Details): logo left, centred links with a
// sliding dot under the hovered link, a two-column mega-menu on "Product", Log in + CTA right.
const ARROW = '<svg class="am-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 9.997h8m0 0-2.778-2.667M14 9.997l-2.778 2.667" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const AM_ICONS = {
  quality: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" stroke-width="1.4"/><rect class="ic-acc" x="12.5" y="12.5" width="5" height="5" rx="1.5" fill="#E5402A"/></svg>',
  speed: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19.5h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g class="ic-acc"><path d="M12 15.5V5.5m0 0-4 4m4-4 4 4" stroke="#E5402A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>',
  easy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-.75.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path class="ic-acc" d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l.75-.75" stroke="#E5402A" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
function amNav() {
  const rows = [
    { href: '#quality', icon: 'quality', label: 'Full quality', desc: 'Original files, never compressed' },
    { href: '#speed', icon: 'speed', label: 'Fast uploads', desc: 'Send a whole shoot in minutes' },
    { href: '#easy', icon: 'easy', label: 'Easy for clients', desc: 'One link, nothing to install' },
  ];
  const row = (r) => `<a class="am-row" href="${r.href}"><span class="am-ic">${AM_ICONS[r.icon]}</span><span class="am-txt"><b>${r.label}${ARROW}</b><small>${r.desc}</small></span></a>`;
  const burger = `<svg class="am-i-open" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" stroke-width="1.4"/></svg><svg class="am-i-close" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.4"/></svg>`;
  return `
<header class="am" id="am-header" data-theme="dark">
  <div class="am-bar">
    <a class="am-logo header-logo is-brand" href="/" aria-label="ContentFlows home">${LOGO}</a>
    <nav class="am-links" id="am-links" aria-label="Main">
      <button class="am-link" id="am-product" type="button" aria-expanded="false" aria-controls="am-drop">Product</button>
      <a class="am-link" href="#how">How it works</a>
      <a class="am-link" href="#try">Try it</a>
      <span class="am-dot" id="am-dot" aria-hidden="true"></span>
      <div class="am-drop" id="am-drop">
        <div class="am-card">
          <div class="am-col"><p class="am-head">Deliver</p>${rows.map(row).join('')}</div>
          <div class="am-col am-col-right"><p class="am-head">Try it</p>
            <a class="am-try" href="#try" tabindex="-1" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><span class="am-try-core">${SYMBOL('')}<em>Drop your files</em></span></a>
            <a class="am-row" href="#try"><span class="am-ic"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><rect class="ic-acc" x="14" y="14" width="6.5" height="6.5" rx="2" fill="#E5402A"/></svg></span><span class="am-txt"><b>Drop zone${ARROW}</b><small>Drag a shoot onto the page</small></span></a>
          </div>
        </div>
      </div>
    </nav>
    <div class="am-right">
      <a class="am-login" href="/login">Log in</a>
      <a class="am-cta" href="/signup">Start delivering</a>
      <button class="am-burger" id="am-burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="am-mobile">${burger}</button>
    </div>
  </div>
  <div class="am-mobile" id="am-mobile" aria-hidden="true">
    <nav class="am-m-links">${rows.map((r) => `<a href="${r.href}">${r.label}</a>`).join('')}<a href="#how">How it works</a><a href="#try">Try it</a></nav>
    <div class="am-m-foot"><a class="am-m-login" href="/login">Log in</a><a class="fs-cta" href="/signup">Start delivering</a></div>
  </div>
</header>`;
}

function creatorNav(user, recent = []) {
  return {
    home: '/dashboard',
    left: [{ href: '/dashboard', label: 'Deliveries' }, { href: '/dashboard#new', label: 'New delivery' }],
    right: [{ form: 'logout-form', label: 'Log out' }],
    primary: [{ href: '/dashboard', label: 'Deliveries' }, { href: '/dashboard#new', label: 'New delivery' },
      ...recent.slice(0, 2).map((r) => ({ href: `/projects/${r.id}`, label: r.title.length > 22 ? r.title.slice(0, 21) + '…' : r.title }))],
    secondary: [{ href: '/dashboard', label: user.studio || user.name }, { form: 'logout-form', label: 'Log out' }],
    images: recent.filter((r) => r.cover_id).map((r) => ({ href: `/projects/${r.id}`, src: `/d/${r.share_token}/thumb/${r.cover_id}` })),
  };
}

function layout({ title, body, user, nav, header, recent, bodyClass = '', scripts = [] }) {
  if (!nav && user) nav = creatorNav(user, recent);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ContentFlows</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/static/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#111113">
<link rel="stylesheet" href="/static/styles.css">
</head><body class="${bodyClass}${nav || header ? ' has-nav' : ''}">
${header || siteNav(nav)}
${body}
${header ? '<script src="/static/am-nav.js"></script>' : nav ? '<script src="/static/nav.js"></script>' : ''}
${scripts.map((s) => `<script src="${s}"></script>`).join('')}
</body></html>`;
}

function landing() {
  return layout({ title: 'Deliver your work beautifully', bodyClass: 'landing', header: amNav(), scripts: ['/static/spiral.js', '/static/landing.js'], body: `
<section class="fs-hero light" data-header-theme="dark">
  <div class="fs-symbol">${SYMBOL('anim-hero')}</div>
  <h1 class="fs-title">Final work delivery for<br><span>photographers and directors.</span></h1>
  <div class="fs-aside">
    <p class="fs-mono">Upload the shoot. Send one private link. Your client streams, views and downloads in full quality.</p>
    <a class="fs-cta" href="/signup">Start delivering</a>
  </div>
</section>

<section class="flow-sec" id="try" data-header-theme="light" data-spiral-host>
  <div class="spiral" data-spiral aria-hidden="true"><div class="spiral-world"></div></div>
  <div class="flow-core" id="flow-core">
    <input type="file" id="flow-input" multiple hidden>
    <span class="flow-halo" aria-hidden="true"></span>
    <button type="button" class="flow-pick" id="flow-pick" aria-label="Drop files or click to choose">
      <span class="flow-icon">${SYMBOL('anim-loader')}</span>
      <span class="flow-title" id="flow-title" aria-live="polite">Drop your files</span>
      <span class="flow-count" id="flow-count"></span>
    </button>
    <div class="flow-ready" id="flow-ready" hidden><a class="fs-cta" href="/signup">Send them</a></div>
  </div>
</section>

<section class="lp lp-light" data-header-theme="dark" id="why">
  <div class="lp-inner">
    <p class="lp-label reveal">(01) Why ContentFlows</p>
    <h2 class="lp-statement reveal">Your work leaves the studio <span>exactly as you made it.</span></h2>
  </div>
  <div class="lp-inner pillar-grid">
    <article class="pillar reveal" id="quality">
      <div class="pv pv-quality" aria-hidden="true">
        <div class="pvq-row"><em>Original</em><span>campaign_031.tif</span><b>248.6 MB</b></div>
        <div class="pvq-track"><i></i></div>
        <div class="pvq-row out"><em>Delivered</em><span>campaign_031.tif</span><b>248.6 MB</b></div>
        <span class="pvq-badge">Identical</span>
      </div>
      <span class="pillar-num">01 / Quality</span>
      <h3>Not a single pixel lost.</h3>
      <p>Original files in, original files out.</p>
    </article>
    <article class="pillar reveal" id="speed">
      <div class="pv pv-speed" aria-hidden="true">
        <div class="pvs-row"><span>hero_cut_4K.mov</span><i style="--t:1.9s"></i></div>
        <div class="pvs-row"><span>campaign_031.tif</span><i style="--t:1.2s"></i></div>
        <div class="pvs-row"><span>bts_selects.zip</span><i style="--t:1.6s"></i></div>
        <span class="pvs-chip">Link ready</span>
      </div>
      <span class="pillar-num">02 / Speed</span>
      <h3>From export to inbox in minutes.</h3>
      <p>Files upload side by side. The link is ready instantly.</p>
    </article>
    <article class="pillar reveal" id="easy">
      <div class="pv pv-easy" aria-hidden="true">
        <span class="pve-link">contentflows.app/d/golden-hour</span>
        <div class="pve-grid"><i class="g1"></i><i class="g2"></i><i class="g3"></i><i class="g4"></i></div>
        <span class="pve-tap"></span>
      </div>
      <span class="pillar-num">03 / Easy for clients</span>
      <h3>One link. Nothing to install.</h3>
      <p>No account, no app. Opens on any device.</p>
    </article>
  </div>
</section>

<section class="lp lp-dark" data-header-theme="light" id="professional">
  <div class="lp-inner split">
    <div class="reveal">
      <p class="lp-label">(02) Professional by default</p>
      <h2 class="lp-heading">The final impression of every project, done right.</h2>
      <p class="lp-body">Each delivery opens full screen on your cover image or a looping clip from the film, under your studio name, with a personal note to your client. It looks like your work, because it is your work.</p>
      <ul class="check-list">
        <li>Your studio name, cover and message on every delivery</li>
        <li>Password protection and expiry dates</li>
        <li>See when your client views and downloads</li>
        <li>Switch off downloads or replace a link in one click</li>
      </ul>
    </div>
    <div class="mock reveal" aria-hidden="true">
      <div class="mock-bar"><i></i><i></i><i></i><em>Private link · /d/golden-hour</em></div>
      <div class="mock-hero">
        <div class="mock-title">Golden Hour Campaign<br><span>for Maya Rivers.</span></div>
        <div class="mock-cta">Download all</div>
      </div>
      <div class="mock-stats">
        <div><span>Status</span><b>Viewed 2 min ago</b></div>
        <div><span>Downloads</span><b>14 files</b></div>
        <div><span>Access</span><b>Password · Dec 1</b></div>
      </div>
    </div>
  </div>
  <div class="lp-inner fact-grid">
    <div class="reveal"><b>0%</b><span>Compression on your files</span></div>
    <div class="reveal"><b>10 GB</b><span>Maximum size per file</span></div>
    <div class="reveal"><b>1 link</b><span>For the whole delivery</span></div>
    <div class="reveal"><b>0</b><span>Accounts your client needs</span></div>
  </div>
</section>

<section class="lp lp-light" data-header-theme="dark" id="how">
  <div class="lp-inner">
    <p class="lp-label reveal">(03) How it works</p>
    <h2 class="lp-heading reveal">Three steps. No learning curve.</h2>
    <ol class="steps">
      <li class="reveal"><span>01</span><h3>Create a delivery</h3><p>Name the project, pick the type and add your client. Your private link is ready immediately.</p></li>
      <li class="reveal"><span>02</span><h3>Drop in the finals</h3><p>Photos, cuts, masters, audio. Thumbnails and video previews are made for you.</p></li>
      <li class="reveal"><span>03</span><h3>Send one link</h3><p>Your client views, streams and downloads. You see when they open it.</p></li>
    </ol>
  </div>
</section>

<section class="arch" aria-hidden="true"><div class="arch-layer"><img src="/static/arch.jpg" alt="" decoding="async"></div></section>
<footer class="end" data-header-theme="light">
  <div class="end-inner">
    <p class="lp-label">(04) Start delivering</p>
    <h2 class="end-title">Deliver your next project<br><span>the way it deserves.</span></h2>
    <p class="end-sub">Create your studio in under a minute. Send your first delivery today.</p>
    <a class="fs-cta" href="/signup">Start delivering</a>
    <div class="end-rule"></div>
    <nav class="end-links" aria-label="Footer"><a href="/signup">Sign up</a><a href="/login">Log in</a><a href="#why">Why us</a><a href="#how">How it works</a></nav>
  </div>
  <div class="end-foot"><a class="foot-logo" href="/" aria-label="ContentFlows home">${LOGO}</a><span class="fs-mono">Final work delivery for creatives</span></div>
</footer>` });
}

function authForm({ mode, error, values = {} }) {
  const signup = mode === 'signup';
  return layout({ title: signup ? 'Sign up' : 'Log in', bodyClass: 'auth', body: `
<main class="auth-card">
  <a class="brand" href="/" aria-label="ContentFlows home">${LOGO}</a>
  <h1>${signup ? 'Create your studio' : 'Welcome back'}</h1>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/${mode}">
    ${signup ? `<label>Your name<input name="name" required value="${esc(values.name)}"></label>
    <label>Studio name <span class="muted">(shown to clients)</span><input name="studio" value="${esc(values.studio)}"></label>` : ''}
    <label>Email<input type="email" name="email" required value="${esc(values.email)}"></label>
    <label>Password<input type="password" name="password" required minlength="${signup ? 8 : 1}"></label>
    <button class="btn block">${signup ? 'Create account' : 'Log in'}</button>
  </form>
  <p class="muted center">${signup ? 'Already have an account? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Create an account</a>'}</p>
</main>` });
}

function dashboard({ user, projects }) {
  return layout({ title: 'Deliveries', user, recent: projects, body: `
<main class="wrap">
  <div class="page-head"><div><h1>Deliveries</h1><p class="muted">${projects.length} project${projects.length === 1 ? '' : 's'}</p></div>
  <a class="btn" href="#new">New delivery</a></div>
  ${projects.length ? `<div class="cards">${projects.map((p) => `
    <a class="card" href="/projects/${p.id}">
      <div class="cover">${p.cover_thumb ? `<img src="/d/${p.share_token}/thumb/${p.cover_id}" alt="">` : '<div class="cover-empty"></div>'}</div>
      <div class="card-body"><span class="tag">${esc(TYPES[p.type] || p.type)}</span>
      <h3>${esc(p.title)}</h3>
      <p class="muted">${esc(p.client_name || 'No client set')} · ${p.asset_count} file${p.asset_count === 1 ? '' : 's'} · ${fmtSize(p.total_size || 0)}</p>
      <p class="muted small">${p.download_count} download${p.download_count === 1 ? '' : 's'} · ${p.view_count} view${p.view_count === 1 ? '' : 's'}</p></div>
    </a>`).join('')}</div>`
  : `<div class="empty"><h2>No deliveries yet</h2><p class="muted">Create a delivery, upload the finals, and send your client the link.</p></div>`}
</main>
<dialog id="new"><form method="post" action="/projects" class="stack">
  <h2>New delivery</h2>
  <label>Title<input name="title" required placeholder="Summer campaign — finals"></label>
  <label>Type<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
  <div class="row"><label>Client name<input name="client_name"></label><label>Client email<input type="email" name="client_email"></label></div>
  <div class="row end"><button type="button" class="btn ghost" onclick="this.closest('dialog').close(); history.replaceState(null, '', location.pathname)">Cancel</button><button class="btn">Create</button></div>
</form></dialog>
<script>(() => { const d = document.getElementById('new');
  const sync = () => { if (location.hash === '#new' && !d.open) d.showModal(); };
  addEventListener('hashchange', sync); sync();
  d.addEventListener('close', () => location.hash === '#new' && history.replaceState(null, '', location.pathname)); })();</script>` });
}

function projectPage({ user, project: p, assets, stats, origin, saved, recent }) {
  const link = `${origin}/d/${p.share_token}`;
  return layout({ title: p.title, user, recent, scripts: ['/static/spiral.js', '/static/upload.js'], body: `
<main class="wrap">
  <a class="back" href="/dashboard">← All deliveries</a>
  <div class="page-head"><div><span class="tag">${esc(TYPES[p.type] || p.type)}</span><h1>${esc(p.title)}</h1>
  <p class="muted">${esc(p.client_name || 'No client set')}${p.client_email ? ` · ${esc(p.client_email)}` : ''}</p></div>
  <a class="btn ghost" href="/d/${p.share_token}" target="_blank">Preview as client</a></div>

  <section class="share">
    <div><h3>Delivery link</h3><p class="muted small">${p.password_hash ? 'Password protected' : 'Anyone with the link can view'}${p.expires_at ? ` · expires ${fmtDate(p.expires_at)}` : ''}${p.allow_download ? '' : ' · downloads off'}</p></div>
    <div class="copy"><input readonly value="${esc(link)}" id="share-link"><button class="btn" data-copy="#share-link">Copy</button></div>
    <div class="stats"><div><b>${stats.views}</b><span>views</span></div><div><b>${stats.downloads}</b><span>downloads</span></div><div><b>${stats.last ? fmtDate(stats.last) : '—'}</b><span>last activity</span></div></div>
  </section>

  <section>
    <div id="drop" class="drop has-spiral" data-project="${p.id}" data-spiral-host>
      <div class="spiral" data-spiral data-count="22" data-size=".75" aria-hidden="true"><div class="spiral-world"></div></div>
      <div class="drop-body">
        <input type="file" id="file-input" multiple hidden>
        <p><b>Drop files here</b> or <button class="link" type="button" onclick="document.getElementById('file-input').click()">browse</button></p>
        <p class="muted small">Photos, videos, audio, or any final files</p>
        <div class="uploading" id="uploading" hidden>${SYMBOL('anim-loader')}<span id="uploading-text">Uploading</span></div>
        <div id="queue"></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Files <span class="muted">${assets.length}</span></h2>
    ${assets.length ? `<div class="asset-grid">${assets.map((a) => `
      <div class="asset">
        <div class="thumb">${a.thumb_name ? `<img loading="lazy" src="/d/${p.share_token}/thumb/${a.id}" alt="">` : `<div class="file-icon">${esc((a.original_name.split('.').pop() || 'file').toUpperCase())}</div>`}
        ${a.kind === 'video' ? '<span class="badge">▶ Video</span>' : ''}${p.cover_asset_id === a.id ? '<span class="badge left">Cover</span>' : ''}</div>
        <div class="asset-meta"><span title="${esc(a.original_name)}">${esc(a.original_name)}</span><span class="muted small">${fmtSize(a.size)} · ${a.downloads} dl</span></div>
        <div class="asset-actions">
          ${a.thumb_name ? `<form method="post" action="/projects/${p.id}/cover/${a.id}"><button class="link small">Set cover</button></form>` : ''}
          <form method="post" action="/projects/${p.id}/assets/${a.id}/delete" onsubmit="return confirm('Delete this file?')"><button class="link small danger">Delete</button></form>
        </div>
      </div>`).join('')}</div>` : '<p class="muted">No files uploaded yet.</p>'}
  </section>

  <section class="settings">
    <h2>Settings</h2>
    ${saved ? '<p class="ok">Saved.</p>' : ''}
    <form method="post" action="/projects/${p.id}/settings" class="stack">
      <div class="row"><label>Title<input name="title" required value="${esc(p.title)}"></label>
      <label>Type<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="row"><label>Client name<input name="client_name" value="${esc(p.client_name)}"></label><label>Client email<input type="email" name="client_email" value="${esc(p.client_email)}"></label></div>
      <label>Message to client<textarea name="message" rows="3" placeholder="Thanks for working with us! Here are your finals.">${esc(p.message)}</textarea></label>
      <div class="row"><label>Password <span class="muted">${p.password_hash ? '(set, leave blank to keep)' : '(optional)'}</span><input type="password" name="password" autocomplete="new-password"></label>
      <label>Expires on <span class="muted">(optional)</span><input type="date" name="expires_at" value="${esc(p.expires_at || '')}"></label></div>
      <label class="check"><input type="checkbox" name="allow_download" ${p.allow_download ? 'checked' : ''}> Allow client downloads</label>
      ${p.password_hash ? '<label class="check"><input type="checkbox" name="remove_password"> Remove password</label>' : ''}
      <div class="row end"><button class="btn">Save settings</button></div>
    </form>
    <div class="danger-zone">
      <form method="post" action="/projects/${p.id}/rotate" onsubmit="return confirm('The old link will stop working. Continue?')"><button class="btn ghost">Generate new link</button></form>
      <form method="post" action="/projects/${p.id}/delete" onsubmit="return confirm('Delete this delivery and all its files?')"><button class="btn ghost danger">Delete delivery</button></form>
    </div>
  </section>
</main>` });
}

function unlockPage({ project, studio, error }) {
  return layout({ title: project.title, bodyClass: 'auth', body: `
<main class="auth-card">
  <p class="eyebrow">${esc(studio)}</p>
  <h1>${esc(project.title)}</h1>
  <p class="muted">This delivery is password protected.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/d/${project.share_token}/unlock"><label>Password<input type="password" name="password" required autofocus></label>
  <button class="btn block">View delivery</button></form>
</main>` });
}

function messagePage(title, text) {
  return layout({ title, bodyClass: 'auth', body: `<main class="auth-card"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></main>` });
}

const DL_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v8m0 0L4.75 7.25M8 10.5l3.25-3.25M3 13.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Client delivery header: same bar as the home page (adapted from Antimetal), with the
// studio name as the logo, section links with the sliding dot, and Download all on the right.
function deliveryHeader({ studio, links, cta }) {
  const burger = `<svg class="am-i-open" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" stroke-width="1.4"/></svg><svg class="am-i-close" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.4"/></svg>`;
  return `
<header class="am" id="am-header" data-theme="light">
  <div class="am-bar">
    <a class="am-logo am-studio" href="#top">${esc(studio)}</a>
    <nav class="am-links" id="am-links" aria-label="Delivery">${links.map((l) => `<a class="am-link" href="${l.href}">${esc(l.label)}</a>`).join('')}<span class="am-dot" id="am-dot" aria-hidden="true"></span></nav>
    <div class="am-right">${cta ? `<a class="am-cta" href="${cta.href}">${DL_ICON}<span>${esc(cta.label)}</span></a>` : ''}
      <button class="am-burger" id="am-burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="am-mobile">${burger}</button></div>
  </div>
  <div class="am-mobile" id="am-mobile" aria-hidden="true">
    <nav class="am-m-links">${links.map((l) => `<a href="${l.href}">${esc(l.label)}</a>`).join('')}</nav>
    <div class="am-m-foot"><span class="am-m-login">${esc(studio)}</span>${cta ? `<a class="fs-cta" href="${cta.href}">${esc(cta.label)}</a>` : ''}</div>
  </div>
</header>`;
}

function deliveryPage({ project: p, assets, studio, host = '' }) {
  const base = `/d/${p.share_token}`;
  const canDl = !!p.allow_download && assets.length > 0;
  const cover = assets.find((a) => a.id === p.cover_asset_id && a.thumb_name) || assets.find((a) => a.thumb_name);
  const visual = assets.filter((a) => a.kind === 'image' || a.kind === 'video');
  const photos = visual.filter((a) => a.kind === 'image').length;
  const films = visual.length - photos;
  const others = assets.filter((a) => a.kind !== 'image' && a.kind !== 'video');
  const total = assets.reduce((s, a) => s + a.size, 0);
  const type = TYPES[p.type] || 'Delivery';
  const items = visual.map((a) => ({ id: a.id, kind: a.kind, name: a.original_name, size: a.size, src: `${base}/media/${a.id}`, poster: a.thumb_name ? `${base}/thumb/${a.id}` : null, dl: p.allow_download ? `${base}/download/${a.id}` : null }));
  const ext = (n) => esc((n.split('.').pop() || 'file').slice(0, 4).toUpperCase());
  const links = [...(visual.length ? [{ href: '#work', label: 'Gallery' }] : []), ...(others.length ? [{ href: '#files', label: 'Files' }] : [])];
  const message = p.message || `Your ${type.toLowerCase()} is ready. <span>Everything here is full quality, exactly as it left the studio.</span>`;
  const noteHtml = p.message ? esc(p.message).replace(/\n/g, '<br>') : message;
  const longNote = (p.message || '').length > 150;
  const filters = photos && films ? `<div class="dl-filter" role="group" aria-label="Show">
      <button type="button" class="on" data-f="all" aria-pressed="true">All <em>${visual.length}</em></button><button type="button" data-f="image" aria-pressed="false">Photos <em>${photos}</em></button><button type="button" data-f="video" aria-pressed="false">Films <em>${films}</em></button><span class="dl-filter-dot" aria-hidden="true"></span></div>` : '';
  return layout({ title: p.title, bodyClass: 'delivery', scripts: ['/static/gallery.js'],
    header: deliveryHeader({ studio, links, cta: canDl ? { href: `${base}/zip`, label: `Download all` } : null }), body: `
<section class="fs-hero dl-hero" id="top" data-header-theme="light">
  ${cover ? (cover.kind === 'video'
    ? `<video class="fs-media" src="${base}/media/${cover.id}" poster="${base}/thumb/${cover.id}" autoplay muted loop playsinline preload="metadata"></video>`
    : `<img class="fs-media" src="${base}/media/${cover.id}" alt="">`) : ''}
  <h1 class="fs-title">${esc(p.title)}${p.client_name ? `<br><span>for ${esc(p.client_name)}.</span>` : ''}</h1>
  <div class="fs-aside">
    <p class="fs-mono">${esc(type)} · ${assets.length} file${assets.length === 1 ? '' : 's'} · ${fmtSize(total)}<br>Delivered by ${esc(studio)}</p>
    ${canDl ? `<a class="fs-cta" href="${base}/zip">Download all</a>` : `<a class="fs-cta" href="#work">View files</a>`}
  </div>
</section>

<section class="lp lp-light dl-intro" data-header-theme="dark">
  <div class="lp-inner">
    <p class="lp-label">(A note from ${esc(studio)})</p>
    <h2 class="lp-statement dl-note${longNote ? ' is-long' : ''}">${noteHtml}</h2>
    <dl class="dl-facts">
      <div><dt>Files</dt><dd>${assets.length}</dd></div>
      <div><dt>Total size</dt><dd>${fmtSize(total)}</dd></div>
      <div><dt>Quality</dt><dd>Original</dd></div>
      <div><dt>Available</dt><dd>${p.expires_at ? `Until ${fmtDate(p.expires_at)}` : 'No expiry'}</dd></div>
    </dl>
  </div>
</section>

${!assets.length ? `<section class="lp lp-dark dl-empty" data-header-theme="light"><div class="lp-inner"><div class="dl-empty-sym">${SYMBOL('anim-loader')}</div><h2 class="lp-heading">Files are on the way.</h2><p class="lp-body">${esc(studio)} hasn't added anything yet. This page updates as soon as they do.</p></div></section>` : ''}

${visual.length ? `<section class="lp lp-light dl-gallery" id="work" data-header-theme="dark">
  <div class="lp-inner">
    <p class="lp-label">(01) Gallery</p>
    <div class="dl-board">
      <div class="dl-head">
        <button type="button" class="dl-link" aria-label="Copy the link to this delivery"><span class="dl-link-text">${esc(host + base)}</span><span class="dl-link-tip" aria-hidden="true">Copy</span></button>
        ${filters}
      </div>
      <div class="dl-grid">${visual.map((a, i) => `
        <figure class="dl-tile ${a.kind}" data-index="${i}" data-id="${a.id}" data-kind="${a.kind}" data-size="${a.size}" tabindex="0" aria-label="Open ${esc(a.original_name)}">
          ${a.thumb_name ? `<img loading="lazy" src="${base}/thumb/${a.id}" alt="">` : `<div class="dl-noimg">${ext(a.original_name)}</div>`}
          ${a.kind === 'video' ? '<span class="dl-play" aria-hidden="true"></span>' : ''}
          ${canDl ? `<button type="button" class="dl-check" aria-pressed="false" aria-label="Select ${esc(a.original_name)}"></button>` : ''}
          <figcaption><span>${esc(a.original_name)}</span>${canDl ? `<a class="dl-down" href="${base}/download/${a.id}" aria-label="Download ${esc(a.original_name)}">${DL_ICON}</a>` : ''}</figcaption>
        </figure>`).join('')}</div>
    </div>
  </div>
</section>` : ''}

${others.length ? `<section class="lp lp-light dl-files" id="files" data-header-theme="dark">
  <div class="lp-inner">
    <p class="lp-label">(${visual.length ? '02' : '01'}) Files</p>
    <ul class="dl-list">${others.map((a) => `
      <li class="dl-file">
        <span class="dl-ext">${ext(a.original_name)}</span>
        <div class="dl-meta"><b>${esc(a.original_name)}</b><small>${a.kind === 'audio' ? 'Audio' : 'File'} · ${fmtSize(a.size)}</small></div>
        ${a.kind === 'audio' ? `<div class="dl-player" data-src="${base}/media/${a.id}"><button type="button" class="dl-pp" aria-label="Play ${esc(a.original_name)}"><i></i></button><div class="dl-track"><i></i></div><span class="dl-time">0:00</span></div>` : '<span class="dl-spacer"></span>'}
        ${p.allow_download ? `<a class="dl-btn" href="${base}/download/${a.id}">${DL_ICON}<span>Download</span></a>` : ''}
      </li>`).join('')}</ul>
  </div>
</section>` : ''}

<footer class="end dl-end" data-header-theme="light">
  <div class="end-inner">
    <div class="dl-end-sym">${SYMBOL('anim-loader')}</div>
    <p class="lp-label">(That's everything)</p>
    <h2 class="end-title">${esc(p.title)}<br><span>delivered by ${esc(studio)}.</span></h2>
    ${canDl ? `<a class="fs-cta" href="${base}/zip">Download all · ${fmtSize(total)}</a>` : ''}
    <p class="end-sub">${p.expires_at ? `Available until ${fmtDate(p.expires_at)}. Save what you need before then.` : 'This link stays live until your creator turns it off.'}</p>
  </div>
  <div class="end-foot"><span class="fs-mono">© ${esc(studio)}</span><a class="dl-made" href="/" aria-label="Made with ContentFlows">Made with <span class="foot-logo">${LOGO}</span></a></div>
</footer>

${canDl ? `<div class="dl-selbar" id="dl-selbar" aria-live="polite">
  <span class="dl-selcount" id="dl-selcount"></span>
  <button type="button" class="dl-selclear" id="dl-selclear">Clear</button>
  <a class="fs-cta" id="dl-seldl" href="${base}/zip" data-base="${base}/zip">Download selected</a>
</div>` : ''}

<div id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Viewer" tabindex="-1">
  <div class="lb-top">
    <span class="lb-count"></span>
    <span class="lb-name"></span>
    <div class="lb-actions"><a class="fs-cta lb-dl" hidden>Download</a><button type="button" class="lb-close" aria-label="Close">Close</button></div>
  </div>
  <button type="button" class="lb-prev" aria-label="Previous"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <div class="lb-stage"></div>
  <button type="button" class="lb-next" aria-label="Next"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</div>
<script>window.CF_ITEMS = ${JSON.stringify(items).replace(/</g, '\\u003c')};</script>` });
}

module.exports = { landing, authForm, dashboard, projectPage, unlockPage, deliveryPage, messagePage, TYPES };
