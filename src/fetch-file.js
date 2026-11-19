// Downloads a file from a public link into a local file, for assistants that add files by URL.
// Only public internet addresses are allowed: every address a name resolves to is checked at the
// moment of connecting (also after each redirect), so a link can't reach this server, the private
// network or the cloud metadata service.
const http = require('http');
const https = require('https');
const dns = require('dns');
const fs = require('fs');
const net = require('net');
const path = require('path');

const blocked = new net.BlockList();
for (const [a, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, bits, 'ipv4');
for (const [a, bits] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(a, bits, 'ipv6');
const isPublic = (address, family) => !blocked.check(address, family === 6 || family === 'IPv6' ? 'ipv6' : 'ipv4');

function lookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const bad = list.find((x) => !isPublic(x.address, x.family));
    if (bad || !list.length) return cb(Object.assign(new Error('That link points to a private address.'), { code: 'EPRIVATE' }));
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

// Share links from Dropbox and Google Drive open a preview page; point them at the file itself.
function directLink(raw) {
  const u = new URL(raw);
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) { u.searchParams.set('dl', '1'); return u.toString(); }
  const drive = u.hostname === 'drive.google.com' && (u.pathname.match(/\/file\/d\/([\w-]+)/) || [])[1];
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive}&export=download&confirm=t`;
  return u.toString();
}

function nameFrom(res, url) {
  const cd = String(res.headers['content-disposition'] || '');
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch (e) {} }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/);
  if (plain) return plain[1].trim();
  try { return decodeURIComponent(path.posix.basename(new URL(url).pathname)); } catch (e) { return ''; }
}

// Resolves to { size, name, type }. maxBytes(contentLength) returns the most bytes this file may
// have; going over it stops the download with err.code 'ETOOBIG'.
// headers: extra request headers (such as a Vault access key). They are only sent to the link's own
// site: a redirect to another site drops them.
function download(raw, dest, { maxBytes, timeoutMs = 10 * 60 * 1000, redirects = 5, headers = {} } = {}) {
  let url;
  try { url = new URL(directLink(raw)); } catch (e) { return Promise.reject(Object.assign(new Error('That is not a valid link.'), { code: 'EBADURL' })); }
  if (!['http:', 'https:'].includes(url.protocol))
    return Promise.reject(Object.assign(new Error('Only http and https links can be added.'), { code: 'EBADURL' }));
  // Node skips the name lookup for addresses written as numbers, so check those here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublic(host, net.isIP(host)))
    return Promise.reject(Object.assign(new Error('That link points to a private address.'), { code: 'EPRIVATE' }));
  if (url.username || url.password)
    return Promise.reject(Object.assign(new Error('Links with a username or password in them are not supported.'), { code: 'EBADURL' }));
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { lookup, timeout: 30000, headers: { 'User-Agent': 'ContentFlows/1.0', Accept: '*/*', ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (!redirects) return reject(Object.assign(new Error('That link redirects too many times.'), { code: 'EREDIRECT' }));
        const next = new URL(res.headers.location, url);
        return resolve(download(next.toString(), dest, { maxBytes, timeoutMs, redirects: redirects - 1, headers: next.origin === url.origin ? headers : {} }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`The link answered with HTTP ${res.statusCode}. Make sure it is public and points to the file itself.`), { code: 'EHTTP' }));
      }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type === 'text/html') {
        res.resume();
        return reject(Object.assign(new Error('That link opens a web page, not a file. Use a direct download link.'), { code: 'EHTML' }));
      }
      const declared = Number(res.headers['content-length']);
      const max = maxBytes(Number.isFinite(declared) ? declared : 0);
      if (Number.isFinite(declared) && declared > max) {
        res.resume();
        return reject(Object.assign(new Error('The file is too big.'), { code: 'ETOOBIG', size: declared }));
      }
      let size = 0, failed = null;
      const out = fs.createWriteStream(dest, { flags: 'wx' });
      let timer;
      const fail = (e) => { if (failed) return; failed = e; clearTimeout(timer); res.destroy(); out.destroy(); fs.rm(dest, { force: true }, () => reject(e)); };
      timer = setTimeout(() => fail(Object.assign(new Error('The download took too long.'), { code: 'ETIMEDOUT' })), timeoutMs);
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > max) fail(Object.assign(new Error('The file is too big.'), { code: 'ETOOBIG', size }));
      });
      res.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => { clearTimeout(timer); if (!failed) resolve({ size, type: type || null, name: nameFrom(res, url.toString()) }); });
      res.on('aborted', () => fail(new Error('The download was cut off.')));
      res.pipe(out);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('The link did not answer in time.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

// Opens a public http(s) address with the same safety checks as download() and resolves to the
// response (status, headers, body stream). No redirects are followed. For small API calls and
// thumbnails; the caller reads or pipes the body.
function open(raw, { headers = {}, timeoutMs = 20000 } = {}) {
  let url;
  try { url = new URL(raw); } catch (e) { return Promise.reject(Object.assign(new Error('That is not a valid address.'), { code: 'EBADURL' })); }
  if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(Object.assign(new Error('Only http and https addresses work.'), { code: 'EBADURL' }));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublic(host, net.isIP(host)))
    return Promise.reject(Object.assign(new Error('That address is private.'), { code: 'EPRIVATE' }));
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { lookup, timeout: timeoutMs, headers: { 'User-Agent': 'ContentFlows/1.0', Accept: '*/*', ...headers } }, resolve);
    req.on('timeout', () => req.destroy(Object.assign(new Error('The address did not answer in time.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

// GET a JSON API with open(). Resolves to { status, body } (body null when it isn't JSON).
async function getJson(raw, opts = {}) {
  const res = await open(raw, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const chunks = [];
  let size = 0;
  for await (const c of res) {
    size += c.length;
    if (size > 5 * 1024 * 1024) { res.destroy(); throw Object.assign(new Error('The answer was too big.'), { code: 'ETOOBIG' }); }
    chunks.push(c);
  }
  let body = null;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
  return { status: res.statusCode, body };
}

module.exports = { download, open, getJson, isPublic };
