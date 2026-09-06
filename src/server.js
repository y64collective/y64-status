const http = require('http');
const { pingServer } = require('./mcping');
const {
  MC_HOST,
  MC_PORT,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  CACHE_TTL_MS,
  CONNECT_TIMEOUT_MS,
} = require('./config');

const CACHE_SWEEP_INTERVAL_MS = 60_000;
const LAST_ONLINE_STALE_MS = 24 * 60 * 60 * 1000;
const HOST_PATTERN = /^[a-zA-Z0-9.-]{1,253}$/;

const cache = new Map();
const requestCounts = new Map();
const lastOnline = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt >= CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
  for (const [ip, entry] of requestCounts) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      requestCounts.delete(ip);
    }
  }
  for (const [key, entry] of lastOnline) {
    if (now - entry.lastSeenAt >= LAST_ONLINE_STALE_MS) {
      lastOnline.delete(key);
    }
  }
}, CACHE_SWEEP_INTERVAL_MS).unref();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    requestCounts.set(ip, { count: 1, windowStart: now });
    return { limited: false };
  }

  entry.count += 1;
  const retryAfterSeconds = Math.ceil(
    (entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000,
  );
  return { limited: entry.count > RATE_LIMIT_MAX, retryAfterSeconds };
}

const NAMED_LEGACY_COLORS = {
  black: '0',
  dark_blue: '1',
  dark_green: '2',
  dark_aqua: '3',
  dark_red: '4',
  dark_purple: '5',
  gold: '6',
  gray: '7',
  grey: '7',
  dark_gray: '8',
  dark_grey: '8',
  blue: '9',
  green: 'a',
  aqua: 'b',
  red: 'c',
  light_purple: 'd',
  yellow: 'e',
  white: 'f',
};

function colorToLegacyCode(color) {
  if (!color) {
    return '';
  }
  if (color.startsWith('#') && color.length === 7) {
    return (
      '§x' +
      color
        .slice(1)
        .toLowerCase()
        .split('')
        .map((digit) => `§${digit}`)
        .join('')
    );
  }
  const code = NAMED_LEGACY_COLORS[color.toLowerCase()];
  return code ? `§${code}` : '';
}

function flattenChatComponent(component) {
  if (typeof component === 'string') {
    return component;
  }
  if (!component || typeof component !== 'object') {
    return '';
  }

  let prefix = colorToLegacyCode(component.color);
  if (component.bold) prefix += '§l';
  if (component.italic) prefix += '§o';
  if (component.underlined) prefix += '§n';
  if (component.strikethrough) prefix += '§m';
  if (component.obfuscated) prefix += '§k';

  let text = prefix + (component.text ?? '');
  if (Array.isArray(component.extra)) {
    for (const part of component.extra) {
      text += flattenChatComponent(part);
    }
  }
  return text;
}

const VERSION_SPLIT_PATTERN = /^(.*?)\s*\b(\d+(?:\.\d+){1,2}[a-zA-Z0-9._-]*)$/;

function parseVersionName(name) {
  if (!name) {
    return { raw: name ?? null, software: null, protocol: null };
  }

  const match = name.match(VERSION_SPLIT_PATTERN);
  if (!match) {
    return { raw: name, software: null, protocol: null };
  }

  const [, software, protocol] = match;
  return {
    raw: name,
    software: software || null,
    protocol,
  };
}

function normalizeStatus(raw) {
  const motd = flattenChatComponent(raw.description);

  return {
    online: true,
    players: {
      online: raw.players?.online ?? 0,
      max: raw.players?.max ?? 0,
    },
    version: parseVersionName(raw.version?.name),
    motd,
  };
}

async function getStatus(host, port) {
  const key = `${host}:${port}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  let status;
  let failure = null;
  try {
    const raw = await pingServer(host, port, CONNECT_TIMEOUT_MS);
    status = normalizeStatus(raw);
  } catch (error) {
    status = { online: false, players: null, version: null, motd: null };
    failure = error.message;
  }

  const previous = lastOnline.get(key);
  if (!previous || previous.online !== status.online) {
    lastOnline.set(key, { online: status.online, lastSeenAt: now });
    if (status.online) {
      console.log(`${key} is back online`);
    } else {
      console.log(`${key} went offline: ${failure}`);
    }
  } else {
    previous.lastSeenAt = now;
  }

  cache.set(key, { status, cachedAt: now });
  return status;
}

function parseTarget(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'status' || segments.length > 3) {
    return null;
  }

  const host = segments[1] ?? MC_HOST;
  const port = segments[2] !== undefined ? Number(segments[2]) : MC_PORT;

  if (!HOST_PATTERN.test(host)) {
    return { error: 'Invalid host' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'Invalid port' };
  }

  return { host, port };
}

async function handleStatus(res, pathname) {
  const target = parseTarget(pathname);

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (target.error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: target.error }));
    return;
  }

  const status = await getStatus(target.host, target.port);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      const clientIp =
        req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress;
      const rateLimit = checkRateLimit(clientIp);
      if (rateLimit.limited) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': rateLimit.retryAfterSeconds,
        });
        res.end(JSON.stringify({ error: 'Too many requests' }));
        return;
      }

      const pathname = req.url.split('?')[0];
      handleStatus(res, pathname);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

module.exports = { createServer };
