const express = require('express');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || 'false'));
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '');

const MAX_NAME_LEN = 24;
const LB_MAX = Number(process.env.LB_MAX || 25);
const LB_PER_PLAYER = Number(process.env.LB_PER_PLAYER || 25);
const RUN_TTL_MS = Number(process.env.RUN_TTL_MS || 15 * 60 * 1000);
const MIN_RUN_MS = Number(process.env.MIN_RUN_MS || 12000);
const MAX_RUN_MS = Number(process.env.MAX_RUN_MS || 20 * 60 * 1000);
const MIN_COIN_INTERVAL_MS = Number(process.env.MIN_COIN_INTERVAL_MS || 120);

const defaultCoinCount = Number(process.env.COIN_COUNT || 16);
const coinIds = (process.env.COIN_IDS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const COIN_IDS = coinIds.length ? coinIds : Array.from({ length: defaultCoinCount }, (_, i) => `coin_${i + 1}`);
const COIN_SET = new Set(COIN_IDS);

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const leaderboardFile = path.join(dataDir, 'leaderboard.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function sanitizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LEN);
}

function sanitizePlayerId(id) {
  return String(id || '').trim().replace(/[^0-9a-fA-F-]/g, '').slice(0, 64);
}

function sanitizeCatModel(value) {
  const key = String(value || '').trim().toLowerCase();
  return key === 'classic' || key === 'toon' || key === 'bababooey' ? key : 'classic';
}
function sanitizeCatColor(value) {
  const key = String(value || '').trim().toLowerCase();
  return key === 'ginger' || key === 'tuxedo' || key === 'cream' || key === 'midnight' ? key : 'ginger';
}
function sanitizeCatHair(value) {
  const key = String(value || '').trim().toLowerCase();
  return key === 'long' || key === 'short' ? key : 'short';
}

function makeEntryId(name, timeMs, at) {
  return crypto
    .createHash('sha1')
    .update(`${name}|${timeMs}|${at}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizeLeaderboard(rows) {
  const clean = [];
  for (const row of rows || []) {
    if (!row) continue;
    const name = sanitizeName(row.name);
    const timeMs = Math.floor(Number(row.timeMs));
    const at = Math.floor(Number(row.at));
    if (!name) continue;
    if (!Number.isFinite(timeMs) || timeMs <= 0) continue;
    const safeAt = Number.isFinite(at) && at > 0 ? at : Date.now();
    const id = (typeof row.id === 'string' && row.id.trim())
      ? row.id.trim().slice(0, 64)
      : makeEntryId(name, timeMs, safeAt);
    const playerId = sanitizePlayerId(row.playerId);
    const catColor = sanitizeCatColor(row.catColor);
    const catHair = sanitizeCatHair(row.catHair);
    const catModel = sanitizeCatModel(row.catModel);
    const isTest = row.isTest === true || row.isTest === 1 || row.is_test === 1 ? true : false;
    clean.push({ id, name, timeMs, at: safeAt, catColor, catHair, catModel, playerId, isTest });
  }
  clean.sort((a, b) => a.timeMs - b.timeMs || a.at - b.at);

  // Per-player cap: group by stable playerId when present; fall back to
  // name for legacy rows.
  const perPlayer = new Map();
  const kept = [];
  for (const row of clean) {
    const key = row.playerId ? `id:${row.playerId}` : `name:${row.name}`;
    const n = perPlayer.get(key) || 0;
    if (n >= LB_PER_PLAYER) continue;
    perPlayer.set(key, n + 1);
    kept.push(row);
    if (kept.length >= LB_MAX) break;
  }
  return kept;
}

function loadLeaderboard() {
  try {
    ensureDataDir();
    if (!fs.existsSync(leaderboardFile)) return [];
    const raw = fs.readFileSync(leaderboardFile, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeLeaderboard(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function saveLeaderboard(rows) {
  ensureDataDir();
  fs.writeFileSync(leaderboardFile, JSON.stringify(rows, null, 2), 'utf8');
}

let leaderboard = loadLeaderboard();
const activeRuns = new Map();

// Tiny in-memory rate limiter per IP + action.
const rateBuckets = new Map();
function rateLimit(ip, action, limit, windowMs) {
  const key = `${ip}:${action}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= limit;
}

function getClientIp(req) {
  if (TRUST_PROXY) {
    const xfwd = req.headers['x-forwarded-for'];
    if (typeof xfwd === 'string' && xfwd) return xfwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function apiError(res, status, code, message) {
  res.status(status).json({ ok: false, code, message });
}

function extractAdminToken(req) {
  const hdr = req.headers.authorization;
  if (typeof hdr === 'string' && hdr.toLowerCase().startsWith('bearer ')) {
    return hdr.slice(7).trim();
  }
  const x = req.headers['x-admin-token'];
  if (typeof x === 'string') return x.trim();
  return '';
}

function secureTokenMatch(provided) {
  if (!provided || !ADMIN_TOKEN) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(ADMIN_TOKEN, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const ip = getClientIp(req);
  if (!rateLimit(ip, 'admin', 120, 5 * 60 * 1000)) {
    return apiError(res, 429, 'rate_limited', 'Too many admin requests');
  }
  if (!ADMIN_TOKEN) {
    return apiError(res, 503, 'admin_disabled', 'Admin API is disabled on this server');
  }
  const token = extractAdminToken(req);
  if (!secureTokenMatch(token)) {
    return apiError(res, 401, 'unauthorized', 'Invalid admin token');
  }
  return next();
}

app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));
app.use(express.json({ limit: '16kb' }));

app.get('/api/leaderboard', (req, res) => {
  const ip = getClientIp(req);
  if (!rateLimit(ip, 'lb_get', 120, 60 * 1000)) {
    return apiError(res, 429, 'rate_limited', 'Too many requests');
  }
  return res.json({
    ok: true,
    shared: true,
    leaderboard,
    maxEntries: LB_MAX,
    perPlayer: LB_PER_PLAYER,
    requiredCoinCount: COIN_IDS.length,
    minRunMs: MIN_RUN_MS,
  });
});

app.post('/api/run/start', (req, res) => {
  const ip = getClientIp(req);
  if (!rateLimit(ip, 'run_start', 30, 5 * 60 * 1000)) {
    return apiError(res, 429, 'rate_limited', 'Too many run starts');
  }

  const now = Date.now();
  const runId = crypto.randomUUID();
  activeRuns.set(runId, {
    runId,
    ip,
    startedAt: now,
    expiresAt: now + RUN_TTL_MS,
    coins: new Set(),
    lastCoinAt: 0,
    finished: false,
  });

  return res.json({
    ok: true,
    runId,
    requiredCoinCount: COIN_IDS.length,
    coinIds: COIN_IDS,
    minRunMs: MIN_RUN_MS,
    maxRunMs: MAX_RUN_MS,
    serverTime: now,
  });
});

app.post('/api/run/coin', (req, res) => {
  const ip = getClientIp(req);
  if (!rateLimit(ip, 'run_coin', 240, 60 * 1000)) {
    return apiError(res, 429, 'rate_limited', 'Too many coin claims');
  }

  const runId = String(req.body?.runId || '');
  const coinId = String(req.body?.coinId || '');
  if (!runId || !coinId) {
    return apiError(res, 400, 'bad_request', 'runId and coinId are required');
  }

  const run = activeRuns.get(runId);
  if (!run) return apiError(res, 404, 'run_not_found', 'Run session not found');
  if (run.ip !== ip) return apiError(res, 403, 'forbidden', 'Run token does not match this client');

  const now = Date.now();
  if (now > run.expiresAt) {
    activeRuns.delete(runId);
    return apiError(res, 410, 'run_expired', 'Run session expired');
  }
  if (run.finished) return apiError(res, 409, 'run_finished', 'Run already finished');
  if (!COIN_SET.has(coinId)) return apiError(res, 400, 'invalid_coin', 'Unknown coin id');

  if (run.coins.has(coinId)) {
    return res.json({ ok: true, coinCount: run.coins.size, requiredCoinCount: COIN_IDS.length });
  }

  if (run.lastCoinAt && now - run.lastCoinAt < MIN_COIN_INTERVAL_MS) {
    return apiError(res, 429, 'coin_rate_limited', 'Coin claims are too fast');
  }

  run.lastCoinAt = now;
  run.coins.add(coinId);

  return res.json({ ok: true, coinCount: run.coins.size, requiredCoinCount: COIN_IDS.length });
});

app.post('/api/run/finish', (req, res) => {
  const ip = getClientIp(req);
  if (!rateLimit(ip, 'run_finish', 40, 10 * 60 * 1000)) {
    return apiError(res, 429, 'rate_limited', 'Too many run submissions');
  }

  const runId = String(req.body?.runId || '');
  const name = sanitizeName(req.body?.name || '');
  const playerId = sanitizePlayerId(req.body?.playerId || '');
  const catColor = sanitizeCatColor(req.body?.catColor || '');
  const catHair = sanitizeCatHair(req.body?.catHair || '');
  const catModel = sanitizeCatModel(req.body?.catModel || '');
  const isTest = req.body?.isTest === true || req.body?.isTest === 1 ? true : false;
  if (!runId) return apiError(res, 400, 'bad_request', 'runId is required');

  const run = activeRuns.get(runId);
  if (!run) return apiError(res, 404, 'run_not_found', 'Run session not found');
  if (run.ip !== ip) return apiError(res, 403, 'forbidden', 'Run token does not match this client');

  const now = Date.now();
  if (now > run.expiresAt) {
    activeRuns.delete(runId);
    return apiError(res, 410, 'run_expired', 'Run session expired');
  }
  if (run.finished) return apiError(res, 409, 'run_finished', 'Run already finished');

  if (!isTest && run.coins.size !== COIN_IDS.length) {
    return apiError(res, 400, 'incomplete_run', 'Not all coins were claimed on the server');
  }

  const elapsed = now - run.startedAt;
  if (elapsed < MIN_RUN_MS) {
    return apiError(res, 400, 'run_too_fast', 'Run time below minimum allowed threshold');
  }
  if (elapsed > MAX_RUN_MS) {
    return apiError(res, 400, 'run_too_long', 'Run time exceeded maximum allowed threshold');
  }

  const entry = {
    id: makeEntryId(name || 'Player', Math.floor(elapsed), now),
    name: name || 'Player',
    timeMs: Math.floor(elapsed),
    at: now,
    catColor,
    catHair,
    catModel,
    playerId,
    isTest,
  };

  leaderboard = normalizeLeaderboard(leaderboard.concat(entry));
  saveLeaderboard(leaderboard);

  run.finished = true;
  activeRuns.delete(runId);

  let rank = 0;
  for (let i = 0; i < leaderboard.length; i += 1) {
    const row = leaderboard[i];
    if (row.name === entry.name && row.timeMs === entry.timeMs && row.at === entry.at) {
      rank = i + 1;
      break;
    }
  }

  return res.json({
    ok: true,
    rank,
    entry,
    leaderboard,
    maxEntries: LB_MAX,
    perPlayer: LB_PER_PLAYER,
  });
});

app.get('/api/admin/leaderboard', requireAdmin, (_req, res) => {
  return res.json({
    ok: true,
    leaderboard,
    maxEntries: LB_MAX,
    perPlayer: LB_PER_PLAYER,
    requiredCoinCount: COIN_IDS.length,
  });
});

app.post('/api/admin/delete', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!id) return apiError(res, 400, 'bad_request', 'id is required');
  const before = leaderboard.length;
  leaderboard = leaderboard.filter((row) => row.id !== id);
  if (leaderboard.length === before) {
    return apiError(res, 404, 'not_found', 'Entry not found');
  }
  leaderboard = normalizeLeaderboard(leaderboard);
  saveLeaderboard(leaderboard);
  return res.json({ ok: true, deletedId: id, leaderboardSize: leaderboard.length });
});

app.post('/api/admin/delete-tests', requireAdmin, (_req, res) => {
  const before = leaderboard.length;
  leaderboard = leaderboard.filter((row) => !row.isTest);
  const deletedCount = before - leaderboard.length;
  leaderboard = normalizeLeaderboard(leaderboard);
  saveLeaderboard(leaderboard);
  return res.json({ ok: true, deletedCount, leaderboardSize: leaderboard.length });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const confirm = String(req.body?.confirm || '');
  if (confirm !== 'RESET_LEADERBOARD') {
    return apiError(res, 400, 'bad_request', 'confirm must be RESET_LEADERBOARD');
  }
  leaderboard = [];
  saveLeaderboard(leaderboard);
  activeRuns.clear();
  return res.json({ ok: true, leaderboardSize: 0 });
});

// Cleanup stale runs periodically.
setInterval(() => {
  const now = Date.now();
  for (const [runId, run] of activeRuns) {
    if (now > run.expiresAt || run.finished) activeRuns.delete(runId);
  }
}, 60 * 1000).unref();

app.use(express.static(__dirname));

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/leaderboard', (_req, res) => res.sendFile(path.join(__dirname, 'leaderboard.html')));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, activeRuns: activeRuns.size, leaderboardSize: leaderboard.length });
});

app.listen(PORT, () => {
  console.log(`Shared leaderboard server listening on http://localhost:${PORT}`);
});
