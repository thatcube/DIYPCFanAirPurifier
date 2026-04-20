// ─── Run timer + leaderboard client ─────────────────────────────────
// Speedrun timer, shared/local leaderboard, run submission.

// ── Timer state ─────────────────────────────────────────────────────

let _startTs = 0;
let _elapsed = 0;
let _running = false;
let _finished = false;

export function startTimer() {
  _startTs = performance.now();
  _elapsed = 0;
  _running = true;
  _finished = false;
}

export function stopTimer() {
  if (!_running) return _elapsed;
  _elapsed = performance.now() - _startTs;
  _running = false;
  _finished = true;
  return _elapsed;
}

export function tickTimer(ts) {
  if (!_running) return _elapsed;
  _elapsed = ts - _startTs;
  return _elapsed;
}

export function isFinished() { return _finished; }
export function isRunning() { return _running; }
export function getElapsed() { return _elapsed; }

/**
 * Format milliseconds as MM:SS.mmm
 */
export function formatRunTime(ms) {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
}

// ── Leaderboard state ───────────────────────────────────────────────

let _sharedOnline = false;
let _statusNote = '';
let _lbEntries = [];
let _LB_MAX = 25;
let _LB_PER_PLAYER = 25;

// API endpoint — set via configure()
let _apiBase = '';

export function configure(opts) {
  if (opts.apiBase) _apiBase = opts.apiBase;
  if (opts.maxEntries) _LB_MAX = opts.maxEntries;
  if (opts.perPlayer) _LB_PER_PLAYER = opts.perPlayer;
}

export function isSharedOnline() { return _sharedOnline; }
export function getStatusNote() { return _statusNote; }
export function getEntries() { return _lbEntries; }
export function getMax() { return _LB_MAX; }
export function getPerPlayer() { return _LB_PER_PLAYER; }

/**
 * Fetch the leaderboard from the API.
 * Falls back to localStorage if the server is unreachable.
 */
export async function fetchLeaderboard() {
  try {
    const res = await fetch(_apiBase + '/api/leaderboard');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _lbEntries = data.entries || [];
    _sharedOnline = true;
    _statusNote = '';
    if (data.maxEntries) _LB_MAX = data.maxEntries;
    if (data.perPlayer) _LB_PER_PLAYER = data.perPlayer;
    return _lbEntries;
  } catch (e) {
    console.warn('[leaderboard] fetch failed, using local', e);
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    _lbEntries = _loadLocal();
    return _lbEntries;
  }
}

/**
 * Start a shared run session.
 */
export async function startSharedRun() {
  // Implementation wires to the worker's /api/run/start
  // Kept as a stub — the full implementation reads from the monolith
}

/**
 * Report a coin collected to the server.
 */
export function reportCoin(coinId) {
  // Stub — wires to /api/run/coin
}

// ── Local storage fallback ──────────────────────────────────────────

const _LOCAL_KEY = 'diy_air_purifier_lb_v2';

function _loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(_LOCAL_KEY) || '[]');
  } catch { return []; }
}

export function saveLocal(entry) {
  try {
    const arr = _loadLocal();
    arr.push(entry);
    arr.sort((a, b) => a.timeMs - b.timeMs);
    if (arr.length > _LB_MAX) arr.length = _LB_MAX;
    localStorage.setItem(_LOCAL_KEY, JSON.stringify(arr));
    _lbEntries = arr;
  } catch { /* ignore */ }
}
