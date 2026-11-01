// Telegram bot for Server Creator.
// Talk to your server from Telegram: check which country websites see, open a
// website through the server, and get a link you can tap to browse through it.
//
// Enable it by setting TELEGRAM_BOT_TOKEN (get one from @BotFather).
// Uses long polling, so no webhook, domain or open port is needed.

'use strict';

const { fetch, Agent } = require('undici');

const MAX_PAGE_BYTES = 2 * 1024 * 1024;

function startBot({ token, allowedUsers, publicUrl, apiBase, dispatcher, normalizeInput, assertPublicHost, upstreamProxy, prefix }) {
  const api = `${(apiBase || 'https://api.telegram.org').replace(/\/$/, '')}/bot${token}`;
  // Talk to Telegram directly, not through the upstream proxy.
  const tgAgent = new Agent({ connect: { timeout: 30_000 } });
  const allowed = new Set(allowedUsers.map(String));
  const startedAt = Date.now();
  let offset = 0;
  let stopped = false;
  let me = null;

  async function call(method, params = {}, timeoutMs = 70_000) {
    const r = await fetch(`${api}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      dispatcher: tgAgent,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json();
    if (!j.ok) {
      const err = new Error(`Telegram ${method} failed: ${j.description || r.status}`);
      err.code = j.error_code;
      throw err;
    }
    return j.result;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function send(chatId, text, extra = {}) {
    return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  }

  function flag(cc) {
    if (!/^[A-Z]{2}$/i.test(cc || '')) return '🌐';
    return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  async function location() {
    const r = await fetch('https://ipinfo.io/json', { dispatcher, headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    return r.json();
  }

  function proxyLink(target) {
    return publicUrl ? `${publicUrl.replace(/\/$/, '')}${prefix}${target}` : null;
  }

  // Fetch a page from the server's location and summarise it.
  async function preview(target) {
    const u = new URL(target);
    await assertPublicHost(u.hostname);
    const started = Date.now();
    const r = await fetch(u.href, {
      dispatcher,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - started;
    const type = r.headers.get('content-type') || '';
    let title = '', text = '';
    if (type.includes('text/html') && r.body) {
      const chunks = [];
      let size = 0;
      for await (const c of r.body) {
        chunks.push(c);
        size += c.length;
        if (size > MAX_PAGE_BYTES) break;
      }
      const html = Buffer.concat(chunks).toString('utf8');
      title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
      text = html
        .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
    } else {
      r.body?.cancel?.().catch(() => {});
    }
    return { status: r.status, finalUrl: r.url || u.href, type: type.split(';')[0], title, text, ms };
  }

  const HELP = [
    '<b>Server Creator bot</b>',
    '',
    'Send me a website (e.g. <code>gulfnews.com</code>) or a search, and I will open it <b>from the server\'s location</b>.',
    '',
    '/open &lt;site&gt; — open a site through the server',
    '/location — country and IP websites see',
    '/check &lt;site&gt; — just the status code and response time',
    '/status — server uptime',
    '/id — show your Telegram user id',
    '/help — this message',
  ].join('\n');

  async function handleOpen(chatId, input, quick = false) {
    const target = normalizeInput(input);
    if (!target) return send(chatId, 'Please send a website address, e.g. <code>gulfnews.com</code>');
    await call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    let p;
    try {
      p = await preview(target);
    } catch (e) {
      const why = (e.code || e.cause?.code) === 'ENOTFOUND' ? 'website not found' : (e.cause?.code || e.message);
      return send(chatId, `❌ Could not open <code>${esc(target)}</code>\n${esc(why)}`);
    }
    const ok = p.status < 400 ? '✅' : '⚠️';
    const lines = [`${ok} <b>${p.status}</b> in ${p.ms} ms — <code>${esc(p.finalUrl)}</code>`];
    if (!quick) {
      if (p.title) lines.push('', `<b>${esc(p.title)}</b>`);
      if (p.text) lines.push('', esc(p.text) + (p.text.length >= 600 ? '…' : ''));
      if (!p.title && !p.text && p.type) lines.push('', `Content type: ${esc(p.type)}`);
    }
    const link = proxyLink(p.finalUrl);
    const extra = link ? { reply_markup: { inline_keyboard: [[{ text: '🌐 Open through server', url: link }]] } } : {};
    if (!link && !quick) lines.push('', '<i>Set PUBLIC_URL on the server to get a tap-to-open link.</i>');
    return send(chatId, lines.join('\n'), extra);
  }

  async function handleLocation(chatId) {
    await call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      const j = await location();
      return send(chatId, [
        `${flag(j.country)} Websites see: <b>${esc([j.city, j.region, j.country].filter(Boolean).join(', '))}</b>`,
        `IP: <code>${esc(j.ip)}</code>`,
        j.org ? `Network: ${esc(j.org)}` : '',
        upstreamProxy ? 'Traffic goes out through the upstream proxy.' : '',
      ].filter(Boolean).join('\n'));
    } catch {
      return send(chatId, '❌ Could not detect the server location right now.');
    }
  }

  function uptime() {
    let s = Math.floor((Date.now() - startedAt) / 1000);
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60);
    return `${d}d ${h}h ${m}m`;
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? '');
    const text = (msg.text || '').trim();
    if (!text) return;

    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1).split('@')[0].toLowerCase() : '';
    const arg = rest.join(' ');

    // /id always works, so you can find your id to put in TELEGRAM_ALLOWED_USERS.
    if (cmd === 'id') return send(chatId, `Your Telegram user id: <code>${esc(userId)}</code>`);

    if (allowed.size && !allowed.has(userId)) {
      return send(chatId, `⛔ This bot is private.\nYour user id is <code>${esc(userId)}</code> — ask the owner to add it to TELEGRAM_ALLOWED_USERS.`);
    }

    switch (cmd) {
      case 'start':
      case 'help':
        return send(chatId, HELP);
      case 'location':
      case 'ip':
        return handleLocation(chatId);
      case 'status':
        return send(chatId, `🟢 Server is running\nUptime: ${uptime()}${publicUrl ? `\nWeb: ${esc(publicUrl)}` : ''}`);
      case 'open':
      case 'go':
        if (!arg) return send(chatId, 'Usage: <code>/open gulfnews.com</code>');
        return handleOpen(chatId, arg);
      case 'check':
        if (!arg) return send(chatId, 'Usage: <code>/check gulfnews.com</code>');
        return handleOpen(chatId, arg, true);
      case '':
        return handleOpen(chatId, text);
      default:
        return send(chatId, 'Unknown command. Send /help');
    }
  }

  async function loop() {
    try {
      me = await call('getMe', {}, 20_000);
      console.log(`Telegram bot @${me.username} is running`);
      if (!allowed.size) console.log('Warning: TELEGRAM_ALLOWED_USERS is empty, so anyone can use the bot. Send /id to the bot to get your id.');
      await call('setMyCommands', {
        commands: [
          { command: 'open', description: 'Open a website through the server' },
          { command: 'location', description: 'Country and IP websites see' },
          { command: 'check', description: 'Status code and response time of a site' },
          { command: 'status', description: 'Server uptime' },
          { command: 'id', description: 'Show your Telegram user id' },
          { command: 'help', description: 'Help' },
        ],
      }, 20_000).catch(() => {});
    } catch (e) {
      console.error(`Telegram bot could not start: ${e.message}`);
      if (e.code === 401 || e.code === 404) return; // bad token: do not retry forever
      if (!stopped) setTimeout(loop, 10_000);
      return;
    }

    let backoff = 1000;
    while (!stopped) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message) handleMessage(u.message).catch((e) => console.error('Telegram bot:', e.message));
        }
      } catch (e) {
        if (stopped) break;
        console.error('Telegram bot polling error:', e.message);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  loop();
  return { stop() { stopped = true; } };
}

module.exports = { startBot };
