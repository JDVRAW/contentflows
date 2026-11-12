const fs = require('fs');
const path = require('path');
const { PLANS } = require('./plans');
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
// Plan sizes are round numbers: "1 TB", not "1.0 TB".
const planSize = (n) => fmtSize(n).replace(/\.0 /, ' ');
const fmtDate = (d) => d ? new Date(d.replace(' ', 'T') + (d.length <= 10 ? '' : 'Z'))
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const TYPES = { photoshoot: 'Photoshoot', music_video: 'Music video', commercial: 'Commercial', film: 'Film', podcast: 'Podcast', project: 'Final project' };

// Marketing header adapted from Antimetal (via Details): logo left, centred links with a
// sliding dot under the hovered link, a two-column mega-menu on "Product", Log in + CTA right.
const BURGER = '<svg class="am-i-open" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" stroke-width="1.4"/></svg><svg class="am-i-close" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.4"/></svg>';
const ARROW = '<svg class="am-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 9.997h8m0 0-2.778-2.667M14 9.997l-2.778 2.667" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const AM_ICONS = {
  quality: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" stroke-width="1.4"/><rect class="ic-acc" x="12.5" y="12.5" width="5" height="5" rx="1.5" fill="#E5402A"/></svg>',
  speed: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19.5h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g class="ic-acc"><path d="M12 15.5V5.5m0 0-4 4m4-4 4 4" stroke="#E5402A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>',
  easy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-.75.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path class="ic-acc" d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l.75-.75" stroke="#E5402A" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
// base: '/' when the header is shown on a page other than the home page, so section links go back home.
// theme: the header's starting text colour ('dark' text for the light home hero, 'light' on dark pages).
function amNav({ base = '', theme = 'dark' } = {}) {
  const rows = [
    { href: `${base}#quality`, icon: 'quality', label: 'Full quality', desc: 'Original files, never compressed' },
    { href: `${base}#speed`, icon: 'speed', label: 'Fast uploads', desc: 'Send a whole shoot in minutes' },
    { href: `${base}#easy`, icon: 'easy', label: 'Easy for clients', desc: 'One link, nothing to install' },
  ];
  const row = (r) => `<a class="am-row" href="${r.href}"><span class="am-ic">${AM_ICONS[r.icon]}</span><span class="am-txt"><b>${r.label}${ARROW}</b><small>${r.desc}</small></span></a>`;
  return `
<header class="am" id="am-header" data-theme="${theme}">
  <div class="am-bar">
    <a class="am-logo header-logo is-brand" href="/" aria-label="ContentFlows home">${LOGO}</a>
    <nav class="am-links" id="am-links" aria-label="Main">
      <button class="am-link" id="am-product" type="button" aria-expanded="false" aria-controls="am-drop">Product</button>
      <a class="am-link" href="${base}#how">How it works</a>
      <a class="am-link" href="${base}#try">Try it</a>
      <a class="am-link" href="${base ? '/pricing' : '#pricing'}">Pricing</a>
      <span class="am-dot" id="am-dot" aria-hidden="true"></span>
      <div class="am-drop" id="am-drop">
        <div class="am-card">
          <div class="am-col"><p class="am-head">Deliver</p>${rows.map(row).join('')}</div>
          <div class="am-col am-col-right"><p class="am-head">Try it</p>
            <a class="am-try" href="${base}#try" tabindex="-1" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><span class="am-try-core">${SYMBOL('')}<em>Drop your files</em></span></a>
            <a class="am-row" href="${base}#try"><span class="am-ic"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/><rect class="ic-acc" x="14" y="14" width="6.5" height="6.5" rx="2" fill="#E5402A"/></svg></span><span class="am-txt"><b>Drop zone${ARROW}</b><small>Drag a shoot onto the page</small></span></a>
          </div>
        </div>
      </div>
    </nav>
    <div class="am-right">
      <a class="am-login" href="/login">Log in</a>
      <a class="am-cta" href="/signup">Start delivering</a>
      <button class="am-burger" id="am-burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="am-mobile">${BURGER}</button>
    </div>
  </div>
  <div class="am-mobile" id="am-mobile" aria-hidden="true">
    <nav class="am-m-links">${rows.map((r) => `<a href="${r.href}">${r.label}</a>`).join('')}<a href="${base}#how">How it works</a><a href="${base}#try">Try it</a><a href="${base ? '/pricing' : '#pricing'}">Pricing</a></nav>
    <div class="am-m-foot"><a class="am-m-login" href="/login">Log in</a><a class="fs-cta" href="/signup">Start delivering</a></div>
  </div>
</header>`;
}

// The home page header for signed-in creators: same bar, sliding dot and mobile drawer,
// with the app's own links (the home page sends signed-in visitors to their deliveries).
function appNav(user, current = '') {
  const links = [{ href: '/dashboard', label: 'Deliveries' }, { href: '/connect', label: 'Connect AI' }, { href: '/pricing', label: 'Plans' }];
  const link = (l, cls) => `<a class="${cls}" href="${l.href}"${l.href === current ? ' aria-current="page"' : ''}>${l.label}</a>`;
  return `
<header class="am" id="am-header" data-theme="light">
  <div class="am-bar">
    <a class="am-logo header-logo is-brand" href="/dashboard" aria-label="ContentFlows deliveries">${LOGO}</a>
    <nav class="am-links" id="am-links" aria-label="Main">${links.map((l) => link(l, 'am-link')).join('')}<span class="am-dot" id="am-dot" aria-hidden="true"></span></nav>
    <div class="am-right">
      <span class="am-studio" title="${esc(user.email)}">${esc(user.studio || user.name)}</span>
      <button class="am-login" type="submit" form="logout-form">Log out</button>
      <a class="am-cta" href="/dashboard#new">New delivery</a>
      <button class="am-burger" id="am-burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="am-mobile">${BURGER}</button>
    </div>
  </div>
  <div class="am-mobile" id="am-mobile" aria-hidden="true">
    <nav class="am-m-links"><a href="/dashboard">Deliveries</a><a href="/dashboard#new">New delivery</a><a href="/connect">Connect AI</a><a href="/pricing">Plans and storage</a></nav>
    <div class="am-m-foot"><button class="am-m-login" type="submit" form="logout-form">Log out</button><a class="fs-cta" href="/dashboard#new">New delivery</a></div>
  </div>
</header>
<form id="logout-form" method="post" action="/logout" hidden></form>`;
}

// Version tag on CSS/JS links so browsers fetch fresh files after every deploy instead of a cached copy.
const ASSET_V = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 8) || Date.now().toString(36);
const asset = (u) => `${u}?v=${ASSET_V}`;

function layout({ title, body, user, header, current, bodyClass = '', scripts = [] }) {
  if (!header && user) header = appNav(user, current);
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
<link rel="stylesheet" href="${asset('/static/styles.css')}">
</head><body class="${bodyClass}${header ? ' has-nav' : ''}">
${header || ''}
${body}
${header ? `<script src="${asset('/static/am-nav.js')}"></script>` : ''}
${scripts.map((s) => `<script src="${asset(s)}"></script>`).join('')}
</body></html>`;
}

// Home page pricing: the case for Pro and Studio, with Free as the way in. Each square in a
// card's picture is 10 GB, the whole Free plan, so the two plans read as 25 and 100 of them.
function homePricing() {
  const { free } = PLANS;
  // Sizes as people read them on the page: 1 TB is 1,000 GB, so Studio is 100 squares, not 102.
  const decimalGB = (b) => (b % 1024 ** 4 === 0 ? (b / 1024 ** 4) * 1000 : b / 1024 ** 3);
  const card = (p, cta) => {
    const n = Math.round(decimalGB(p.limit) / decimalGB(free.limit));
    const squares = Array.from({ length: n }, (_, i) => `<i style="--i:${i}"></i>`).join('');
    return `
      <article class="pcard reveal${p.id === 'pro' ? ' featured' : ''}">
        <div class="pc-vis" aria-hidden="true">
          <div class="pc-cap"><span>${n}× Free</span><span class="pc-key"><i></i>10 GB</span></div>
          <div class="pc-grid">${squares}</div>
        </div>
        <div class="pc-body">
          <h3>${p.name}</h3>
          <p class="pc-line">${esc(p.line)}</p>
          <p class="pc-space"><b>${planSize(p.limit)}</b><span>of storage</span></p>
          <p class="pc-price"><span><b>${dollars(p.month)}</b> / month</span><small>or ${dollars(p.year)} a year, 2 months free</small></p>
          <a class="fs-cta pc-cta${cta}" href="/signup?plan=${p.id}">Start with ${p.name}</a>
        </div>
      </article>`;
  };
  return `<section class="lp lp-dark" data-header-theme="light" id="pricing">
  <div class="lp-inner price-split">
    <div class="price-copy reveal">
      <p class="lp-label">(04) Pricing</p>
      <h2 class="lp-heading">Start free. Upgrade when your work outgrows it.</h2>
      <p class="lp-body">Every studio starts with ${planSize(free.limit)} free. Pro and Studio give you room to keep every shoot and every cut online for your clients. The plans differ only in space, so every feature comes with every plan.</p>
      <ul class="check-list">
        <li>Unlimited deliveries</li>
        <li>Original quality, never compressed</li>
        <li>Passwords, expiry dates and download stats</li>
        <li>Change or cancel anytime</li>
      </ul>
      <p class="price-more">Just starting? <a href="/signup">Start free with ${planSize(free.limit)}</a>, no card needed.<br><a href="/pricing">Compare every plan</a></p>
    </div>
    <div class="price-cards">${card(PLANS.pro, '')}${card(PLANS.studio, ' light')}</div>
  </div>
</section>`;
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

${homePricing()}

<section class="arch" aria-hidden="true"><div class="arch-layer"><img src="/static/arch.jpg" alt="" decoding="async"></div></section>
<footer class="end" data-header-theme="light">
  <div class="end-inner">
    <p class="lp-label">(05) Start delivering</p>
    <h2 class="end-title">Deliver your next project<br><span>the way it deserves.</span></h2>
    <p class="end-sub">Create your studio in under a minute. Send your first delivery today.</p>
    <a class="fs-cta" href="/signup">Start delivering</a>
    <div class="end-rule"></div>
    <nav class="end-links" aria-label="Footer"><a href="/signup">Sign up</a><a href="/login">Log in</a><a href="#why">Why us</a><a href="#how">How it works</a><a href="#pricing">Pricing</a></nav>
  </div>
  <div class="end-foot"><a class="foot-logo" href="/" aria-label="ContentFlows home">${LOGO}</a><span class="fs-mono">Final work delivery for creatives</span></div>
</footer>` });
}

// plan: a paid plan picked on the home page. It rides along through sign up or log in, then
// the creator lands on the plans page to choose monthly or yearly.
function authForm({ mode, error, values = {}, plan }) {
  const signup = mode === 'signup';
  const picked = PLANS[plan] && plan !== 'free' ? PLANS[plan] : null;
  const q = picked ? `?plan=${picked.id}` : '';
  return layout({ title: signup ? 'Sign up' : 'Log in', bodyClass: 'auth', body: `
<main class="auth-card">
  <a class="brand" href="/" aria-label="ContentFlows home">${LOGO}</a>
  <h1>${signup ? 'Create your studio' : 'Welcome back'}</h1>
  ${picked ? `<p class="muted">${signup ? 'Next' : 'After you log in'}, choose monthly or yearly billing for ${picked.name}.</p>` : ''}
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/${mode}">${picked ? `<input type="hidden" name="plan" value="${picked.id}">` : ''}
    ${signup ? `<label>Your name<input name="name" required value="${esc(values.name)}"></label>
    <label>Studio name <span class="muted">(shown to clients)</span><input name="studio" value="${esc(values.studio)}"></label>` : ''}
    <label>Email<input type="email" name="email" required value="${esc(values.email)}"></label>
    <label>Password<input type="password" name="password" required minlength="${signup ? 8 : 1}"></label>
    <button class="btn block">${signup ? 'Create account' : 'Log in'}</button>
  </form>
  <p class="muted center">${signup ? `Already have an account? <a href="/login${q}">Log in</a>` : `New here? <a href="/signup${q}">Create an account</a>`}</p>
</main>` });
}

// How much of the creator's plan is in use: a bar, the numbers, and what to do when it's nearly full.
function storageMeter({ used, plan }, { compact = false } = {}) {
  if (plan.limit === Infinity) {
    return `<div class="meter${compact ? ' compact' : ''}"><div class="meter-top"><span><b>${fmtSize(used)}</b> stored</span><span class="muted small">Owner account · no storage limit</span></div></div>`;
  }
  const pct = Math.min(100, (used / plan.limit) * 100);
  const state = used >= plan.limit ? ' over' : pct >= 85 ? ' near' : '';
  const note = used > plan.limit ? `You're over your ${plan.name} plan by ${fmtSize(used - plan.limit)}. New uploads are paused until you upgrade or delete files.`
    : used === plan.limit ? `Your ${plan.name} plan is full. Upgrade or delete files to keep uploading.`
    : pct >= 85 ? `${fmtSize(plan.limit - used)} left on your ${plan.name} plan.` : '';
  return `<div class="meter${state}${compact ? ' compact' : ''}">
    <div class="meter-top"><span><b>${fmtSize(used)}</b> of ${planSize(plan.limit)} used</span>
      <span class="muted small">${esc(plan.name)} plan · <a href="/pricing">${plan.id === 'studio' ? 'Plans' : 'Get more space'}</a></span></div>
    <div class="meter-bar" role="meter" aria-label="Storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}"><i style="width:${Math.max(pct, used > 0 ? 1 : 0).toFixed(2)}%"></i></div>
    ${note ? `<p class="meter-note small">${note}</p>` : ''}
  </div>`;
}

function dashboard({ user, projects, usage }) {
  return layout({ title: 'Deliveries', user, current: '/dashboard', body: `
<main class="wrap">
  <div class="page-head"><div><h1>Deliveries</h1><p class="muted">${projects.length} project${projects.length === 1 ? '' : 's'}</p></div>
  <a class="btn" href="#new">New delivery</a></div>
  ${usage ? storageMeter(usage) : ''}
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

// Files grouped by the folder they were uploaded in: loose files first, then each folder in the
// order its first file arrived. Folder paths show as "BTS / Raw".
// Folders listed in `keep` (made by hand on the project page) show even while empty.
// `order` is the creator's chosen folder order; folders not in it follow, in upload order.
function byFolder(assets, keep = [], order = []) {
  const groups = new Map([['', []]]);
  for (const a of assets) {
    const f = a.folder || '';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(a);
  }
  // Files in a folder upload a few at a time and land out of order, so they're sorted by name like on the uploader's computer.
  const byName = (a, b) => a.original_name.localeCompare(b.original_name, undefined, { numeric: true, sensitivity: 'base' });
  for (const f of keep) if (!groups.has(f)) groups.set(f, []);
  const rank = (f) => (f === '' ? -1 : order.includes(f) ? order.indexOf(f) : Infinity);
  return [...groups].filter(([folder, items]) => items.length || (folder && keep.includes(folder)))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([folder, items]) => ({ folder, label: folder.split('/').join(' / '), items: folder ? items.sort(byName) : items }));
}
const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FOLDER_ICON = '<svg class="folder-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

function projectPage({ user, project: p, assets, folders = [], collapsed = [], folderLinks = {}, folderOrder = [], stats, origin, saved, notice, direct, storageMissing, usage }) {
  const link = `${origin}/d/${p.share_token}`;
  const left = usage && usage.plan.limit !== Infinity ? usage.plan.limit - usage.used : null;
  return layout({ title: p.title, user, current: '/dashboard', scripts: ['/static/spiral.js', '/static/upload.js', '/static/files.js'], body: `
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
    <div id="drop" class="drop has-spiral" data-project="${p.id}"${direct ? ' data-direct="1"' : ''} data-spiral-host>
      <div class="spiral" data-spiral data-count="22" data-size=".75" aria-hidden="true"><div class="spiral-world"></div></div>
      <div class="drop-body">
        <input type="file" id="file-input" multiple hidden>
        <input type="file" id="folder-input" webkitdirectory multiple hidden>
        <p><b>Drop files or folders here</b> or browse <button class="link" type="button" onclick="document.getElementById('file-input').click()">files</button> · <button class="link" type="button" onclick="document.getElementById('folder-input').click()">a folder</button></p>
        <p class="muted small">Photos, videos, audio, or any final files${direct ? ' · sent straight to cloud storage' : ''}${left > 0 ? ` · ${fmtSize(left)} left on your plan` : ''}</p>
        ${left !== null && left <= 0 ? `<p class="q-error">Your ${esc(usage.plan.name)} plan is full, so new files can't be added. <a href="/pricing">See plans</a> or delete files you no longer need.</p>` : ''}
        ${storageMissing ? `<p class="q-error">Cloud storage is off because ${esc(storageMissing.join(', '))} ${storageMissing.length === 1 ? 'is' : 'are'} not set in the server's variables.</p>` : ''}
        <div class="uploading" id="uploading" hidden>${SYMBOL('anim-loader')}<span id="uploading-text">Uploading</span></div>
        <div id="queue"></div>
      </div>
    </div>
  </section>

  <section id="files" data-base="/projects/${p.id}">
    <div class="files-head">
      <h2>Files <span class="muted">${assets.length}</span></h2>
      <div class="files-tools">
        ${folders.length || assets.some((a) => a.folder) ? '<button class="btn ghost small" type="button" data-fold-all>Close all</button>' : ''}
        ${assets.length ? '<button class="btn ghost small" type="button" data-select-all>Select all</button>' : ''}
        <form method="post" action="/projects/${p.id}/folders" class="new-folder">
          <input name="name" placeholder="New folder name" maxlength="100" required aria-label="New folder name">
          <button class="btn ghost small">${FOLDER_ICON}Create folder</button>
        </form>
      </div>
    </div>
    ${notice ? `<p class="ok files-notice">${esc(notice)}</p>` : ''}
    ${(() => {
      const groups = byFolder(assets, folders, folderOrder);
      if (!groups.length) return '<p class="muted">No files uploaded yet.</p>';
      const anyFolder = groups.some((g) => g.folder);
      // With folders around, "No folder" always shows so files can be dragged back out.
      if (anyFolder && groups[0].folder) groups.unshift({ folder: '', label: '', items: [] });
      return groups.map((g) => { const shut = (g.folder || anyFolder) && collapsed.includes(g.folder); return `<div class="file-group${shut ? ' collapsed' : ''}" data-folder="${esc(g.folder)}">
      ${g.folder || anyFolder ? `<div class="folder-head">
        <button type="button" class="fold" aria-expanded="${shut ? 'false' : 'true'}" aria-label="${shut ? 'Open' : 'Close'} ${esc(g.label || 'No folder')}" title="Open or close this folder">${CHEVRON}</button>
        ${g.items.length ? `<input type="checkbox" class="pick-group" aria-label="Select every file in ${esc(g.label || 'No folder')}">` : ''}
        ${g.folder ? FOLDER_ICON : ''}<b class="fold-name">${esc(g.label || 'No folder')}</b> <span class="muted">${g.items.length}</span>
        ${g.folder ? `<form method="post" action="/projects/${p.id}/folders/rename" class="folder-rename" hidden>
          <input type="hidden" name="folder" value="${esc(g.folder)}">
          <input name="name" value="${esc(g.folder.split('/').pop())}" maxlength="100" required aria-label="New name for ${esc(g.label)}">
          <button class="btn small">Save</button><button class="link small" type="button" data-rename-cancel>Cancel</button>
        </form>` : ''}
        ${g.folder ? `<div class="folder-actions">
        <span class="folder-order">${['up', 'down'].map((d) => `<form method="post" action="/projects/${p.id}/folders/order"><input type="hidden" name="folder" value="${esc(g.folder)}"><input type="hidden" name="dir" value="${d}"><button class="order-btn" title="Move folder ${d}" aria-label="Move ${esc(g.label)} ${d}"${(d === 'up' ? g === groups.find((x) => x.folder) : g === groups[groups.length - 1]) ? ' disabled' : ''}>${d === 'up' ? '↑' : '↓'}</button></form>`).join('')}</span>
        <button class="link small" type="button" data-rename>Rename</button>
        ${folderLinks[g.folder] ? '' : `<form method="post" action="/projects/${p.id}/folders/link"><input type="hidden" name="folder" value="${esc(g.folder)}"><button class="link small" title="A link that opens only this folder">Share this folder</button></form>`}
        <form method="post" action="/projects/${p.id}/folders/remove" class="folder-remove"${confirmAttr(g.items.length
          ? `Remove the folder “${g.label}”? Its ${g.items.length} file${g.items.length === 1 ? '' : 's'} stay in the delivery and move up a level.`
          : `Remove the empty folder “${g.label}”?`)}><input type="hidden" name="folder" value="${esc(g.folder)}"><button class="link small">Remove folder</button></form></div>` : ''}
      </div>` : ''}
      ${g.folder && folderLinks[g.folder] ? (() => { const id = `folder-link-${esc(folderLinks[g.folder])}`; return `<div class="folder-link">
        <span class="small muted">Folder link · only shows this folder</span>
        <div class="copy"><input readonly id="${id}" value="${esc(`${origin}/d/${folderLinks[g.folder]}`)}"><button class="btn small" type="button" data-copy="#${id}">Copy</button></div>
        <a class="link small" href="/d/${esc(folderLinks[g.folder])}" target="_blank">Preview</a>
        <form method="post" action="/projects/${p.id}/folders/link"${confirmAttr(`Turn off the link for “${g.label}”? Anyone who has it will no longer be able to open it.`)}><input type="hidden" name="folder" value="${esc(g.folder)}"><input type="hidden" name="on" value="0"><button class="link small danger">Turn off link</button></form>
      </div>`; })() : ''}
      ${g.items.length ? `<div class="asset-grid">${g.items.map((a) => `
      <div class="asset" data-id="${a.id}" draggable="true">
        <label class="pick" title="Select"><input type="checkbox" name="ids" value="${a.id}" form="bulk" aria-label="Select ${esc(a.original_name)}"></label>
        <div class="thumb">${a.thumb_name ? `<img loading="lazy" draggable="false" src="/d/${p.share_token}/thumb/${a.id}" alt="">` : `<div class="file-icon">${esc((a.original_name.split('.').pop() || 'file').toUpperCase())}</div>`}
        ${a.kind === 'video' ? '<span class="badge">▶ Video</span>' : ''}${p.cover_asset_id === a.id ? '<span class="badge left">Cover</span>' : ''}</div>
        <div class="asset-meta"><span title="${esc(a.original_name)}">${esc(a.original_name)}</span><span class="muted small">${fmtSize(a.size)} · ${a.downloads} dl</span></div>
        <div class="asset-actions">
          ${a.thumb_name || a.kind === 'video' ? `<form method="post" action="/projects/${p.id}/cover/${a.id}"><button class="link small">Set cover</button></form>` : ''}
          <form method="post" action="/projects/${p.id}/assets/${a.id}/delete" onsubmit="return confirm('Delete this file?')"><button class="link small danger">Delete</button></form>
        </div>
      </div>`).join('')}</div>` : `<div class="folder-empty">${g.folder ? 'Empty folder. Drag files here, or select files and choose Move.' : 'Every file is in a folder. Drag files here to take them out.'}</div>`}
    </div>`; }).join('');
    })()}
    ${assets.length ? `<form method="post" action="/projects/${p.id}/assets/move" id="bulk" class="bulk-bar" hidden>
      <span class="bulk-count" data-count>0 selected</span>
      <label class="bulk-move">Move to
        <select name="folder">
          <option value="">No folder</option>
          ${[...new Set([...byFolder(assets, folders, folderOrder).map((g) => g.folder).filter(Boolean)])].map((f) => `<option value="${esc(f)}">${esc(f.split('/').join(' / '))}</option>`).join('')}
          <option value="__new">New folder…</option>
        </select>
      </label>
      <input name="new_folder" placeholder="Folder name" maxlength="100" hidden aria-label="New folder name">
      <button class="btn small">Move</button>
      <button class="btn ghost small danger" formaction="/projects/${p.id}/assets/delete" data-delete>Delete</button>
      <button class="link small" type="button" data-clear>Clear</button>
    </form>` : ''}
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

const fmtUnix = (t) => t ? new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const dollars = (cents) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
// Text for an inline onsubmit="return confirm('…')": quotes escaped for JS first, then the whole thing for HTML.
const confirmAttr = (text) => ` onsubmit="return confirm(${esc(JSON.stringify(text))})"`;

// Plans page: three plans, a monthly/yearly switch (pure CSS), the creator's usage, and the
// right button on each plan for where they are now (sign up, upgrade, switch, cancel, keep).
function pricingPage({ user, usage, plans, billingOn, subscribed, notice = {} }) {
  const cur = user ? (subscribed ? user.plan : 'free') : null;
  const curIv = subscribed ? user.plan_interval : null;
  const ending = subscribed && !!user.plan_cancel_at_end;
  const ends = user ? fmtUnix(user.plan_period_end) : '';
  const startIv = curIv === 'year' ? 'year' : 'month';
  const curName = plans[cur]?.name || 'Free';

  const disabled = (label) => `<button class="btn ghost block" disabled>${label}</button>`;
  const post = (action, label, { cls = 'btn block', fields = {}, confirm } = {}) =>
    `<form method="post" action="${action}"${confirm ? confirmAttr(confirm) : ''}>${Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}<button class="${cls}">${label}</button></form>`;

  function action(p, iv) {
    if (!user) return p.id === 'free' ? '<a class="btn ghost block" href="/signup">Start free</a>' : `<a class="btn block" href="/signup">Start with ${p.name}</a>`;
    if (p.id === 'free') {
      if (cur === 'free') return disabled('Current plan');
      if (ending) return `<p class="plan-note">You move to Free on ${ends}.</p>`;
      return post('/billing/cancel', 'Switch to Free', { cls: 'btn ghost block', confirm: `Cancel your ${curName} plan? You keep its space until ${ends}, then move to Free.` });
    }
    if (!billingOn) return disabled('Available soon');
    if (p.id === cur && iv === curIv) return ending ? post('/billing/resume', `Keep ${p.name}`) : disabled('Current plan');
    if (usage && usage.used > p.limit) return `${disabled(`Switch to ${p.name}`)}<p class="plan-note">You're storing ${fmtSize(usage.used)}, more than ${p.name} holds.</p>`;
    const label = p.id === cur ? `Switch to ${iv === 'year' ? 'yearly' : 'monthly'}`
      : !subscribed || p.limit > plans[cur].limit ? `Upgrade to ${p.name}` : `Switch to ${p.name}`;
    // A live subscription changes on the spot (no Stripe page), so say what will happen first.
    const pays = p.limit > plans[cur].limit || (p.id === cur && iv === 'year');
    const confirm = subscribed ? `Switch to ${p.name} at ${dollars(p[iv])} a ${iv}? ${pays ? 'You pay the difference today with the card on file.' : 'The difference is credited to your next bill.'}` : null;
    return post('/billing/checkout', label, { fields: { plan: p.id, interval: iv }, confirm });
  }

  const card = (p) => `
    <article class="plan${p.id === cur ? ' current' : ''}${p.id === (picked ? picked.id : 'pro') ? ' featured' : ''}">
      <div class="plan-top"><h2>${p.name}</h2>${p.id === cur ? '<span class="tag">Your plan</span>' : ''}</div>
      <p class="muted small plan-line">${esc(p.line)}</p>
      <p class="plan-space"><b>${planSize(p.limit)}</b> of storage</p>
      <p class="plan-price">${p.month ? `<span class="iv-month"><b>${dollars(p.month)}</b> / month</span><span class="iv-year"><b>${dollars(p.year)}</b> / year <small>${dollars(p.year / 12)} a month</small></span>` : '<b>$0</b> <small>forever</small>'}</p>
      <div class="plan-action"><div class="iv-month">${action(p, 'month')}</div><div class="iv-year">${action(p, 'year')}</div></div>
    </article>`;

  const messages = [];
  const picked = user && billingOn && !subscribed && ['pro', 'studio'].includes(notice.plan) ? plans[notice.plan] : null;
  if (picked) messages.push(`Choose monthly or yearly below to start ${picked.name}.`);
  if (user && notice.welcome) messages.push(subscribed ? `You're on ${curName} now. Your new space is ready.` : 'Thanks! Your payment is being confirmed. Refresh in a moment to see your new plan.');
  if (user && notice.changed && subscribed) messages.push(`Your plan is now ${curName}, billed ${curIv === 'year' ? 'yearly' : 'monthly'}.`);
  if (user && notice.canceled && ending) messages.push(`Your ${curName} plan ends on ${ends}. You keep its space until then.`);
  if (user && notice.resumed && subscribed && !ending) messages.push(`Your ${curName} plan will keep renewing.`);
  if (user && notice.toosmall && plans[notice.toosmall]) messages.push(`You're storing more than ${plans[notice.toosmall].name} holds. Delete some files first, then switch.`);
  const pastDue = subscribed && user.plan_status === 'past_due';

  return layout({
    title: 'Plans', user, current: '/pricing', bodyClass: user ? '' : 'pricing-public', header: user ? null : amNav({ base: '/', theme: 'light' }), body: `
<main class="wrap pricing" data-header-theme="light">
  <div class="pricing-head">
    <p class="eyebrow">Plans</p>
    <h1>Room for every delivery</h1>
    <p class="lede">Every plan includes unlimited deliveries and full-quality files. Plans differ only in how much you keep stored.</p>
  </div>
  ${messages.map((m) => `<p class="notice">${esc(m)}</p>`).join('')}
  ${pastDue ? `<p class="error">Your last payment didn't go through. Update your card under Manage billing to keep your ${esc(curName)} plan.</p>` : ''}
  ${usage ? storageMeter(usage) : ''}
  <div class="iv-toggle" role="radiogroup" aria-label="Billing period">
    <label><input type="radio" name="iv" id="iv-month" value="month"${startIv === 'month' ? ' checked' : ''}>Monthly</label>
    <label><input type="radio" name="iv" id="iv-year" value="year"${startIv === 'year' ? ' checked' : ''}>Yearly <span>2 months free</span></label>
  </div>
  <div class="plans">${Object.values(plans).map(card).join('')}</div>
  <p class="plans-all muted small">Every plan: unlimited deliveries · original quality · password and expiry on links · view and download stats · Download all</p>
  ${user && billingOn && user.stripe_customer_id ? `<div class="billing-manage"><span class="muted small">Update your card or download invoices</span>${post('/billing/portal', 'Manage billing', { cls: 'btn ghost small' })}</div>` : ''}
  ${user && !billingOn ? '<p class="muted small center">Paid plans open as soon as payments are connected.</p>' : ''}
  <section class="faq">
    <h2>Questions</h2>
    <details><summary>What counts toward my storage?</summary><p>The files you keep in your deliveries. Deleting a file or a whole delivery frees its space right away.</p></details>
    <details><summary>What happens if I go over?</summary><p>Nothing is deleted and your links keep working. New uploads pause until you upgrade or free up space.</p></details>
    <details><summary>Can I change or cancel anytime?</summary><p>Yes. Upgrades apply right away and you only pay the difference. If you cancel, you keep your plan until the end of the period you paid for, then move to Free.</p></details>
    <details><summary>Who handles payments?</summary><p>Stripe. Your card details go straight to Stripe and never touch ContentFlows.</p></details>
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

// Connect AI: API keys for the MCP server (/mcp), and how to add ContentFlows to an assistant.
// fresh: a key just made, shown this once with its connector address.
function connectPage({ user, keys, origin, fresh, error }) {
  const exampleUrl = fresh ? fresh.url : `${origin}/mcp/cf_your-key`;
  return layout({ title: 'Connect AI', user, current: '/connect', scripts: ['/static/upload.js'], body: `
<main class="wrap connect">
  <div class="page-head"><div><h1>Connect AI</h1>
  <p class="muted">Let Claude or another AI assistant create deliveries, add files from links and send you the share link, just by asking.</p></div></div>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  ${fresh ? `<section class="share key-fresh">
    <div><h3>Your connector address for ${esc(fresh.name)}</h3><p class="muted small">Copy it now: it won't be shown again. Anyone with it can manage your deliveries, so keep it private.</p></div>
    <div class="copy"><input readonly value="${esc(fresh.url)}" id="mcp-url"><button class="btn" type="button" data-copy="#mcp-url">Copy</button></div>
    <div class="copy"><input readonly value="${esc(fresh.key)}" id="mcp-key" aria-label="API key on its own"><button class="btn ghost" type="button" data-copy="#mcp-key">Copy key</button></div>
  </section>` : ''}

  <section class="settings">
    <h2>API keys</h2>
    <form method="post" action="/connect/keys" class="key-form">
      <label>Name <span class="muted">(where you'll use it)</span><input name="name" maxlength="80" placeholder="Claude"></label>
      <button class="btn">Make a key</button>
    </form>
    ${keys.length ? `<div class="key-list">${keys.map((k) => `
      <div class="key-row"><div><b>${esc(k.name)}</b> <span class="muted small mono">cf_…${esc(k.hint)}</span>
        <p class="muted small">Made ${fmtDate(k.created_at)} · ${k.last_used_at ? `last used ${fmtDate(k.last_used_at)}` : 'not used yet'}</p></div>
        <form method="post" action="/connect/keys/${k.id}/delete"${confirmAttr(`Revoke "${k.name}"? Assistants using it will lose access right away.`)}><button class="btn ghost danger">Revoke</button></form>
      </div>`).join('')}</div>` : '<p class="muted">No keys yet.</p>'}
  </section>

  <section class="connect-how">
    <h2>Add it to your assistant</h2>
    <div class="how-grid">
      <div class="how-card"><h3>Claude (web, desktop, phone)</h3>
        <ol><li>Open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
        <li>Name it ContentFlows and paste your connector address as the URL.</li>
        <li>In a chat, turn on ContentFlows and ask away.</li></ol></div>
      <div class="how-card"><h3>Claude Code</h3>
        <pre><code>claude mcp add --transport http contentflows ${esc(exampleUrl)}</code></pre></div>
      <div class="how-card"><h3>Other apps (Cursor, ChatGPT, …)</h3>
        <p class="muted small">Add a remote MCP server with the connector address. Apps that take headers can use <code>${esc(origin)}/mcp</code> with <code>Authorization: Bearer &lt;key&gt;</code> instead.</p></div>
    </div>
    <h3>Things to ask</h3>
    <ul class="muted">
      <li>"Create a photoshoot delivery for Ana López, add the photos from this Dropbox link, and give me the link."</li>
      <li>"Put a password on the Nike commercial delivery and make it expire at the end of the month."</li>
      <li>"Which deliveries haven't been downloaded yet?"</li>
    </ul>
  </section>
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

function deliveryPage({ project: p, assets, studio, host = '', folderOrder = [] }) {
  const base = `/d/${p.share_token}`;
  const canDl = !!p.allow_download && assets.length > 0;
  // A video can be the cover even before it has a poster frame: the hero just plays it.
  const usable = (a) => a.thumb_name || a.kind === 'video';
  const cover = assets.find((a) => a.id === p.cover_asset_id && usable(a)) || assets.find((a) => a.thumb_name) || assets.find(usable);
  const isVisual = (a) => a.kind === 'image' || a.kind === 'video';
  const visualGroups = byFolder(assets.filter(isVisual), [], folderOrder);
  const otherGroups = byFolder(assets.filter((a) => !isVisual(a)), [], folderOrder);
  const visual = visualGroups.flatMap((g) => g.items);
  const folderZip = (g) => (canDl && g.folder ? `<a class="dl-folder-dl" href="${base}/zip?folder=${encodeURIComponent(g.folder)}">${DL_ICON}<span>Download folder</span></a>` : '');
  // The arrow (or the folder's name) folds a folder shut; the client's browser remembers it.
  const folderHead = (g, tag) => (g.folder ? `<${tag} class="dl-folder"><button type="button" class="dl-fold" aria-expanded="true" aria-label="Close ${esc(g.label)}" title="Open or close this folder">${CHEVRON}</button>${FOLDER_ICON}<b class="dl-fold-name">${esc(g.label)}</b><em>${g.items.length}</em>${folderZip(g)}</${tag}>` : '');
  const photos = visual.filter((a) => a.kind === 'image').length;
  const films = visual.length - photos;
  const others = otherGroups.flatMap((g) => g.items);
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
    ? `<video class="fs-media" src="${base}/media/${cover.id}"${cover.thumb_name ? ` poster="${base}/thumb/${cover.id}"` : ''} autoplay muted loop playsinline preload="metadata"></video>`
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
      ${(() => { let i = 0; return visualGroups.map((g) => `<div class="dl-group" data-folder="${esc(g.folder)}">${folderHead(g, 'div')}<div class="dl-grid">${g.items.map((a) => `
        <figure class="dl-tile ${a.kind}" data-index="${i++}" data-id="${a.id}" data-kind="${a.kind}" data-size="${a.size}" tabindex="0" aria-label="Open ${esc(a.original_name)}">
          ${a.thumb_name ? `<img loading="lazy" src="${base}/thumb/${a.id}" alt="">` : `<div class="dl-noimg">${ext(a.original_name)}</div>`}
          ${a.kind === 'video' ? '<span class="dl-play" aria-hidden="true"></span>' : ''}
          ${canDl ? `<button type="button" class="dl-check" aria-pressed="false" aria-label="Select ${esc(a.original_name)}"></button>` : ''}
          <figcaption><span>${esc(a.original_name)}</span>${canDl ? `<a class="dl-down" href="${base}/download/${a.id}" aria-label="Download ${esc(a.original_name)}">${DL_ICON}</a>` : ''}</figcaption>
        </figure>`).join('')}</div></div>`).join(''); })()}
    </div>
  </div>
</section>` : ''}

${others.length ? `<section class="lp lp-light dl-files" id="files" data-header-theme="dark">
  <div class="lp-inner">
    <p class="lp-label">(${visual.length ? '02' : '01'}) Files</p>
    ${otherGroups.map((g) => `<div class="dl-fgroup" data-folder="${esc(g.folder)}">${folderHead(g, 'div')}<ul class="dl-list">${g.items.map((a) => `
      <li class="dl-file">
        <span class="dl-ext">${ext(a.original_name)}</span>
        <div class="dl-meta"><b>${esc(a.original_name)}</b><small>${a.kind === 'audio' ? 'Audio' : 'File'} · ${fmtSize(a.size)}</small></div>
        ${a.kind === 'audio' ? `<div class="dl-player" data-src="${base}/media/${a.id}"><button type="button" class="dl-pp" aria-label="Play ${esc(a.original_name)}"><i></i></button><div class="dl-track"><i></i></div><span class="dl-time">0:00</span></div>` : '<span class="dl-spacer"></span>'}
        ${p.allow_download ? `<a class="dl-btn" href="${base}/download/${a.id}">${DL_ICON}<span>Download</span></a>` : ''}
      </li>`).join('')}</ul></div>`).join('')}
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

module.exports = { byFolder, landing, authForm, dashboard, projectPage, connectPage, unlockPage, deliveryPage, messagePage, pricingPage, fmtSize, TYPES };
