const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_ms INTEGER NOT NULL,
  at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lb_time ON leaderboard_entries(time_ms ASC, at_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lb_name ON leaderboard_entries(name, time_ms ASC, at_ms ASC);

CREATE TABLE IF NOT EXISTS run_sessions (
  run_id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished INTEGER NOT NULL DEFAULT 0,
  last_coin_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_runs_expiry ON run_sessions(expires_at);

CREATE TABLE IF NOT EXISTS run_claims (
  run_id TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, coin_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_run ON run_claims(run_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, action, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_expiry ON rate_limits(expires_at);
`;

const DEFAULTS = {
  MAX_NAME_LEN: 24,
  LB_MAX: 25,
  LB_PER_PLAYER: 3,
  RUN_TTL_MS: 15 * 60 * 1000,
  MIN_RUN_MS: 12000,
  MAX_RUN_MS: 20 * 60 * 1000,
  MIN_COIN_INTERVAL_MS: 120,
  COIN_COUNT: 16,
};

let dbInitPromise = null;

export default {
  async fetch(request, env) {
    try {
      if (!env.LB_DB) {
        return jsonResponse(500, { ok: false, code: 'missing_db', message: 'D1 binding LB_DB is missing' });
      }

      await ensureDbInitialized(env);
      const cfg = getConfig(env);
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (url.pathname === '/healthz' && request.method === 'GET') {
        return withCors(jsonResponse(200, { ok: true }));
      }

      if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
        return withCors(await handleGetLeaderboard(request, env, cfg));
      }

      if (url.pathname === '/api/run/start' && request.method === 'POST') {
        return withCors(await handleRunStart(request, env, cfg));
      }

      if (url.pathname === '/api/run/coin' && request.method === 'POST') {
        return withCors(await handleRunCoin(request, env, cfg));
      }

      if (url.pathname === '/api/run/finish' && request.method === 'POST') {
        return withCors(await handleRunFinish(request, env, cfg));
      }

      if (url.pathname === '/api/admin/leaderboard' && request.method === 'GET') {
        return withCors(await handleAdminLeaderboard(request, env, cfg));
      }

      if (url.pathname === '/api/admin/delete' && request.method === 'POST') {
        return withCors(await handleAdminDelete(request, env, cfg));
      }

      if (url.pathname === '/api/admin/reset' && request.method === 'POST') {
        return withCors(await handleAdminReset(request, env));
      }

      return withCors(jsonResponse(404, { ok: false, code: 'not_found', message: 'Route not found' }));
    } catch (err) {
      return withCors(
        jsonResponse(500, {
          ok: false,
          code: 'server_error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
  },
};

async function ensureDbInitialized(env) {
  if (!dbInitPromise) {
    dbInitPromise = env.LB_DB.exec(SCHEMA_SQL);
  }
  await dbInitPromise;
}

function getConfig(env) {
  const defaultCoinCount = readNum(env, 'COIN_COUNT', DEFAULTS.COIN_COUNT);
  const coinIds = String(env.COIN_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const resolvedCoinIds = coinIds.length
    ? coinIds
    : Array.from({ length: defaultCoinCount }, (_, i) => `coin_${i + 1}`);

  return {
    MAX_NAME_LEN: readNum(env, 'MAX_NAME_LEN', DEFAULTS.MAX_NAME_LEN),
    LB_MAX: readNum(env, 'LB_MAX', DEFAULTS.LB_MAX),
    LB_PER_PLAYER: readNum(env, 'LB_PER_PLAYER', DEFAULTS.LB_PER_PLAYER),
    RUN_TTL_MS: readNum(env, 'RUN_TTL_MS', DEFAULTS.RUN_TTL_MS),
    MIN_RUN_MS: readNum(env, 'MIN_RUN_MS', DEFAULTS.MIN_RUN_MS),
    MAX_RUN_MS: readNum(env, 'MAX_RUN_MS', DEFAULTS.MAX_RUN_MS),
    MIN_COIN_INTERVAL_MS: readNum(env, 'MIN_COIN_INTERVAL_MS', DEFAULTS.MIN_COIN_INTERVAL_MS),
    COIN_IDS: resolvedCoinIds,
    COIN_SET: new Set(resolvedCoinIds),
  };
}

async function handleGetLeaderboard(request, env, cfg) {
  const now = Date.now();
  const ipHash = await getRequestIpHash(request, env);
  const allowed = await rateLimit(env.LB_DB, ipHash, 'lb_get', 120, 60 * 1000, now);
  if (!allowed) return apiError(429, 'rate_limited', 'Too many requests');

  const leaderboard = await getNormalizedLeaderboard(env.LB_DB, cfg);
  return jsonResponse(200, {
    ok: true,
    shared: true,
    leaderboard,
    maxEntries: cfg.LB_MAX,
    perPlayer: cfg.LB_PER_PLAYER,
    requiredCoinCount: cfg.COIN_IDS.length,
    minRunMs: cfg.MIN_RUN_MS,
  });
}

async function handleRunStart(request, env, cfg) {
  const now = Date.now();
  const ipHash = await getRequestIpHash(request, env);
  const allowed = await rateLimit(env.LB_DB, ipHash, 'run_start', 30, 5 * 60 * 1000, now);
  if (!allowed) return apiError(429, 'rate_limited', 'Too many run starts');

  await cleanupExpiredRuns(env.LB_DB, now);

  const runId = crypto.randomUUID();
  await env.LB_DB.prepare(
    `INSERT INTO run_sessions (run_id, ip_hash, started_at, expires_at, finished, last_coin_at)
     VALUES (?, ?, ?, ?, 0, 0)`
  )
    .bind(runId, ipHash, now, now + cfg.RUN_TTL_MS)
    .run();

  return jsonResponse(200, {
    ok: true,
    runId,
    requiredCoinCount: cfg.COIN_IDS.length,
    coinIds: cfg.COIN_IDS,
    minRunMs: cfg.MIN_RUN_MS,
    maxRunMs: cfg.MAX_RUN_MS,
    serverTime: now,
  });
}

async function handleRunCoin(request, env, cfg) {
  const now = Date.now();
  const ipHash = await getRequestIpHash(request, env);
  const allowed = await rateLimit(env.LB_DB, ipHash, 'run_coin', 240, 60 * 1000, now);
  if (!allowed) return apiError(429, 'rate_limited', 'Too many coin claims');

  const body = await parseBody(request);
  const runId = String(body?.runId || '');
  const coinId = String(body?.coinId || '');
  if (!runId || !coinId) return apiError(400, 'bad_request', 'runId and coinId are required');

  if (!cfg.COIN_SET.has(coinId)) return apiError(400, 'invalid_coin', 'Unknown coin id');

  const run = await env.LB_DB.prepare(
    `SELECT run_id, ip_hash, started_at, expires_at, finished, last_coin_at
     FROM run_sessions WHERE run_id = ?`
  )
    .bind(runId)
    .first();

  if (!run) return apiError(404, 'run_not_found', 'Run session not found');
  if (run.ip_hash !== ipHash) return apiError(403, 'forbidden', 'Run token does not match this client');

  if (now > Number(run.expires_at)) {
    await deleteRun(env.LB_DB, runId);
    return apiError(410, 'run_expired', 'Run session expired');
  }
  if (Number(run.finished) === 1) return apiError(409, 'run_finished', 'Run already finished');

  const existingClaim = await env.LB_DB.prepare(
    `SELECT coin_id FROM run_claims WHERE run_id = ? AND coin_id = ? LIMIT 1`
  )
    .bind(runId, coinId)
    .first();

  if (existingClaim) {
    const coinCount = await getRunCoinCount(env.LB_DB, runId);
    return jsonResponse(200, { ok: true, coinCount, requiredCoinCount: cfg.COIN_IDS.length });
  }

  const lastCoinAt = Number(run.last_coin_at || 0);
  if (lastCoinAt && now - lastCoinAt < cfg.MIN_COIN_INTERVAL_MS) {
    return apiError(429, 'coin_rate_limited', 'Coin claims are too fast');
  }

  await env.LB_DB.batch([
    env.LB_DB.prepare(`INSERT INTO run_claims (run_id, coin_id, claimed_at) VALUES (?, ?, ?)`).bind(runId, coinId, now),
    env.LB_DB.prepare(`UPDATE run_sessions SET last_coin_at = ? WHERE run_id = ?`).bind(now, runId),
  ]);

  const coinCount = await getRunCoinCount(env.LB_DB, runId);
  return jsonResponse(200, { ok: true, coinCount, requiredCoinCount: cfg.COIN_IDS.length });
}

async function handleRunFinish(request, env, cfg) {
  const now = Date.now();
  const ipHash = await getRequestIpHash(request, env);
  const allowed = await rateLimit(env.LB_DB, ipHash, 'run_finish', 40, 10 * 60 * 1000, now);
  if (!allowed) return apiError(429, 'rate_limited', 'Too many run submissions');

  const body = await parseBody(request);
  const runId = String(body?.runId || '');
  const name = sanitizeName(body?.name || '', cfg.MAX_NAME_LEN);
  if (!runId) return apiError(400, 'bad_request', 'runId is required');

  const run = await env.LB_DB.prepare(
    `SELECT run_id, ip_hash, started_at, expires_at, finished
     FROM run_sessions WHERE run_id = ?`
  )
    .bind(runId)
    .first();

  if (!run) return apiError(404, 'run_not_found', 'Run session not found');
  if (run.ip_hash !== ipHash) return apiError(403, 'forbidden', 'Run token does not match this client');

  if (now > Number(run.expires_at)) {
    await deleteRun(env.LB_DB, runId);
    return apiError(410, 'run_expired', 'Run session expired');
  }
  if (Number(run.finished) === 1) return apiError(409, 'run_finished', 'Run already finished');

  const coinCount = await getRunCoinCount(env.LB_DB, runId);
  if (coinCount !== cfg.COIN_IDS.length) {
    return apiError(400, 'incomplete_run', 'Not all coins were claimed on the server');
  }

  const elapsed = now - Number(run.started_at);
  if (elapsed < cfg.MIN_RUN_MS) return apiError(400, 'run_too_fast', 'Run time below minimum allowed threshold');
  if (elapsed > cfg.MAX_RUN_MS) return apiError(400, 'run_too_long', 'Run time exceeded maximum allowed threshold');

  const finalName = name || 'Player';
  const entryId = await makeEntryId(finalName, Math.floor(elapsed), now);

  await env.LB_DB.prepare(`INSERT INTO leaderboard_entries (id, name, time_ms, at_ms) VALUES (?, ?, ?, ?)`).bind(
    entryId,
    finalName,
    Math.floor(elapsed),
    now
  ).run();

  await deleteRun(env.LB_DB, runId);

  const leaderboard = await getNormalizedLeaderboard(env.LB_DB, cfg);
  await pruneLeaderboard(env.LB_DB, cfg, leaderboard);

  const rank = leaderboard.findIndex((row) => row.id === entryId) + 1;
  const entry = leaderboard.find((row) => row.id === entryId) || {
    id: entryId,
    name: finalName,
    timeMs: Math.floor(elapsed),
    at: now,
  };

  return jsonResponse(200, {
    ok: true,
    rank,
    entry,
    leaderboard,
    maxEntries: cfg.LB_MAX,
    perPlayer: cfg.LB_PER_PLAYER,
  });
}

async function handleAdminLeaderboard(request, env, cfg) {
  const auth = await requireAdmin(request, env);
  if (auth) return auth;

  const leaderboard = await getNormalizedLeaderboard(env.LB_DB, cfg);
  return jsonResponse(200, {
    ok: true,
    leaderboard,
    maxEntries: cfg.LB_MAX,
    perPlayer: cfg.LB_PER_PLAYER,
    requiredCoinCount: cfg.COIN_IDS.length,
  });
}

async function handleAdminDelete(request, env, cfg) {
  const auth = await requireAdmin(request, env);
  if (auth) return auth;

  const body = await parseBody(request);
  const id = String(body?.id || '').trim();
  if (!id) return apiError(400, 'bad_request', 'id is required');

  const result = await env.LB_DB.prepare(`DELETE FROM leaderboard_entries WHERE id = ?`).bind(id).run();
  const deleted = Number(result.meta?.changes || 0);
  if (deleted < 1) return apiError(404, 'not_found', 'Entry not found');

  const leaderboard = await getNormalizedLeaderboard(env.LB_DB, cfg);
  await pruneLeaderboard(env.LB_DB, cfg, leaderboard);
  return jsonResponse(200, { ok: true, deletedId: id, leaderboardSize: leaderboard.length });
}

async function handleAdminReset(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth) return auth;

  const body = await parseBody(request);
  const confirm = String(body?.confirm || '');
  if (confirm !== 'RESET_LEADERBOARD') {
    return apiError(400, 'bad_request', 'confirm must be RESET_LEADERBOARD');
  }

  await env.LB_DB.batch([
    env.LB_DB.prepare(`DELETE FROM leaderboard_entries`),
    env.LB_DB.prepare(`DELETE FROM run_claims`),
    env.LB_DB.prepare(`DELETE FROM run_sessions`),
  ]);
  return jsonResponse(200, { ok: true, leaderboardSize: 0 });
}

async function requireAdmin(request, env) {
  const now = Date.now();
  const ipHash = await getRequestIpHash(request, env);
  const limited = await rateLimit(env.LB_DB, ipHash, 'admin', 120, 5 * 60 * 1000, now);
  if (!limited) return apiError(429, 'rate_limited', 'Too many admin requests');

  const adminToken = String(env.ADMIN_TOKEN || '');
  if (!adminToken) return apiError(503, 'admin_disabled', 'Admin API is disabled on this server');

  const provided = extractAdminToken(request);
  if (!provided || provided !== adminToken) return apiError(401, 'unauthorized', 'Invalid admin token');

  return null;
}

async function cleanupExpiredRuns(db, now) {
  await db.batch([
    db.prepare(`DELETE FROM run_claims WHERE run_id IN (SELECT run_id FROM run_sessions WHERE expires_at < ? OR finished = 1)`).bind(now),
    db.prepare(`DELETE FROM run_sessions WHERE expires_at < ? OR finished = 1`).bind(now),
    db.prepare(`DELETE FROM rate_limits WHERE expires_at < ?`).bind(now),
  ]);
}

async function deleteRun(db, runId) {
  await db.batch([
    db.prepare(`DELETE FROM run_claims WHERE run_id = ?`).bind(runId),
    db.prepare(`DELETE FROM run_sessions WHERE run_id = ?`).bind(runId),
  ]);
}

async function getRunCoinCount(db, runId) {
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM run_claims WHERE run_id = ?`).bind(runId).first();
  return Number(row?.c || 0);
}

async function getNormalizedLeaderboard(db, cfg) {
  const scanLimit = Math.max(cfg.LB_MAX * cfg.LB_PER_PLAYER * 6, 200);
  const rows = await db
    .prepare(`SELECT id, name, time_ms, at_ms FROM leaderboard_entries ORDER BY time_ms ASC, at_ms ASC LIMIT ?`)
    .bind(scanLimit)
    .all();

  return normalizeLeaderboard(rows.results || [], cfg.LB_MAX, cfg.LB_PER_PLAYER);
}

async function pruneLeaderboard(db, cfg, normalizedRows) {
  const keepIds = new Set((normalizedRows || []).map((row) => row.id));
  const scanLimit = Math.max(cfg.LB_MAX * cfg.LB_PER_PLAYER * 8, 300);
  const rows = await db
    .prepare(`SELECT id FROM leaderboard_entries ORDER BY time_ms ASC, at_ms ASC LIMIT ?`)
    .bind(scanLimit)
    .all();

  const toDelete = [];
  for (const row of rows.results || []) {
    if (!keepIds.has(String(row.id))) toDelete.push(String(row.id));
  }

  if (!toDelete.length) return;

  const chunks = chunkArray(toDelete, 40);
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(',');
    await db.prepare(`DELETE FROM leaderboard_entries WHERE id IN (${placeholders})`).bind(...chunk).run();
  }
}

function normalizeLeaderboard(rows, maxEntries, perPlayer) {
  const clean = [];
  for (const row of rows || []) {
    if (!row) continue;
    const id = String(row.id || '').trim();
    const name = sanitizeName(row.name || '', DEFAULTS.MAX_NAME_LEN);
    const timeMs = Math.floor(Number(row.time_ms ?? row.timeMs));
    const at = Math.floor(Number(row.at_ms ?? row.at));
    if (!id || !name) continue;
    if (!Number.isFinite(timeMs) || timeMs <= 0) continue;
    const safeAt = Number.isFinite(at) && at > 0 ? at : Date.now();
    clean.push({ id, name, timeMs, at: safeAt });
  }

  clean.sort((a, b) => a.timeMs - b.timeMs || a.at - b.at);

  const perName = new Map();
  const kept = [];
  for (const row of clean) {
    const current = perName.get(row.name) || 0;
    if (current >= perPlayer) continue;
    perName.set(row.name, current + 1);
    kept.push(row);
    if (kept.length >= maxEntries) break;
  }
  return kept;
}

async function rateLimit(db, ipHash, action, limit, windowMs, now) {
  const bucketStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = bucketStart + windowMs;
  await db
    .prepare(
      `INSERT INTO rate_limits (ip_hash, action, bucket_start, expires_at, count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(ip_hash, action, bucket_start)
       DO UPDATE SET count = count + 1, expires_at = excluded.expires_at`
    )
    .bind(ipHash, action, bucketStart, expiresAt)
    .run();

  const row = await db
    .prepare(`SELECT count FROM rate_limits WHERE ip_hash = ? AND action = ? AND bucket_start = ? LIMIT 1`)
    .bind(ipHash, action, bucketStart)
    .first();
  return Number(row?.count || 0) <= limit;
}

function readNum(env, key, fallback) {
  const n = Number(env[key]);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeName(name, maxLen) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen);
}

async function makeEntryId(name, timeMs, at) {
  const hex = await sha1Hex(`${name}|${timeMs}|${at}`);
  return hex.slice(0, 16);
}

async function getRequestIpHash(request, env) {
  const rawIp = extractIp(request);
  const salt = String(env.IP_HASH_SALT || '');
  return sha1Hex(`${rawIp}|${salt}`);
}

function extractIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();

  return 'unknown';
}

function extractAdminToken(request) {
  const auth = request.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const x = request.headers.get('x-admin-token');
  return x ? x.trim() : '';
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function apiError(status, code, message) {
  return jsonResponse(status, { ok: false, code, message });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders();
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-admin-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

async function sha1Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}