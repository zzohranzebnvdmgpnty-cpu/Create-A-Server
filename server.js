// Server Creator — open any website through this server.
// The website you open sees THIS server's IP address and country, not yours.
// Deploy this server in the country you want (e.g. a UAE data center) and
// every site you open through it will think you are browsing from there.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { fetch, Agent, ProxyAgent } = require('undici');

const PORT = Number(process.env.PORT) || 3000;
// Optional: send all traffic out through another proxy (e.g. a UAE proxy):
//   UPSTREAM_PROXY=http://user:pass@uae-proxy.example.com:8080
const UPSTREAM_PROXY = process.env.UPSTREAM_PROXY || '';
// Optional: protect your server with a password (strongly recommended when public).
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || '';
// For local testing only: allow opening localhost / private network addresses.
const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === '1';

const dispatcher = UPSTREAM_PROXY ? new ProxyAgent(UPSTREAM_PROXY) : new Agent();
const PREFIX = '/p/';
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

// ---------------------------------------------------------------------------
// Safety: never let the proxy reach private / internal addresses (SSRF).
// ---------------------------------------------------------------------------
const blocked = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3],
]) blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]])
  blocked.addSubnet(addr, bits, 'ipv6');

async function assertPublicHost(hostname) {
  if (ALLOW_PRIVATE_HOSTS) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new Error('Private/internal addresses are not allowed');
  // With an upstream proxy, DNS is resolved by that proxy, so only literal IPs can be checked here.
  if (UPSTREAM_PROXY && !net.isIP(host)) return;
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  for (const { address, family } of addrs) {
    let a = address, f = family === 6 ? 'ipv6' : 'ipv4';
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) { a = mapped[1]; f = 'ipv4'; }
    if (blocked.check(a, f)) throw new Error('Private/internal addresses are not allowed');
  }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
function normalizeInput(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    // Looks like a domain? otherwise treat it as a search.
    s = /^[^\s/]+\.[^\s/]+/.test(s) ? 'https://' + s : 'https://duckduckgo.com/html/?q=' + encodeURIComponent(s);
  }
  try { return new URL(s).href; } catch { return null; }
}

function proxify(raw, base) {
  if (raw == null) return raw;
  let s = String(raw).trim().replace(/&amp;/g, '&');
  if (!s || s.startsWith('#') || /^(data|blob|javascript|mailto|tel|about|sms):/i.test(s)) return raw;
  if (s.startsWith(PREFIX)) return s;
  try {
    const u = new URL(s, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
    return PREFIX + u.href;
  } catch { return raw; }
}

function rewriteCss(css, base) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${proxify(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${proxify(u, base)}${q}`);
}

function clientScript(base) {
  // Runs inside proxied pages: routes fetch / XHR / window.open through the proxy.
  return `<script>(function(){var P=${JSON.stringify(PREFIX)},B=${JSON.stringify(base)};
function r(u){try{var s=String(u);if(/^(data|blob|javascript|about):/i.test(s))return s;
if(s.indexOf(location.origin)===0)s=s.slice(location.origin.length)||'/';
if(s.indexOf(P)===0)return s;var n=new URL(s,B);if(!/^https?:$/.test(n.protocol))return u;return P+n.href}catch(e){return u}}
var F=window.fetch;if(F)window.fetch=function(i,o){try{if(typeof Request!=='undefined'&&i instanceof Request){i=new Request(r(i.url),i)}else{i=r(i)}}catch(e){}return F.call(this,i,o)};
var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=r(u);return X.apply(this,arguments)};
var W=window.open;window.open=function(u){if(u)arguments[0]=r(u);return W.apply(this,arguments)};
})();</script>`;
}

function toolbar(target) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div id="__sc_bar" style="all:initial;position:fixed;z-index:2147483647;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;background:#111827;color:#fff;font:13px system-ui,sans-serif;padding:6px 8px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:calc(100vw - 16px)">
<a href="/" style="all:initial;color:#60a5fa;font:600 13px system-ui,sans-serif;cursor:pointer">Server Creator</a>
<form action="/go" method="get" style="all:initial;display:flex;gap:4px"><input name="url" value="${esc(target)}" style="all:initial;background:#1f2937;color:#fff;font:13px system-ui,sans-serif;padding:4px 6px;border-radius:6px;width:min(320px,50vw)"><button style="all:initial;background:#2563eb;color:#fff;font:13px system-ui,sans-serif;padding:4px 10px;border-radius:6px;cursor:pointer">Go</button></form>
<button onclick="this.parentNode.remove()" style="all:initial;color:#9ca3af;cursor:pointer;font:16px system-ui,sans-serif;padding:0 4px">×</button></div>`;
}

function rewriteHtml(html, base) {
  let out = html
    .replace(/\s(integrity|nonce)\s*=\s*(["'])[^"']*\2/gi, '')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '')
    .replace(/(\s(?:href|src|action|poster|data-src|formaction)\s*=\s*)(["'])([^"']*)\2/gi,
      (m, attr, q, u) => `${attr}${q}${proxify(u, base)}${q}`)
    .replace(/(\s(?:srcset|data-srcset)\s*=\s*)(["'])([^"']*)\2/gi, (m, attr, q, v) =>
      `${attr}${q}${v.split(',').map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return [proxify(u, base), ...rest].join(' ');
      }).join(', ')}${q}`)
    .replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, css) => `<style${a}>${rewriteCss(css, base)}</style>`)
    .replace(/(\sstyle\s*=\s*)(["'])([^"']*)\2/gi, (m, attr, q, css) => `${attr}${q}${rewriteCss(css, base)}${q}`);

  const inject = clientScript(base);
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (h) => h + inject) : inject + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, toolbar(base) + '</body>') : out + toolbar(base);
  return out;
}

function rewriteSetCookie(cookie, target, secureClient) {
  const parts = cookie.split(';').map((p) => p.trim()).filter((p) => {
    const k = p.split('=')[0].toLowerCase();
    if (k === 'domain' || k === 'path') return false;
    if (k === 'secure' && !secureClient) return false;
    if (k === 'samesite' && !secureClient) return false;
    return true;
  });
  parts.push(`Path=${PREFIX}${target.origin}/`);
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('Request body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendError(res, status, message) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:system-ui;padding:24px;background:#0b1020;color:#e5e7eb">
<h2>Could not open this page</h2><p>${String(message).replace(/[<>&]/g, '')}</p><p><a style="color:#60a5fa" href="/">← Back to Server Creator</a></p>`);
}

async function proxyRequest(req, res, targetStr) {
  let target;
  try {
    // Some browsers collapse "https://" into "https:/" inside paths.
    target = new URL(targetStr.replace(/^(https?):\/(?!\/)/i, '$1://'));
    if (!/^https?:$/.test(target.protocol)) throw new Error('Only http and https are supported');
  } catch {
    return sendError(res, 400, 'Invalid URL: ' + targetStr);
  }

  try {
    await assertPublicHost(target.hostname);
  } catch (e) {
    if (e.code === 'ENOTFOUND') return sendError(res, 502, `Website not found: ${target.hostname}`);
    return sendError(res, 403, e.message);
  }

  const headers = {};
  for (const h of ['accept', 'accept-language', 'content-type', 'user-agent', 'range', 'cookie', 'if-none-match', 'if-modified-since', 'cache-control']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  if (req.headers.referer) {
    const m = req.headers.referer.match(/\/p\/(https?:\/\/.*)$/i);
    if (m) headers.referer = m[1];
  }
  if (req.headers.origin && headers.referer) {
    try { headers.origin = new URL(headers.referer).origin; } catch {}
  }

  let body;
  if (!['GET', 'HEAD'].includes(req.method)) body = await readBody(req);

  let upstream;
  try {
    upstream = await fetch(target.href, { method: req.method, headers, body, redirect: 'manual', dispatcher });
  } catch (e) {
    return sendError(res, 502, `Could not reach ${target.host}: ${e.cause?.code || e.message}`);
  }

  const secureClient = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  const outHeaders = {};
  const skip = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'content-security-policy',
    'content-security-policy-report-only', 'x-frame-options', 'strict-transport-security', 'set-cookie', 'location',
    'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'alt-svc']);
  upstream.headers.forEach((v, k) => { if (!skip.has(k)) outHeaders[k] = v; });

  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) outHeaders['set-cookie'] = cookies.map((c) => rewriteSetCookie(c, target, secureClient));

  const loc = upstream.headers.get('location');
  if (loc) outHeaders.location = proxify(loc, target.href);

  const type = (upstream.headers.get('content-type') || '').toLowerCase();
  const isHtml = type.includes('text/html');
  const isCss = type.includes('text/css');

  if ((isHtml || isCss) && req.method !== 'HEAD' && upstream.status !== 304) {
    const text = await upstream.text();
    const rewritten = isHtml ? rewriteHtml(text, target.href) : rewriteCss(text, target.href);
    outHeaders['content-length'] = Buffer.byteLength(rewritten);
    res.writeHead(upstream.status, outHeaders);
    return res.end(rewritten);
  }

  res.writeHead(upstream.status, outHeaders);
  if (!upstream.body || req.method === 'HEAD') return res.end();
  for await (const chunk of upstream.body) {
    if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

async function serverLocation(res) {
  try {
    const r = await fetch('https://ipinfo.io/json', { dispatcher, headers: { accept: 'application/json' } });
    const j = await r.json();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ip: j.ip, city: j.city, region: j.region, country: j.country, org: j.org, viaUpstreamProxy: !!UPSTREAM_PROXY }));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not detect server location' }));
  }
}

function checkAuth(req, res) {
  if (!PROXY_PASSWORD) return true;
  const h = req.headers.authorization || '';
  const pass = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') : '';
  if (pass === PROXY_PASSWORD) return true;
  res.writeHead(401, { 'www-authenticate': 'Basic realm="Server Creator"', 'content-type': 'text/plain' });
  res.end('Password required');
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;
    const url = new URL(req.url, 'http://local');

    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(INDEX_HTML);
    }
    if (url.pathname === '/go') {
      const t = normalizeInput(url.searchParams.get('url'));
      if (!t) return sendError(res, 400, 'Please enter a valid website address.');
      res.writeHead(302, { location: PREFIX + t });
      return res.end();
    }
    if (url.pathname === '/api/location') return serverLocation(res);
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }

    if (req.url.startsWith(PREFIX)) return await proxyRequest(req, res, req.url.slice(PREFIX.length));

    // A proxied page asked for "/something" — send it to the right website using the Referer.
    const ref = (req.headers.referer || '').match(/\/p\/(https?:\/\/[^/?#]+)/i);
    if (ref) {
      res.writeHead(307, { location: PREFIX + ref[1] + req.url });
      return res.end();
    }
    sendError(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    sendError(res, 500, e.message);
  }
});

server.listen(PORT, () => {
  console.log(`Server Creator running on http://localhost:${PORT}`);
  if (UPSTREAM_PROXY) console.log('Outgoing traffic is routed through UPSTREAM_PROXY');
  if (!PROXY_PASSWORD) console.log('Tip: set PROXY_PASSWORD so strangers cannot use your server.');
});
