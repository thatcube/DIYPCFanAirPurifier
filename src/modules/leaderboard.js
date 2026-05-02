// ─── Run timer + leaderboard ────────────────────────────────────────
// Speedrun timer, shared API leaderboard with local fallback,
// name dialog, finish dialog, copy-result, per-player cap.
// API: same-origin /api/* proxied to Cloudflare Worker in production.

import {
  catModelKey, catColorKey, catHairKey,
  sanitizeColorKey, sanitizeModelKey, sanitizeHairKey, isColorable,
  CAT_COLOR_EMOJI, CAT_MODEL_EMOJI, CAT_MODEL_LABELS_SHORT
} from './cat-appearance.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { trapFocus, saveFocus } from './a11y.js';
import { CAT_COLOR_PRESETS, CAT_MODEL_PRESETS, TOTAL_SECRETS } from './constants.js';

// ── Config ──────────────────────────────────────────────────────────

const LB_MAX = 25;
const LB_PER_PLAYER = 25;
const LB_STORE_KEY = 'diy_air_purifier_leaderboard_v1';
const LB_PLAYER_KEY = 'diy_air_purifier_player_name_v1';
const LB_PLAYER_ID_KEY = 'diy_air_purifier_player_id_v1';
const QUICK_COIN_MODE_KEY = 'diy_air_purifier_quick_coin_mode';
const LOCAL_TEST_MODE_KEY = 'diy_air_purifier_local_test_mode';
const LB_API_BASE = ''; // same-origin — Netlify proxies /api/* to Worker
const LB_SHARED_ENABLED = true;

function _isQuickCoinMode() {
  try { return localStorage.getItem(QUICK_COIN_MODE_KEY) === '1'; } catch (e) { return false; }
}

function _isLocalhost() {
  const host = String((typeof window !== 'undefined' && window.location && window.location.hostname) || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

function _isLocalTestMode() {
  if (!_isLocalhost()) return false;
  // Local test mode defaults to on for localhost unless explicitly disabled.
  try {
    const v = localStorage.getItem(LOCAL_TEST_MODE_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch (e) { /* ignore */ }
  return true;
}

function _isTestSubmission() {
  // Test runs are only ever produced when developing locally. On the live
  // server we never tag a run as a test, so even if Quick Coin Mode somehow
  // gets toggled on (e.g. via DevTools) the run won't be inserted with
  // is_test=1 and the worker will reject the under-coin submission outright.
  if (!_isLocalhost()) return false;
  return _isQuickCoinMode() || _isLocalTestMode();
}

export function isTestRun() { return _isTestSubmission(); }

// ── Shared API state ────────────────────────────────────────────────

let _sharedOnline = false;
let _sharedRunId = '';
let _statusNote = LB_SHARED_ENABLED ? 'Connecting' : '';
const _claimedCoinIds = new Set();
const _pendingCoinReports = new Set();
const _failedCoinIds = new Set();

// ── Timer state ─────────────────────────────────────────────────────

let _startTs = 0;
let _elapsed = 0;
let _running = false;
let _finished = false;

function _setTimerHudState(text, cls) {
  const st = document.getElementById('runTimerState');
  const pill = document.getElementById('runTimerHud');
  if (st) {
    st.textContent = text;
    st.classList.remove('running', 'finished', 'ready');
    if (cls) st.classList.add(cls);
  }
  if (pill) {
    pill.classList.remove('running', 'finished', 'ready');
    if (cls) pill.classList.add(cls);
  }
}

export function startTimer() {
  _startTs = performance.now();
  _elapsed = 0;
  _running = true;
  _finished = false;
  _setTimerHudState('Running', 'running');
}

export function stopTimer() {
  if (!_running) return _elapsed;
  _elapsed = performance.now() - _startTs;
  _running = false;
  _finished = true;
  _setTimerHudState('Finished', 'finished');
  return _elapsed;
}

// Pause the active run timer without finishing it. Snapshots elapsed
// so the next resumeTimer() can re-anchor _startTs and the run keeps
// counting from where it left off. Safe no-op if not running or
// already finished.
export function pauseTimer() {
  if (!_running || _finished) return _elapsed;
  _elapsed = performance.now() - _startTs;
  _running = false;
  return _elapsed;
}

// Resume a paused run timer. Re-anchors _startTs so (now - _startTs)
// equals the saved _elapsed. No-op if the timer is finished or never
// started.
export function resumeTimer() {
  if (_finished || _running) return _elapsed;
  if (!_startTs) return _elapsed;
  _startTs = performance.now() - _elapsed;
  _running = true;
  _setTimerHudState('Running', 'running');
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

export function resetTimer() {
  _startTs = 0;
  _elapsed = 0;
  _running = false;
  _finished = false;
  _setTimerHudState('Ready', 'ready');
}

// ── Formatting ──────────────────────────────────────────────────────

export function formatRunTime(ms, full) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const z = total % 1000;
  if (full) return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(z).padStart(3, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${Math.floor(z / 100)}`;
}

// ── Player identity ─────────────────────────────────────────────────

let _playerName = '';
let _playerId = '';

function _generatePlayerId() {
  try {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) { /* fallback */ }
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function _sanitizePlayerId(id) {
  return String(id || '').trim().replace(/[^0-9a-fA-F-]/g, '').slice(0, 64);
}

function _sanitizePlayerName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function _initPlayerId() {
  try { _playerId = _sanitizePlayerId(localStorage.getItem(LB_PLAYER_ID_KEY) || ''); } catch (e) { _playerId = ''; }
  if (!_playerId) {
    _playerId = _generatePlayerId();
    try { localStorage.setItem(LB_PLAYER_ID_KEY, _playerId); } catch (e) { /* ignore */ }
  }
}

function _readPlayerName() {
  try { return _sanitizePlayerName(localStorage.getItem(LB_PLAYER_KEY) || ''); } catch (e) { return ''; }
}

function _hasCustomPlayerName() {
  const n = _readPlayerName();
  return !!n && n !== 'Player';
}

export function setPlayerName(name, persist = true) {
  _playerName = _sanitizePlayerName(name) || 'Player';
  if (persist) {
    try { localStorage.setItem(LB_PLAYER_KEY, _playerName); } catch (e) { /* ignore */ }
  }
}

export function getPlayerName() { return _playerName || 'Player'; }
export function getPlayerId() { return _playerId; }

// ── Leaderboard data ────────────────────────────────────────────────

// Run modes that have their own separate leaderboard board.
export const VALID_LEADERBOARD_MODES = ['normal', 'speed'];

function _sanitizeMode(value) {
  const key = String(value || '').trim().toLowerCase();
  return VALID_LEADERBOARD_MODES.includes(key) ? key : 'normal';
}

let _leaderboard = [];
// Per-mode cache so switching tabs doesn't lose either side's rows.
const _leaderboardByMode = { normal: [], speed: [] };
// Mode of the *currently active* run (set by startSharedRun).
let _currentRunMode = 'normal';
// Mode the user is currently viewing on the leaderboard panel.
let _viewMode = 'normal';

export function getCurrentRunMode() { return _currentRunMode; }
export function getViewMode() { return _viewMode; }

export function setViewMode(mode) {
  const next = _sanitizeMode(mode);
  if (next === _viewMode) return _viewMode;
  _viewMode = next;
  _leaderboard = (_leaderboardByMode[_viewMode] || []).slice();
  renderLeaderboardPanel();
  // Fetch fresh data for the newly-active tab in the background.
  void refreshSharedLeaderboard(_viewMode);
  return _viewMode;
}

function _escapeHtml(v) {
  return String(v || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function _makeEntryId(name, timeMs, at) {
  const base = `${_sanitizePlayerName(name) || 'Player'}|${Math.floor(Number(timeMs) || 0)}|${Math.floor(Number(at) || Date.now())}`;
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) { h ^= base.charCodeAt(i); h = (h * 16777619) >>> 0; }
  const rnd = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${h.toString(16).padStart(8, '0')}${rnd}`;
}

function _catBadgeHtml(entry) {
  const model = String((entry && entry.catModel) || 'classic').toLowerCase();
  const emoji = CAT_MODEL_EMOJI[model] || CAT_MODEL_EMOJI.classic;
  const label = CAT_MODEL_LABELS_SHORT[model] || 'Cat';
  return `<span class="catBadge" title="${_escapeHtml(label)}"><span class="catEmoji">${emoji}</span><span class="catLabel">${label}</span></span>`;
}

// Mirrors secretBadgeHtml() in leaderboard.html so the finish-dialog
// rows surface the same coin info as the standalone /leaderboard
// page. Goal scales with the highest secretCoins on the board (in
// case more secrets are added later) but never below TOTAL_SECRETS.
function _secretBadgeHtml(entry, goal) {
  const n = Math.max(0, Math.floor(Number(entry && entry.secretCoins) || 0));
  const total = Math.max(1, Math.floor(Number(goal) || TOTAL_SECRETS));
  const cls = n === 0 ? ' is-zero' : (n >= total ? ' is-max' : '');
  const title = `${n} of ${total} secret coin${n === 1 ? '' : 's'} found`;
  return `<span class="secretBadge${cls}" title="${_escapeHtml(title)}" aria-label="${_escapeHtml(title)}"><i class="ph-fill ph-key"></i>${n}/${total}</span>`;
}

function _normalizeLeaderboard(rows) {
  const clean = [];
  for (const r of (rows || [])) {
    if (!r) continue;
    const name = _sanitizePlayerName(r.name);
    const timeMs = Math.floor(Number(r.timeMs));
    const at = Math.floor(Number(r.at));
    if (!name || !Number.isFinite(timeMs) || timeMs <= 0) continue;
    const safeAt = Number.isFinite(at) && at > 0 ? at : Date.now();
    const id = String(r.id || '').trim() || _makeEntryId(name, timeMs, safeAt);
    clean.push({
      id, name, timeMs, at: safeAt,
      catColor: sanitizeColorKey(r.catColor || ''),
      catHair: sanitizeHairKey(r.catHair || ''),
      catModel: sanitizeModelKey(r.catModel || ''),
      playerId: _sanitizePlayerId(r.playerId || ''),
      secretCoins: Math.max(0, Math.floor(Number(r.secretCoins) || 0))
    });
  }
  clean.sort((a, b) => a.timeMs - b.timeMs || a.at - b.at);
  const perPlayerCount = new Map();
  const kept = [];
  for (const r of clean) {
    const key = r.playerId ? `id:${r.playerId}` : `name:${r.name}`;
    const n = perPlayerCount.get(key) || 0;
    if (n >= LB_PER_PLAYER) continue;
    perPlayerCount.set(key, n + 1);
    kept.push(r);
    if (kept.length >= LB_MAX) break;
  }
  return kept;
}

function _localStoreKeyForMode(mode) {
  const m = _sanitizeMode(mode);
  return m === 'normal' ? LB_STORE_KEY : `${LB_STORE_KEY}_${m}`;
}

function _loadLeaderboard() {
  for (const mode of VALID_LEADERBOARD_MODES) {
    try {
      const raw = localStorage.getItem(_localStoreKeyForMode(mode));
      _leaderboardByMode[mode] = _normalizeLeaderboard(raw ? JSON.parse(raw) : []);
    } catch (e) { _leaderboardByMode[mode] = []; }
  }
  _leaderboard = (_leaderboardByMode[_viewMode] || []).slice();
}

function _saveLeaderboard(mode) {
  const m = _sanitizeMode(mode || _viewMode);
  try { localStorage.setItem(_localStoreKeyForMode(m), JSON.stringify(_leaderboardByMode[m] || [])); } catch (e) { /* ignore */ }
}

export function getEntries() { return _leaderboard; }

// ── Shared API ──────────────────────────────────────────────────────

async function _lbApiRequest(path, body) {
  // Debug hook: artificially delay every API call so the finish-dialog
  // "Saving..." state stays visible long enough to test typing.
  // Set `window._lbDebugSaveDelay = 5000` from the DevTools console.
  if (typeof window !== 'undefined') {
    const delayMs = Number(window._lbDebugSaveDelay) || 0;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  const url = `${LB_API_BASE}/api${path}`;
  const init = body === undefined
    ? { method: 'GET', credentials: 'same-origin' }
    : {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
  const res = await fetch(url, init);
  let payload = {};
  try { payload = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok || payload.ok === false) {
    const msg = (payload && payload.message) || `API ${res.status}`;
    const err = new Error(msg);
    err.apiCode = payload && payload.code ? String(payload.code) : '';
    err.httpStatus = res.status;
    throw err;
  }
  return payload;
}

export async function refreshSharedLeaderboard(mode) {
  if (!LB_SHARED_ENABLED) return;
  const targetMode = _sanitizeMode(mode || _viewMode);
  try {
    const data = await _lbApiRequest(`/leaderboard?mode=${encodeURIComponent(targetMode)}`);
    _sharedOnline = true;
    _statusNote = '';
    const list = _normalizeLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
    _leaderboardByMode[targetMode] = list;
    if (_viewMode === targetMode) _leaderboard = list.slice();
  } catch (e) {
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    _loadLeaderboard();
  }
  if (_viewMode === targetMode) renderLeaderboardPanel();
}

export async function startSharedRun(mode) {
  const runMode = _sanitizeMode(mode);
  _currentRunMode = runMode;
  // Default the visible tab to the mode the player is about to run; this
  // matches the player's mental model when they open the pause panel.
  if (_viewMode !== runMode) {
    _viewMode = runMode;
    _leaderboard = (_leaderboardByMode[_viewMode] || []).slice();
  }
  _sharedRunId = '';
  _claimedCoinIds.clear();
  _failedCoinIds.clear();
  _pendingCoinReports.clear();
  if (!LB_SHARED_ENABLED) return;
  try {
    const data = await _lbApiRequest('/run/start', { mode: runMode });
    _sharedRunId = String(data.runId || '');
    _sharedOnline = !!_sharedRunId;
    if (_sharedOnline) _statusNote = '';
  } catch (e) {
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    try { console.warn('[leaderboard] /run/start failed; this run will save locally only.', e); } catch (_) { /* ignore */ }
  }
  renderLeaderboardPanel();
}

function _trackCoinReport(promise) {
  _pendingCoinReports.add(promise);
  promise.finally(() => _pendingCoinReports.delete(promise));
}

async function _flushCoinReports() {
  if (!_pendingCoinReports.size) return;
  await Promise.allSettled([..._pendingCoinReports]);
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _reconcileCoinClaims(runId) {
  if (!runId || !_claimedCoinIds.size) return;
  // Server coin claims are rate-limited per run. Reconcile sequentially with
  // short spacing so quick multi-pickups don't leave the run incomplete.
  const pending = new Set(_claimedCoinIds);
  const maxPasses = 3;
  for (let pass = 0; pass < maxPasses && pending.size > 0; pass++) {
    for (const coinId of [...pending]) {
      try {
        await _lbApiRequest('/run/coin', { runId, coinId });
        _failedCoinIds.delete(coinId);
        pending.delete(coinId);
      } catch (e) {
        _failedCoinIds.add(coinId);
      }
      // Keep attempts above server MIN_COIN_INTERVAL_MS (120ms by default).
      if (pending.size > 0) await _wait(140);
    }
  }
}

export function reportCoin(coinId) {
  if (!_sharedRunId || !_sharedOnline || !coinId) return;
  if (_claimedCoinIds.has(coinId)) return;
  const runId = _sharedRunId;
  _claimedCoinIds.add(coinId);
  const job = _lbApiRequest('/run/coin', { runId, coinId })
    .then(() => { _failedCoinIds.delete(coinId); })
    .catch(() => { _failedCoinIds.add(coinId); });
  _trackCoinReport(job);
}

// ── Record a finished run (shared API with local fallback) ──────────

function _recordRunLocal(timeMs, coinTotal, secretCoins, mode) {
  const runMode = _sanitizeMode(mode || _currentRunMode);
  const name = _playerName || 'Player';
  const now = Date.now();
  const entry = {
    id: _makeEntryId(name, timeMs, now),
    name, timeMs: Math.floor(timeMs), at: now,
    catColor: sanitizeColorKey(catColorKey),
    catHair: sanitizeHairKey(catHairKey),
    catModel: sanitizeModelKey(catModelKey),
    playerId: _playerId,
    mode: runMode
  };
  const merged = _normalizeLeaderboard((_leaderboardByMode[runMode] || []).concat(entry));
  _leaderboardByMode[runMode] = merged;
  if (_viewMode === runMode) _leaderboard = merged.slice();
  _saveLeaderboard(runMode);

  let rank = 0;
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].id === entry.id) { rank = i + 1; break; }
  }

  return {
    entryId: entry.id, rank, name: entry.name,
    timeMs: entry.timeMs, coins: coinTotal, coinTotal,
    secretCoins: secretCoins || 0,
    catColor: entry.catColor, catHair: entry.catHair, catModel: entry.catModel,
    mode: runMode,
    // Local fallback never reaches the shared leaderboard server. The
    // finish dialog uses this to show an honest "Saved on this device
    // only" message instead of a misleading "Saved".
    sharedSaved: false
  };
}

async function _recordRunShared(timeMs, coinTotal, secretCoins, mode) {
  const runMode = _sanitizeMode(mode || _currentRunMode);
  if (!_sharedRunId || !_sharedOnline) {
    // Loud diagnostic — silent local fallback is the most common reason a
    // run "saved" but never shows up on the shared leaderboard.
    try { console.warn('[leaderboard] save fell back to local-only at start (no shared runId or offline). _sharedRunId=%o _sharedOnline=%o', _sharedRunId, _sharedOnline); } catch (e) { /* ignore */ }
    return _recordRunLocal(timeMs, coinTotal, secretCoins, runMode);
  }
  const runId = _sharedRunId;
  await _flushCoinReports();
  if (_failedCoinIds.size) await _reconcileCoinClaims(runId);
  const finishBody = {
    runId,
    mode: runMode,
    name: _playerName || 'Player',
    playerId: _playerId,
    catColor: sanitizeColorKey(catColorKey),
    catHair: sanitizeHairKey(catHairKey),
    catModel: sanitizeModelKey(catModelKey),
    isTest: _isTestSubmission(),
    timeMs: Math.max(1, Math.floor(Number(timeMs) || 0)),
    secretCoins: Math.max(0, Math.floor(Number(secretCoins) || 0))
  };
  const isTestRun = !!finishBody.isTest;
  try {
    const data = await _lbApiRequest('/run/finish', finishBody);
    _sharedRunId = '';
    _claimedCoinIds.clear();
    _failedCoinIds.clear();
    _pendingCoinReports.clear();
    _sharedOnline = true;
    _statusNote = '';
    const responseMode = _sanitizeMode((data && data.mode) || runMode);
    const rawList = Array.isArray(data.leaderboard) ? data.leaderboard.slice() : [];
    const serverEntry = (data && data.entry) ? data.entry : {};
    const serverEntryId = String(serverEntry.id || '');
    // Test runs are saved to the DB but excluded from public leaderboard
    // queries by the worker, so the response leaderboard typically won't
    // contain the just-inserted row. Splice it in locally so the player
    // can see their own test result in the finish dialog. The worker
    // still hides it from everyone else.
    if (isTestRun && serverEntryId && !rawList.some((r) => String(r && r.id || '') === serverEntryId)) {
      rawList.push({
        id: serverEntryId,
        name: _sanitizePlayerName(serverEntry.name || _playerName || 'Player'),
        timeMs: Math.floor(Number(serverEntry.timeMs) || Math.floor(timeMs)),
        at: Math.floor(Number(serverEntry.at) || Date.now()),
        catColor: sanitizeColorKey(serverEntry.catColor || catColorKey),
        catHair: sanitizeHairKey(serverEntry.catHair || catHairKey),
        catModel: sanitizeModelKey(serverEntry.catModel || catModelKey),
        playerId: _playerId,
        mode: responseMode
      });
      try { console.info('[leaderboard] test run saved to server but hidden from public leaderboard. Showing locally so you can see your time.'); } catch (_) { /* ignore */ }
    }
    const list = _normalizeLeaderboard(rawList);
    _leaderboardByMode[responseMode] = list;
    if (_viewMode === responseMode) _leaderboard = list.slice();
    let resolvedRank = Math.floor(Number(data && data.rank) || 0);
    if (isTestRun && serverEntryId && resolvedRank === 0) {
      const idx = list.findIndex((r) => String(r && r.id || '') === serverEntryId);
      if (idx >= 0) resolvedRank = idx + 1;
    }
    return {
      entryId: serverEntryId,
      rank: resolvedRank,
      name: _sanitizePlayerName(serverEntry.name || _playerName || 'Player'),
      timeMs: Math.floor(Number(serverEntry.timeMs) || Math.floor(timeMs)),
      coins: coinTotal, coinTotal,
      secretCoins: secretCoins || 0,
      catColor: sanitizeColorKey(serverEntry.catColor || catColorKey),
      catHair: sanitizeHairKey(serverEntry.catHair || catHairKey),
      catModel: sanitizeModelKey(serverEntry.catModel || catModelKey),
      mode: responseMode,
      sharedSaved: true,
      isTestRun
    };
  } catch (e) {
    // Retry if incomplete_run (coin claims may have been lost)
    if (e && e.apiCode === 'incomplete_run') {
      try {
        await _reconcileCoinClaims(runId);
        const retryData = await _lbApiRequest('/run/finish', finishBody);
        _sharedRunId = '';
        _claimedCoinIds.clear();
        _failedCoinIds.clear();
        _pendingCoinReports.clear();
        _sharedOnline = true;
        _statusNote = '';
        const responseMode = _sanitizeMode((retryData && retryData.mode) || runMode);
        const rawList = Array.isArray(retryData.leaderboard) ? retryData.leaderboard.slice() : [];
        const retryEntry = (retryData && retryData.entry) ? retryData.entry : {};
        const retryEntryId = String(retryEntry.id || '');
        if (isTestRun && retryEntryId && !rawList.some((r) => String(r && r.id || '') === retryEntryId)) {
          rawList.push({
            id: retryEntryId,
            name: _sanitizePlayerName(retryEntry.name || _playerName || 'Player'),
            timeMs: Math.floor(Number(retryEntry.timeMs) || Math.floor(timeMs)),
            at: Math.floor(Number(retryEntry.at) || Date.now()),
            catColor: sanitizeColorKey(retryEntry.catColor || catColorKey),
            catHair: sanitizeHairKey(retryEntry.catHair || catHairKey),
            catModel: sanitizeModelKey(retryEntry.catModel || catModelKey),
            playerId: _playerId,
            mode: responseMode
          });
        }
        const list = _normalizeLeaderboard(rawList);
        _leaderboardByMode[responseMode] = list;
        if (_viewMode === responseMode) _leaderboard = list.slice();
        let resolvedRank = Math.floor(Number(retryData && retryData.rank) || 0);
        if (isTestRun && retryEntryId && resolvedRank === 0) {
          const idx = list.findIndex((r) => String(r && r.id || '') === retryEntryId);
          if (idx >= 0) resolvedRank = idx + 1;
        }
        return {
          entryId: retryEntryId,
          rank: resolvedRank,
          name: _sanitizePlayerName(retryEntry.name || _playerName || 'Player'),
          timeMs: Math.floor(Number(retryEntry.timeMs) || Math.floor(timeMs)),
          coins: coinTotal, coinTotal,
          secretCoins: secretCoins || 0,
          catColor: sanitizeColorKey(retryEntry.catColor || catColorKey),
          catHair: sanitizeHairKey(retryEntry.catHair || catHairKey),
          catModel: sanitizeModelKey(retryEntry.catModel || catModelKey),
          mode: responseMode,
          sharedSaved: true,
          isTestRun
        };
      } catch (_retryErr) {
        // Fall through to local fallback
      }
    }
    // API rejected or offline — fall back to local
    _sharedRunId = '';
    _claimedCoinIds.clear();
    _failedCoinIds.clear();
    _pendingCoinReports.clear();
    if (e && e.apiCode) {
      _sharedOnline = true;
      _statusNote = `Rejected (${e.apiCode})`;
      void refreshSharedLeaderboard(runMode);
      return { entryId: '', rank: 0, name: _playerName || 'Player', timeMs: Math.floor(timeMs), coins: coinTotal, coinTotal, secretCoins: secretCoins || 0, catColor: sanitizeColorKey(catColorKey), catHair: sanitizeHairKey(catHairKey), catModel: sanitizeModelKey(catModelKey), mode: runMode, sharedSaved: false, rejectionCode: e.apiCode };
    }
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    try { console.warn('[leaderboard] /run/finish failed; saving locally only.', e); } catch (_) { /* ignore */ }
    return _recordRunLocal(timeMs, coinTotal, secretCoins, runMode);
  }
}

export async function recordRun(timeMs, coinTotal, secretCoins, mode) {
  // Debug hook: force the next save to fail so the finish-dialog error
  // UI can be exercised. Set `window._lbDebugForceError = true` from
  // the DevTools console; it auto-clears after one use so the retry
  // succeeds. Bypasses the local-fallback path on purpose.
  if (typeof window !== 'undefined' && window._lbDebugForceError) {
    window._lbDebugForceError = false;
    await new Promise(r => setTimeout(r, Number(window._lbDebugSaveDelay) || 0));
    throw new Error('Forced debug save error');
  }
  const runMode = _sanitizeMode(mode || _currentRunMode);
  if (LB_SHARED_ENABLED) {
    return _recordRunShared(timeMs, coinTotal, secretCoins, runMode);
  }
  return _recordRunLocal(timeMs, coinTotal, secretCoins, runMode);
}

function _latestEntryForPlayer(rows, playerId) {
  const pid = _sanitizePlayerId(playerId);
  if (!pid) return null;
  let latest = null;
  for (const row of (rows || [])) {
    if (!row) continue;
    if (_sanitizePlayerId(row.playerId || '') !== pid) continue;
    if (!latest || Number(row.at || 0) > Number(latest.at || 0)) latest = row;
  }
  return latest;
}

function _findEntryMode(entryId) {
  const cleanId = String(entryId || '').trim();
  if (!cleanId) return null;
  for (const mode of VALID_LEADERBOARD_MODES) {
    const list = _leaderboardByMode[mode] || [];
    if (list.some((row) => String(row && row.id || '') === cleanId)) return mode;
  }
  return null;
}

function _renameLatestEntryLocal(entryId, nextName, baseData) {
  const cleanId = String(entryId || '').trim();
  const cleanName = _sanitizePlayerName(nextName || '');
  if (!cleanId || !cleanName) return null;

  const targetMode = _findEntryMode(cleanId) || _viewMode;
  const list = _leaderboardByMode[targetMode] || [];
  const idx = list.findIndex((row) => String(row && row.id || '') === cleanId);
  if (idx < 0) return null;

  const target = list[idx];
  const targetPid = _sanitizePlayerId(target.playerId || '');
  if (!targetPid || targetPid !== _playerId) return null;

  const latest = _latestEntryForPlayer(list, _playerId);
  if (!latest || String(latest.id || '') !== cleanId) return null;

  list[idx] = { ...target, name: cleanName };
  const merged = _normalizeLeaderboard(list);
  _leaderboardByMode[targetMode] = merged;
  if (_viewMode === targetMode) _leaderboard = merged.slice();
  _saveLeaderboard(targetMode);

  const rank = merged.findIndex((row) => String(row.id || '') === cleanId) + 1;
  const row = merged.find((r) => String(r.id || '') === cleanId) || merged[idx];
  return {
    ...(baseData || {}),
    entryId: cleanId,
    rank: rank > 0 ? rank : 0,
    name: cleanName,
    timeMs: Math.floor(Number((row && row.timeMs) || (baseData && baseData.timeMs) || 0)),
    catColor: sanitizeColorKey((row && row.catColor) || (baseData && baseData.catColor) || catColorKey),
    catHair: sanitizeHairKey((row && row.catHair) || (baseData && baseData.catHair) || catHairKey),
    catModel: sanitizeModelKey((row && row.catModel) || (baseData && baseData.catModel) || catModelKey),
    mode: targetMode,
    sharedSaved: false
  };
}

async function _renameLatestEntryShared(entryId, nextName, baseData) {
  const cleanId = String(entryId || '').trim();
  const cleanName = _sanitizePlayerName(nextName || '');
  if (!cleanId || !cleanName) return null;

  if (!_sharedOnline) return _renameLatestEntryLocal(cleanId, cleanName, baseData);

  try {
    const data = await _lbApiRequest('/run/rename', {
      entryId: cleanId,
      name: cleanName,
      playerId: _playerId,
    });
    _sharedOnline = true;
    _statusNote = '';
    const responseMode = _sanitizeMode((data && data.mode) || _findEntryMode(cleanId) || _currentRunMode);
    const serverEntry = (data && data.entry) ? data.entry : {};
    const wasTestRun = !!(baseData && baseData.isTestRun);
    if (Array.isArray(data.leaderboard)) {
      const rawList = data.leaderboard.slice();
      // If the renamed entry was a test run it won't come back in the
      // server's leaderboard (worker hides is_test=1). Splice it in so
      // the player still sees their entry locally.
      if (wasTestRun && cleanId && !rawList.some((r) => String(r && r.id || '') === cleanId)) {
        rawList.push({
          id: cleanId,
          name: _sanitizePlayerName(serverEntry.name || cleanName || _playerName || 'Player'),
          timeMs: Math.floor(Number(serverEntry.timeMs) || Number((baseData && baseData.timeMs) || 0)),
          at: Math.floor(Number(serverEntry.at) || Date.now()),
          catColor: sanitizeColorKey(serverEntry.catColor || (baseData && baseData.catColor) || catColorKey),
          catHair: sanitizeHairKey(serverEntry.catHair || (baseData && baseData.catHair) || catHairKey),
          catModel: sanitizeModelKey(serverEntry.catModel || (baseData && baseData.catModel) || catModelKey),
          playerId: _playerId,
          mode: responseMode
        });
      }
      const list = _normalizeLeaderboard(rawList);
      _leaderboardByMode[responseMode] = list;
      if (_viewMode === responseMode) _leaderboard = list.slice();
    }
    let resolvedRank = Math.floor(Number(data && data.rank) || 0);
    if (wasTestRun && cleanId && resolvedRank === 0) {
      const list = _leaderboardByMode[responseMode] || [];
      const idx = list.findIndex((r) => String(r && r.id || '') === cleanId);
      if (idx >= 0) resolvedRank = idx + 1;
    }
    return {
      ...(baseData || {}),
      entryId: cleanId,
      rank: resolvedRank,
      name: _sanitizePlayerName(serverEntry.name || cleanName || (baseData && baseData.name) || _playerName || 'Player'),
      timeMs: Math.floor(Number(serverEntry.timeMs) || Number((baseData && baseData.timeMs) || 0)),
      catColor: sanitizeColorKey(serverEntry.catColor || (baseData && baseData.catColor) || catColorKey),
      catHair: sanitizeHairKey(serverEntry.catHair || (baseData && baseData.catHair) || catHairKey),
      catModel: sanitizeModelKey(serverEntry.catModel || (baseData && baseData.catModel) || catModelKey),
      mode: responseMode,
      sharedSaved: true
    };
  } catch (e) {
    if (e && e.apiCode) {
      // Older deployed backends may not have /run/rename yet.
      if (e.apiCode === 'not_found' || e.httpStatus === 404) {
        _sharedOnline = false;
        _statusNote = 'Local rename fallback';
        return _renameLatestEntryLocal(cleanId, cleanName, baseData);
      }
      _sharedOnline = true;
      _statusNote = `Rename rejected (${e.apiCode})`;
      void refreshSharedLeaderboard(_viewMode);
      return null;
    }
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    try { console.warn('[leaderboard] /run/rename failed; renaming locally only.', e); } catch (_) { /* ignore */ }
    return _renameLatestEntryLocal(cleanId, cleanName, baseData);
  }
}

async function _renameLatestEntry(entryId, nextName, baseData) {
  if (LB_SHARED_ENABLED) return _renameLatestEntryShared(entryId, nextName, baseData);
  return _renameLatestEntryLocal(entryId, nextName, baseData);
}

// ── Filter: keep only top N entries per player ────────────────────
// List must already be sorted by time. Returns indices to show.
const MAX_PER_PLAYER = 5;
function _visibleIndices(board) {
  const counts = {};
  const vis = [];
  for (let i = 0; i < board.length; i++) {
    const r = board[i];
    const key = r.playerId ? `id:${r.playerId}` : `name:${r.name}`;
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] <= MAX_PER_PLAYER) vis.push(i);
  }
  return vis;
}

// ── Render leaderboard panel (in-game, shown on pause) ──────────────

function _renderLeaderboardTabs() {
  const tabsHost = document.getElementById('fpLeaderboardTabs');
  if (!tabsHost) return;
  const buttons = tabsHost.querySelectorAll('[data-lb-mode]');
  buttons.forEach((btn) => {
    const mode = _sanitizeMode(btn.getAttribute('data-lb-mode'));
    const active = mode === _viewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

export function renderLeaderboardPanel() {
  _renderLeaderboardTabs();
  const list = document.getElementById('fpLeaderboardList');
  const emptyEl = document.getElementById('fpLeaderboardEmpty');
  if (!list) return;
  if (!_leaderboard.length) {
    list.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  // Show top 30 visible entries (after per-player cap) in the pause card
  const vis = _visibleIndices(_leaderboard);
  const top = vis.slice(0, 30);
  const latestEntryId = String(((_lastRunData && _lastRunData.entryId) || (_finishDialogData && _finishDialogData.entryId) || '')).trim();
  list.innerHTML = top.map((idx, rank) => {
    const r = _leaderboard[idx];
    const isHistory = r.playerId ? (r.playerId === _playerId) : (r.name === _playerName);
    const isCurrent = !!latestEntryId && String(r.id || '') === latestEntryId;
    const rowClass = `${isHistory ? 'own-history ' : ''}${isCurrent ? 'own-current' : ''}`.trim();
    return `<li class="${rowClass}">
      <span class="rk">#${rank + 1}</span>
      <span class="nm">${_escapeHtml(r.name)}</span>
      ${_catBadgeHtml(r)}
      <span class="tm">${formatRunTime(r.timeMs, true)}</span>
    </li>`;
  }).join('');
}

// ── Share / Copy result ─────────────────────────────────────────────

function _buildLeaderboardUrl(entryId /*, timeMs */) {
  const base = `${location.origin}/leaderboard`;
  const cleanId = String(entryId || '').trim();
  // The leaderboard page resolves name/time from the entry ID via the API,
  // so we no longer need (or want) a redundant ?timeMs= in shared links.
  return cleanId ? `${base}?entry=${encodeURIComponent(cleanId)}` : base;
}

function _buildShareText(data) {
  const row = data || {};
  const catColor = sanitizeColorKey(row.catColor || catColorKey);
  const catModel = sanitizeModelKey(row.catModel || catModelKey);
  const modelEmoji = CAT_MODEL_EMOJI[catModel] || '🐱';
  const modelLabel = CAT_MODEL_LABELS_SHORT[catModel] || 'Cat';
  // Only models with a coat picker surface a color chip — everything else
  // (classic, bababooey, totodile, korra) ships with baked-in colors.
  const colorChip = isColorable(catModel)
    ? ` · ${CAT_COLOR_EMOJI[catColor] || ''} ${catColor.charAt(0).toUpperCase() + catColor.slice(1)}`
    : '';
  const url = _buildLeaderboardUrl(row.entryId || '', row.timeMs || 0);
  const secretCount = Math.floor(Number(row.secretCoins) || 0);
  const secretChip = ` · 🔵 ${secretCount}/${TOTAL_SECRETS} secrets`;
  const rank = Math.floor(Number(row.rank) || 0);
  const rankChip = rank > 0 ? ` · #${rank}` : '';
  const runMode = _sanitizeMode(row.mode || _currentRunMode);
  const modeChip = runMode === 'speed' ? ' ⚡' : '';
  const time = formatRunTime(row.timeMs || 0, true);
  return [
    `Beat my time on Zoomies${modeChip} · ${time}${rankChip} · ${modelEmoji} ${modelLabel}${colorChip}${secretChip}`,
    url
  ].join('\n');
}

async function _copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

// ── HUD Share button ────────────────────────────────────────────────

let _lastRunData = null;

export function showShareButton(data) {
  _lastRunData = data || null;
  const row = document.getElementById('fpShareRow');
  if (row) row.style.display = _lastRunData ? '' : 'none';
}

export function hideShareButton() {
  _lastRunData = null;
  const row = document.getElementById('fpShareRow');
  if (row) row.style.display = 'none';
}

export async function copyLastResult() {
  if (!_lastRunData) return false;
  const btn = document.getElementById('fpShareBtn');
  try {
    await _copyTextToClipboard(_buildShareText(_lastRunData));
    if (btn) btn.textContent = 'Copied!';
    setTimeout(() => { if (btn) btn.textContent = 'Copy result'; }, 1300);
    return true;
  } catch (err) {
    if (btn) btn.textContent = 'Copy failed';
    setTimeout(() => { if (btn) btn.textContent = 'Copy result'; }, 1500);
    return false;
  }
}

// ── Name dialog ─────────────────────────────────────────────────────

let _nameDialogOpen = false;
let _nameDialogAfterClose = null;
let _nameDialogManualTyped = false;
let _nameDialogOpenedAt = 0;
let _nameDialogFocusTrap = null;
let _nameDialogSavedFocus = null;

export function isNameDialogOpen() { return _nameDialogOpen; }

export function openNameDialog(force, onAfterClose) {
  if (!force && _hasCustomPlayerName()) {
    if (onAfterClose) onAfterClose();
    return;
  }
  _nameDialogAfterClose = typeof onAfterClose === 'function' ? onAfterClose : null;
  _nameDialogOpen = true;
  _nameDialogManualTyped = false;
  _nameDialogOpenedAt = performance.now();

  if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();

  const overlay = document.getElementById('nameDialogOverlay');
  const input = document.getElementById('nameDialogInput');
  const hint = document.getElementById('nameDialogHint');
  if (overlay) {
    overlay.style.display = 'flex';
    _nameDialogSavedFocus = saveFocus();
    _nameDialogFocusTrap = trapFocus(overlay);
  }

  const lastName = _readPlayerName();
  const prefill = lastName && lastName !== 'Player' ? lastName : '';
  if (hint) {
    hint.textContent = prefill
      ? 'Press Enter to keep your last name, type to rename.'
      : 'Press Enter to save, or Esc to cancel.';
  }
  if (input) {
    input.value = '';
    input.setAttribute('readonly', 'readonly');
    setTimeout(() => {
      input.removeAttribute('readonly');
      input.focus();
      if (prefill) {
        input.value = prefill;
        _nameDialogManualTyped = true;
        try { input.setSelectionRange(prefill.length, prefill.length); } catch (e) { /* ignore */ }
      }
      _updateNameDialogCount();
    }, 30);
  }
}

function _closeNameDialog() {
  if (!_nameDialogOpen) return;
  _nameDialogOpen = false;
  const overlay = document.getElementById('nameDialogOverlay');
  if (overlay) overlay.style.display = 'none';
  if (_nameDialogFocusTrap) { _nameDialogFocusTrap.release(); _nameDialogFocusTrap = null; }
  if (_nameDialogSavedFocus) { _nameDialogSavedFocus.restore(); _nameDialogSavedFocus = null; }
  const input = document.getElementById('nameDialogInput');
  if (input) { input.value = ''; input.blur(); }
  const afterClose = _nameDialogAfterClose;
  _nameDialogAfterClose = null;
  if (afterClose) afterClose();
}

function _updateNameDialogCount() {
  const input = document.getElementById('nameDialogInput');
  const counter = document.getElementById('nameDialogCount');
  if (!input || !counter) return;
  const max = Number(input.getAttribute('maxlength')) || 24;
  const len = (input.value || '').length;
  counter.textContent = `${len}/${max}`;
  counter.classList.toggle('on', len >= Math.ceil(max * 0.75));
  counter.classList.toggle('warn', len >= Math.ceil(max * 0.9) && len < max);
  counter.classList.toggle('max', len >= max);
}

// ── Finish dialog ───────────────────────────────────────────────────

let _finishDialogOpen = false;
let _finishDialogData = null;
let _finishPendingRun = null;
let _finishEditableEntryId = '';
let _finishSubmitting = false;
let _finishSubmitPromise = null;
let _finishNameDirty = false;
let _finishSaveStatus = 'idle';
let _onPlayAgain = null;
let _onExitGame = null;
let _finishFocusTrap = null;
let _finishSavedFocus = null;

const _finishPreviewBaseYaw = THREE.MathUtils.degToRad(35);
let _finishPreviewRenderer = null;
let _finishPreviewScene = null;
let _finishPreviewCamera = null;
let _finishPreviewCanvas = null;
let _finishPreviewModel = null;
let _finishPreviewModelKey = '';
let _finishPreviewColorKey = '';
let _finishPreviewHairKey = '';
let _finishPreviewRaf = 0;
let _finishPreviewLoader = null;
let _finishPreviewLoadToken = 0;
let _finishPreviewLoading = false;

export function isFinishDialogOpen() { return _finishDialogOpen; }

export function setCallbacks(opts) {
  _onPlayAgain = opts.onPlayAgain || null;
  _onExitGame = opts.onExitGame || null;
}

function _disposeFinishPreviewModel(model) {
  if (!model) return;
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    if (!o.material) return;
    if (Array.isArray(o.material)) {
      for (const m of o.material) if (m && typeof m.dispose === 'function') m.dispose();
    } else if (typeof o.material.dispose === 'function') {
      o.material.dispose();
    }
  });
}

function _clearFinishPreviewModel() {
  if (!_finishPreviewScene || !_finishPreviewModel) return;
  _finishPreviewScene.remove(_finishPreviewModel);
  _disposeFinishPreviewModel(_finishPreviewModel);
  _finishPreviewModel = null;
}

function _resizeFinishPreview() {
  if (!_finishPreviewRenderer || !_finishPreviewCamera || !_finishPreviewCanvas) return;
  const rect = _finishPreviewCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  _finishPreviewRenderer.setSize(rect.width, rect.height, false);
  _finishPreviewCamera.aspect = rect.width / rect.height;
  _finishPreviewCamera.updateProjectionMatrix();
}

function _startFinishPreviewLoop() {
  if (_finishPreviewRaf) return;
  const tick = () => {
    if (!_finishDialogOpen || !_finishPreviewRenderer || !_finishPreviewScene || !_finishPreviewCamera) {
      _finishPreviewRaf = 0;
      return;
    }
    _resizeFinishPreview();
    if (_finishPreviewModel) _finishPreviewModel.rotation.y += 0.012;
    _finishPreviewRenderer.render(_finishPreviewScene, _finishPreviewCamera);
    _finishPreviewRaf = requestAnimationFrame(tick);
  };
  _finishPreviewRaf = requestAnimationFrame(tick);
}

function _stopFinishPreviewLoop() {
  if (!_finishPreviewRaf) return;
  cancelAnimationFrame(_finishPreviewRaf);
  _finishPreviewRaf = 0;
}

function _ensureFinishPreviewRenderer() {
  const canvas = document.getElementById('finishDialogCatCanvas');
  if (!canvas) return false;
  if (_finishPreviewRenderer && _finishPreviewCanvas === canvas) return true;

  _finishPreviewCanvas = canvas;
  _finishPreviewRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  _finishPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _finishPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  _finishPreviewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  _finishPreviewRenderer.toneMappingExposure = 1.5;

  _finishPreviewScene = new THREE.Scene();
  _finishPreviewCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  _finishPreviewCamera.position.set(0, 1.5, 10); // default, overridden by auto-frame
  _finishPreviewCamera.lookAt(0, 1, 0);

  _finishPreviewScene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const keyLight = new THREE.DirectionalLight(0xffeedd, 1.6);
  keyLight.position.set(3, 5, 4);
  _finishPreviewScene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x8899bb, 0.6);
  rimLight.position.set(-3, 2, -4);
  _finishPreviewScene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xddeeff, 0.4);
  fillLight.position.set(-1, 0, 5);
  _finishPreviewScene.add(fillLight);

  if (!_finishPreviewLoader) _finishPreviewLoader = new GLTFLoader();
  _resizeFinishPreview();
  return true;
}

function _tintFinishPreviewModel(model, modelKey, colorKey) {
  if (!model || !isColorable(modelKey)) return;
  const coat = new THREE.Color((CAT_COLOR_PRESETS[colorKey] || CAT_COLOR_PRESETS.charcoal).coat);
  const skip = /(eye|pupil|nose|mouth|tongue|tooth|teeth|whisker|inner|ear)/i;
  model.traverse(o => {
    if (!o.isMesh || !o.material) return;
    if (skip.test(String(o.name || ''))) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.color || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
      // Same approach as character select: set to coat then lighten 30% toward white
      m.color.copy(coat).lerp(new THREE.Color(0xffffff), 0.3);
      m.needsUpdate = true;
    }
  });
}

function _stripFinishPreviewBackdrop(model) {
  if (!model) return;
  const nameHint = /(graph|chart|grid|axis|axes|backdrop|background|board|screen|panel|plane|pplane|lambert1)/i;
  const toRemove = [];

  model.traverse(child => {
    if (!child.isMesh) return;
    const name = (child.name || '').toLowerCase();
    const matName = (child.material && child.material.name || '').toLowerCase();
    if (nameHint.test(name) || nameHint.test(matName)) {
      toRemove.push(child);
    }
  });

  // Fallback: remove the largest planar mesh if no name match.
  if (toRemove.length === 0) {
    let biggest = null;
    let biggestArea = 0;
    model.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      const sx = bb.max.x - bb.min.x;
      const sy = bb.max.y - bb.min.y;
      const sz = bb.max.z - bb.min.z;
      const dims = [sx, sy, sz].sort((a, b) => b - a);
      if (dims[2] < dims[0] * 0.1) {
        const area = dims[0] * dims[1];
        if (area > biggestArea) {
          biggestArea = area;
          biggest = child;
        }
      }
    });
    if (biggest) toRemove.push(biggest);
  }

  for (const mesh of toRemove) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
      else mesh.material.dispose();
    }
  }
}

function _placeFinishPreviewModel(model, modelKey) {
  const targetHeight = 3;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 0.001);
  const scale = targetHeight / h;
  model.scale.setScalar(scale);

  // Two-pass grounding: center XZ, ground on box.min.y, then correct
  // with foot bone positions for accurate grounding on any model.
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.updateMatrixWorld(true);
  let minFootY = Infinity;
  const _tmpV = new THREE.Vector3();
  model.traverse(o => {
    if (!o || !o.isBone) return;
    if (!/foot|toe|paw/i.test(String(o.name || ''))) return;
    o.getWorldPosition(_tmpV);
    if (_tmpV.y < minFootY) minFootY = _tmpV.y;
  });
  if (Number.isFinite(minFootY)) model.position.y -= minFootY;

  model.rotation.y = _finishPreviewBaseYaw;

  // Auto-frame camera to fit this model
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fovRad = THREE.MathUtils.degToRad(_finishPreviewCamera.fov);
  const fitDist = (sphere.radius * 0.95) / Math.sin(fovRad / 2);
  _finishPreviewCamera.position.set(
    sphere.center.x + fitDist * 0.12,
    sphere.center.y + fitDist * 0.08,
    sphere.center.z + fitDist
  );
  _finishPreviewCamera.lookAt(sphere.center.x, sphere.center.y * 0.85, sphere.center.z);
  _finishPreviewCamera.updateProjectionMatrix();
}

function _setFinishPreviewModel(modelKey, colorKey, hairKey) {
  const safeModel = sanitizeModelKey(modelKey);
  const safeColor = sanitizeColorKey(colorKey);
  const safeHair = sanitizeHairKey(hairKey);

  if (!_ensureFinishPreviewRenderer()) return;
  if (
    _finishPreviewModelKey === safeModel &&
    _finishPreviewColorKey === safeColor &&
    _finishPreviewHairKey === safeHair &&
    (_finishPreviewModel || _finishPreviewLoading)
  ) {
    _startFinishPreviewLoop();
    return;
  }

  _finishPreviewModelKey = safeModel;
  _finishPreviewColorKey = safeColor;
  _finishPreviewHairKey = safeHair;
  _clearFinishPreviewModel();

  const preset = CAT_MODEL_PRESETS[safeModel] || CAT_MODEL_PRESETS.classic;
  const token = ++_finishPreviewLoadToken;
  _finishPreviewLoading = true;

  const installModel = (model) => {
    if (token !== _finishPreviewLoadToken) {
      _disposeFinishPreviewModel(model);
      return;
    }
    if (safeModel === 'bababooey') _stripFinishPreviewBackdrop(model);
    _placeFinishPreviewModel(model, safeModel);
    _tintFinishPreviewModel(model, safeModel, safeColor);
    _finishPreviewScene.add(model);
    _finishPreviewModel = model;
    _finishPreviewLoading = false;
    _startFinishPreviewLoop();
  };

  // Procedural models (e.g. Korra) are built in code rather than loaded
  // from a GLB. Without this branch the preview silently falls back to
  // the classic cat glb and shows the wrong character.
  if (preset.procedural) {
    import('./korra-model.js').then(({ buildKorraModel }) => {
      if (token !== _finishPreviewLoadToken) return;
      const result = buildKorraModel();
      installModel(result.scene);
    }).catch(err => {
      if (token === _finishPreviewLoadToken) _finishPreviewLoading = false;
      console.warn('[leaderboard] procedural finish preview failed', err);
    });
    return;
  }

  const sources = (preset.sources && preset.sources.length ? preset.sources : ['assets/cat.glb']).slice();

  const tryLoad = (idx) => {
    if (idx >= sources.length || !_finishPreviewLoader) {
      if (token === _finishPreviewLoadToken) _finishPreviewLoading = false;
      return;
    }
    _finishPreviewLoader.load(sources[idx], (gltf) => {
      installModel(gltf.scene);
    }, undefined, () => {
      tryLoad(idx + 1);
    });
  };

  tryLoad(0);
}

function _openFinishDialogOverlay(focusNameInput = false) {
  _finishDialogOpen = true;

  if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();

  const overlay = document.getElementById('finishDialogOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    _finishSavedFocus = saveFocus();
    _finishFocusTrap = trapFocus(overlay);
  }
  _renderFinishDialog();
  // Focus relevant control after render
  requestAnimationFrame(() => {
    const target = focusNameInput
      ? _getFinishRowNameInput()
      : document.getElementById('finishDialogAgain');
    if (!target) return;
    target.focus();
    if (focusNameInput && typeof target.setSelectionRange === 'function') {
      const len = String(target.value || '').length;
      try { target.setSelectionRange(len, len); } catch (e) { /* ignore */ }
    }
  });
}

export function openFinishDialog(data) {
  _finishDialogData = data || null;
  _finishPendingRun = null;
  _finishEditableEntryId = '';
  _finishSubmitting = false;
  _finishSubmitPromise = null;
  _finishNameDirty = false;
  _finishSaveStatus = 'saved';
  _openFinishDialogOverlay(false);
}

export function openFinishDialogForRun(timeMs, coinTotal, secretCoins) {
  // ⚠ Coin count INVARIANT (see src/main.js run-completion check):
  // `coinTotal` here is the player's final coin score AND the run's
  // total available coins — they're equal by construction because we
  // only call this when coinScore >= coinTotal. The HUD `score/total`
  // and the saved leaderboard row must stay in sync; both ultimately
  // come from coins.coinTotal. Don't pass anything else without also
  // updating the call site in main.js.
  const safeTime = Math.max(1, Math.floor(Number(timeMs) || 0));
  const safeCoins = Math.max(0, Math.floor(Number(coinTotal) || 0));
  const safeSecret = Math.max(0, Math.floor(Number(secretCoins) || 0));
  const fallbackName = _sanitizePlayerName(_readPlayerName() || _playerName || 'Player') || 'Player';

  setPlayerName(fallbackName, true);
  hideShareButton();

  _finishPendingRun = { timeMs: safeTime, coinTotal: safeCoins, secretCoins: safeSecret };
  _finishEditableEntryId = '';
  _finishSubmitting = false;
  _finishSubmitPromise = null;
  _finishNameDirty = false;
  _finishSaveStatus = 'idle';
  _finishDialogData = {
    entryId: '',
    rank: 0,
    name: fallbackName,
    timeMs: safeTime,
    coins: safeCoins,
    coinTotal: safeCoins,
    secretCoins: safeSecret,
    catColor: sanitizeColorKey(catColorKey),
    catHair: sanitizeHairKey(catHairKey),
    catModel: sanitizeModelKey(catModelKey)
  };

  // Open the dialog and focus the name input immediately so the player
  // can start typing while the save runs in the background. The save
  // kicks off in parallel; the action buttons are disabled in the
  // render until it resolves. If the player has typed by the time the
  // save resolves, _submitPendingFinishRun preserves their value and
  // schedules a follow-up rename.
  _openFinishDialogOverlay(true);
  void _submitPendingFinishRun();
}

export function closeFinishDialog() {
  if (!_finishDialogOpen) return;
  _finishDialogOpen = false;
  _stopFinishPreviewLoop();
  _finishDialogData = null;
  _finishPendingRun = null;
  _finishEditableEntryId = '';
  _finishSubmitting = false;
  _finishSubmitPromise = null;
  _finishNameDirty = false;
  _finishSaveStatus = 'idle';
  const overlay = document.getElementById('finishDialogOverlay');
  if (overlay) overlay.style.display = 'none';
  if (_finishFocusTrap) { _finishFocusTrap.release(); _finishFocusTrap = null; }
  if (_finishSavedFocus) { _finishSavedFocus.restore(); _finishSavedFocus = null; }
  const copyBtn = document.getElementById('finishDialogCopy');
  if (copyBtn) copyBtn.innerHTML = '<i class="ph-fill ph-copy"></i> Copy &amp; share result';
}

function _getFinishRowNameInput() {
  return document.querySelector('#finishDialogList .finishDialogRowNameInput');
}

function _focusFinishRowNameInput() {
  requestAnimationFrame(() => {
    const input = _getFinishRowNameInput();
    if (!input || input.disabled) return;
    input.focus();
    if (typeof input.setSelectionRange === 'function') {
      const len = String(input.value || '').length;
      try { input.setSelectionRange(len, len); } catch (e) { /* ignore */ }
    }
  });
}

function _submitPendingFinishRun() {
  const hasPendingRun = !!_finishPendingRun;
  const currentEntryId = String((_finishDialogData && _finishDialogData.entryId) || '').trim();
  const canRenameSavedEntry = !hasPendingRun && !!_finishEditableEntryId && currentEntryId === _finishEditableEntryId;

  if (!hasPendingRun) {
    if (!canRenameSavedEntry || !_finishNameDirty) return Promise.resolve(_finishDialogData);
  }
  if (_finishSubmitting && _finishSubmitPromise) return _finishSubmitPromise;

  const input = _getFinishRowNameInput();
  const typedName = _sanitizePlayerName(input ? input.value : '');
  const fallbackName = _sanitizePlayerName(_readPlayerName() || _playerName || 'Player') || 'Player';
  const name = typedName || fallbackName;

  if (input && !typedName) input.value = name;

  setPlayerName(name, true);
  _finishDialogData = { ...(_finishDialogData || {}), name };
  _finishSubmitting = true;
  _finishNameDirty = false;
  _finishSaveStatus = 'saving';
  // Only disable the input for the (fast) rename pass; keep it editable
  // during the (slow) initial run save so the player can type their name
  // while the API call is in flight.
  if (input && !hasPendingRun) input.disabled = true;
  _renderFinishDialog();

  const submittedName = name;
  // Minimum time the "Saving…" state stays visible for the initial run
  // save. If the API (or local fallback) resolves faster than this, we
  // delay the pending→saved transition so the player has time to see the
  // spinner and start typing their name. Renames don't get this delay
  // because they're already a deliberate user action with feedback.
  const MIN_SAVING_MS = hasPendingRun ? 700 : 0;
  const savingStartedAt = Date.now();
  const waitForMinSaving = async () => {
    const remaining = MIN_SAVING_MS - (Date.now() - savingStartedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  };

  const job = (async () => {
    try {
      if (hasPendingRun) {
        const pending = _finishPendingRun;
        const runData = await recordRun(pending.timeMs, pending.coinTotal, pending.secretCoins);
        // Hold the saving spinner visible for the minimum window so the
        // player has time to start typing their name. This is the only
        // delay we add — the actual save already completed.
        await waitForMinSaving();
        // Server rejections (e.g. coin_count_mismatch) come back as a
        // sentinel { entryId: '', rejectionCode } — no real entry was
        // written. Treat as an error so the pending row stays visible
        // (player keeps their typed name + time + cat) and surfaces an
        // inline error next to the input. The retry happens when the
        // player taps Exit / Play again, which both call back into
        // _submitPendingFinishRun before they navigate away.
        const gotEntryId = !!(runData && String(runData.entryId || '').trim());
        if (!gotEntryId) {
          _finishSubmitting = false;
          _finishSaveStatus = 'error';
          _finishNameDirty = true;
          // Preserve the rejection code on the dialog data so the hint
          // can include it ("Couldn't save run (code)…"). Keep the
          // pending run intact — render will continue showing the
          // optimistic row as long as _finishPendingRun is set.
          if (runData && runData.rejectionCode) {
            _finishDialogData = { ...(_finishDialogData || {}), rejectionCode: runData.rejectionCode };
          }
          if (input) input.disabled = false;
          _renderFinishDialog();
          return null;
        }
        // Re-read the input now that the user had a chance to type.
        const preTransitionInput = _getFinishRowNameInput();
        const preTransitionTypedName = preTransitionInput ? _sanitizePlayerName(preTransitionInput.value) : '';
        _finishPendingRun = null;
        _finishEditableEntryId = String((runData && runData.entryId) || '').trim();
        _finishSubmitting = false;
        _finishSaveStatus = 'saved';

        // If the player typed something during the save, preserve their
        // value (don't clobber with the server response) and schedule a
        // follow-up rename so the leaderboard ends up with their name.
        const liveTypedName = preTransitionTypedName;
        let resolvedData = runData || null;
        let needsRename = false;
        if (resolvedData && liveTypedName && liveTypedName !== submittedName) {
          resolvedData = { ...resolvedData, name: liveTypedName };
          _finishNameDirty = true;
          _finishSaveStatus = 'idle';
          needsRename = true;
        }
        _finishDialogData = resolvedData;
        renderLeaderboardPanel();
        showShareButton(runData);
        _renderFinishDialog();
        if (needsRename) {
          // Defer so the just-rendered input is in the DOM before the
          // rename pass reads its value.
          setTimeout(() => { void _submitPendingFinishRun(); }, 0);
        } else {
          _focusFinishRowNameInput();
        }
        return runData;
      }

      const renamed = await _renameLatestEntry(_finishEditableEntryId, name, _finishDialogData || {});
      if (!renamed) throw new Error('rename_failed');
      _finishSubmitting = false;
      _finishSaveStatus = 'saved';
      _finishDialogData = renamed;
      renderLeaderboardPanel();
      showShareButton(renamed);
      _renderFinishDialog();
      return renamed;
    } catch (e) {
      _finishSubmitting = false;
      _finishSaveStatus = 'error';
      _finishNameDirty = true;
      if (input) input.disabled = false;
      _renderFinishDialog();
      return null;
    }
  })();

  _finishSubmitPromise = job.finally(() => {
    _finishSubmitPromise = null;
  });
  return _finishSubmitPromise;
}

function _renderFinishDialog() {
  const data = _finishDialogData || {};
  const pending = !!_finishPendingRun;
  const canRenameSavedEntry = !pending && !!_finishEditableEntryId && String(data.entryId || '').trim() === _finishEditableEntryId;
  const coinBadge = document.getElementById('finishDialogCoinBadge');
  const summaryTime = document.getElementById('finishDialogSummaryTime');
  const summaryRank = document.getElementById('finishDialogSummaryRank');
  const summarySecret = document.getElementById('finishDialogSummarySecret');
  const catText = document.getElementById('finishDialogCatText');
  const saveHint = document.getElementById('finishDialogSaveHint');
  const copyBtn = document.getElementById('finishDialogCopy');
  const list = document.getElementById('finishDialogList');

  const runTimeMs = Math.floor(Number(data.timeMs) || Number(_finishPendingRun?.timeMs) || 0);
  const rank = Math.floor(Number(data.rank) || 0);
  const secretCount = Math.max(0, Math.floor(Number(data.secretCoins) || Number(_finishPendingRun?.secretCoins) || 0));

  if (summaryTime) summaryTime.textContent = formatRunTime(runTimeMs, true);
  if (summaryRank) {
    if (pending) {
      summaryRank.innerHTML = '<span class="finishRankSkel" aria-hidden="true"></span>';
      summaryRank.setAttribute('aria-label', 'Saving rank');
    } else if (rank > 0) {
      summaryRank.textContent = `#${rank}`;
      summaryRank.removeAttribute('aria-label');
    } else {
      // Run isn't on the leaderboard (rejected, offline fallback, or didn't
      // make the cap). Show a neutral em-dash instead of inventing a label
      // the player has to decode.
      summaryRank.textContent = '—';
      summaryRank.setAttribute('aria-label', 'Not on leaderboard');
    }
  }
  if (summarySecret) {
    summarySecret.textContent = `${secretCount} found`;
  }
  if (catText) {
    const mk = sanitizeModelKey(data.catModel || catModelKey);
    const label = CAT_MODEL_LABELS_SHORT[mk] || 'Cat';
    catText.textContent = label;
  }
  _setFinishPreviewModel(
    sanitizeModelKey(data.catModel || catModelKey),
    sanitizeColorKey(data.catColor || catColorKey),
    sanitizeHairKey(data.catHair || catHairKey)
  );

  // Whether the latest save actually reached the shared leaderboard
  // server. Set by recordRun / renameLatestEntry. Falls through silent
  // local-only saves so the hint can be honest about offline state.
  const sharedSaved = !!(data && data.sharedSaved);
  const rejectionCode = data && data.rejectionCode ? String(data.rejectionCode) : '';
  // Test runs (Quick Coin Mode while developing locally) ARE saved on
  // the server but flagged is_test=1; the worker hides them from the
  // public leaderboard. We splice them into the local view so the
  // player sees their own time, but we should tell them why their entry
  // won't show up for anyone else.
  const isTestRun = !!(data && data.isTestRun);

  // Compute the save-hint state up front. The actual DOM write happens
  // after the list renders below, so we can prefer the row-attached
  // slot (visually adjacent to the input) over the top-level hint.
  const hintBusy = pending || _finishSaveStatus === 'saving';
  const hintError = _finishSaveStatus === 'error' || (!pending && _finishSaveStatus === 'saved' && !sharedSaved && !!_finishEditableEntryId === false);
  // Saved-success state: show the animated green checkmark in the
  // hint. Distinguishes a successful shared save from "Saved on this
  // device only" (offline fallback) and from the rejection error
  // state. Used by the row-hint CSS to tint the text green.
  const savedCheckSvg = '<svg class="finishSavedCheck" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><circle class="finishSavedCheck__ring" cx="11" cy="11" r="9" /><path class="finishSavedCheck__tick" d="M6.5 11.5 L9.5 14.5 L15.5 8" /></svg>';
  let hintSaved = false;
  let hintHtml = '';
  if (pending) {
    if (_finishSaveStatus === 'error') {
      const codeSuffix = rejectionCode ? ` (${_escapeHtml(rejectionCode)})` : '';
      hintHtml = `<i class="ph ph-warning-circle" aria-hidden="true"></i> Couldn\u2019t save run${codeSuffix}. Tap Play again or Exit to retry.`;
    } else {
      hintHtml = '<span class="finishSavingSpinner" aria-hidden="true"></span> Saving your run — you can type your name now.';
    }
  } else if (canRenameSavedEntry) {
    if (_finishSaveStatus === 'saving') {
      hintHtml = '<span class="finishSavingSpinner" aria-hidden="true"></span> Saving name…';
    } else if (_finishSaveStatus === 'error') {
      hintHtml = '<i class="ph ph-warning-circle" aria-hidden="true"></i> Save failed. Leave the field again to retry.';
    } else if (!sharedSaved) {
      hintHtml = '<i class="ph ph-cloud-slash" aria-hidden="true"></i> Saved on this device only — couldn\u2019t reach the leaderboard server. Edit your name above to retry.';
    } else if (isTestRun) {
      hintHtml = '<i class="ph ph-flask" aria-hidden="true"></i> Test run \u2014 saved but hidden from the public leaderboard. Type above to change your name anytime.';
    } else {
      hintHtml = `${savedCheckSvg} Saved. Type above to change your name anytime.`;
      hintSaved = true;
    }
  } else if (rejectionCode) {
    hintHtml = `<i class="ph ph-warning-circle" aria-hidden="true"></i> Server rejected this run (${_escapeHtml(rejectionCode)}).`;
  } else if (Math.floor(Number(data.rank) || 0) > 0 || _finishSaveStatus === 'saved') {
    if (isTestRun) {
      hintHtml = '<i class="ph ph-flask" aria-hidden="true"></i> Test run \u2014 saved but hidden from the public leaderboard.';
    } else if (sharedSaved) {
      hintHtml = `${savedCheckSvg} Saved.`;
      hintSaved = true;
    } else {
      hintHtml = '<i class="ph ph-cloud-slash" aria-hidden="true"></i> Saved on this device only.';
    }
  }

  // Action buttons stay visible the entire time so the layout doesn't
  // jump when the save resolves; they are disabled while the run is
  // still being saved (pending) so the player can't navigate away mid-
  // save. If the save errored, re-enable them so clicking acts as a
  // retry trigger (their click handlers call _submitPendingFinishRun).
  const buttonsBusy = pending && _finishSaveStatus !== 'error';
  const exitBtn = document.getElementById('finishDialogExit');
  const againBtn = document.getElementById('finishDialogAgain');
  const setBtnBusy = (btn) => {
    if (!btn) return;
    btn.disabled = buttonsBusy;
    btn.setAttribute('aria-disabled', buttonsBusy ? 'true' : 'false');
    btn.classList.toggle('finishDlgBtn--busy', buttonsBusy);
  };
  setBtnBusy(exitBtn);
  setBtnBusy(againBtn);
  if (copyBtn) {
    copyBtn.style.display = '';
    setBtnBusy(copyBtn);
  }

  if (coinBadge) {
    const c = Math.floor(Number(data.coins) || Number(data.coinTotal) || Number(_finishPendingRun?.coinTotal) || 0);
    const t = Math.floor(Number(data.coinTotal) || Number(_finishPendingRun?.coinTotal) || 0);
    coinBadge.textContent = `${c} / ${t}`;
  }
  if (!list && saveHint) {
    // Defensive fallback: if the list isn't in the DOM (shouldn't
    // happen in normal flow), still keep the top-level hint honest.
    saveHint.classList.toggle('finishDialogSaveHint--busy', hintBusy);
    saveHint.classList.toggle('finishDialogSaveHint--error', hintError);
    saveHint.classList.toggle('finishDialogSaveHint--saved', hintSaved);
    saveHint.innerHTML = hintHtml;
    saveHint.style.display = hintHtml ? '' : 'none';
  }
  if (list) {
    // Capture focus + selection on the row name input so we can restore
    // them after the list is rebuilt (rebuild creates a fresh <input>
    // node, which would otherwise drop focus while the player is typing
    // through the pending→saved transition).
    const activeEl = document.activeElement;
    const wasNameInputFocused = !!(
      activeEl &&
      activeEl.classList &&
      activeEl.classList.contains('finishDialogRowNameInput')
    );
    const prevSelStart = wasNameInputFocused && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
    const prevSelEnd = wasNameInputFocused && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;

    const ownId = String(data.entryId || '');
    const editableEntryId = canRenameSavedEntry ? _finishEditableEntryId : '';
    const rows = [];

    const finishMode = _sanitizeMode((data && data.mode) || _currentRunMode);
    const finishBoard = _leaderboardByMode[finishMode] || [];
    // Match the standalone /leaderboard board: scale the secret-coin
    // goal up if any row exceeds TOTAL_SECRETS, but never below it.
    const secretGoal = finishBoard.reduce((max, row) => {
      const n = Math.max(0, Math.floor(Number(row && row.secretCoins) || 0));
      return Math.max(max, n);
    }, TOTAL_SECRETS);
    if (finishBoard.length || pending) {
      // Build an optimistic "pending" row (own-current + pending) so the
      // player can see where their entry is going while the API save is
      // in flight. Position it by time among the local leaderboard; the
      // real rank/position will refresh when the save resolves.
      let pendingInsertAt = -1;
      let pendingHtml = '';
      if (pending) {
        const pendingName = _sanitizePlayerName(
          _finishDialogData?.name || _readPlayerName() || _playerName || 'Player'
        ) || 'Player';
        const pendingTimeMs = Math.floor(Number(_finishPendingRun?.timeMs) || Number(data.timeMs) || 0);
        const pendingSecretCoins = Math.max(0, Math.floor(Number(_finishPendingRun?.secretCoins ?? data.secretCoins) || 0));
        const pendingEntry = {
          catModel: data.catModel || catModelKey,
          catColor: data.catColor || catColorKey,
          catHair: data.catHair || catHairKey,
          secretCoins: pendingSecretCoins
        };
        pendingInsertAt = finishBoard.length;
        for (let i = 0; i < finishBoard.length; i++) {
          if (pendingTimeMs < finishBoard[i].timeMs) { pendingInsertAt = i; break; }
        }
        pendingHtml = `<li class="own-current pending" data-entry-id="">
          <span class="rk rk-pending" aria-label="Saving rank">
            <span class="finishRankSkel finishRankSkel--row" aria-hidden="true"></span>
          </span>
          <span class="nm nm-edit">
            <input type="text" class="finishDialogRowNameInput" maxlength="24" value="${_escapeHtml(pendingName)}" autocomplete="off" spellcheck="false" aria-label="Your name" />
          </span>
          ${_catBadgeHtml(pendingEntry)}
          ${_secretBadgeHtml(pendingEntry, secretGoal)}
          <span class="tm">${formatRunTime(pendingTimeMs, true)}</span>
          <span class="finishDialogRowSaveHint" data-finish-row-hint></span>
        </li>`;
      }

      const visSet = new Set(_visibleIndices(finishBoard));
      let displayRank = 0;

      for (let i = 0; i < finishBoard.length; i++) {
        if (pending && i === pendingInsertAt) { displayRank++; rows.push(pendingHtml); }
        if (!visSet.has(i)) continue;
        displayRank++;
        const r = finishBoard[i];
        const isHistory = !!r.playerId && r.playerId === _playerId;
        const isCurrent = !!ownId && r.id === ownId;
        const rowClass = `${isHistory ? 'own-history ' : ''}${isCurrent ? 'own-current' : ''}`.trim();
        const editable = !pending && !!editableEntryId && r.id === editableEntryId;
        rows.push(`<li class="${rowClass}" data-entry-id="${_escapeHtml(r.id)}">
          <span class="rk">#${displayRank}</span>
          <span class="nm ${editable ? 'nm-edit' : ''}">${editable
            ? `<input type="text" class="finishDialogRowNameInput" maxlength="24" value="${_escapeHtml(r.name)}" autocomplete="off" spellcheck="false" />`
            : _escapeHtml(r.name)
          }</span>
          ${_catBadgeHtml(r)}
          ${_secretBadgeHtml(r, secretGoal)}
          <span class="tm">${formatRunTime(r.timeMs, true)}</span>
          ${editable ? '<span class="finishDialogRowSaveHint" data-finish-row-hint></span>' : ''}
        </li>`);
      }
      if (pending && pendingInsertAt >= finishBoard.length) rows.push(pendingHtml);
    } else {
      rows.push('<li style="opacity:0.62;padding:8px 10px">No runs yet.</li>');
    }

    list.innerHTML = rows.join('');

    // Place the save hint into the editable row's name cell when one
    // exists (visually adjacent to the input). Otherwise fall back to
    // the top-level hint slot in the summary section.
    const rowHintSlot = list.querySelector('[data-finish-row-hint]');
    const targetHint = rowHintSlot || saveHint;
    if (targetHint) {
      targetHint.classList.toggle('finishDialogSaveHint--busy', hintBusy);
      targetHint.classList.toggle('finishDialogSaveHint--error', hintError);
      targetHint.classList.toggle('finishDialogSaveHint--saved', hintSaved);
      targetHint.innerHTML = hintHtml;
      targetHint.style.display = hintHtml ? '' : 'none';
    }
    if (rowHintSlot && saveHint) {
      saveHint.classList.remove('finishDialogSaveHint--busy', 'finishDialogSaveHint--error', 'finishDialogSaveHint--saved');
      saveHint.textContent = '';
      saveHint.style.display = 'none';
    }

    const rowInput = _getFinishRowNameInput();
    if (rowInput) {
      // The input is editable in two states: while the initial save is
      // pending (so the player can type during the network call), and
      // after the save resolves into a renameable entry. We only mark
      // it disabled while a rename pass is mid-flight.
      rowInput.disabled = _finishSubmitting && !pending;
      // Visual error state on the input itself when the last save
      // attempt failed. Cleared as soon as the player types or a
      // retry succeeds (status flips back to 'saving' / 'saved' /
      // 'idle' on the next render).
      rowInput.classList.toggle('finishDialogRowNameInput--error', _finishSaveStatus === 'error');
      if (_finishSaveStatus === 'error') {
        rowInput.setAttribute('aria-invalid', 'true');
      } else {
        rowInput.removeAttribute('aria-invalid');
      }
      rowInput.addEventListener('input', () => {
        _finishNameDirty = true;
        if (!pending) _finishSaveStatus = 'idle';
        // Clear the inline error styling as soon as the player edits
        // the name — they'll trigger a retry on the next blur or on
        // their next button click.
        rowInput.classList.remove('finishDialogRowNameInput--error');
        rowInput.removeAttribute('aria-invalid');
        _finishDialogData = { ...(_finishDialogData || {}), name: rowInput.value };
      });
      rowInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          rowInput.blur();
        }
        e.stopPropagation();
      });
      rowInput.addEventListener('blur', () => {
        // During the initial pending save, blur shouldn't trigger a
        // rename request — the in-flight save will pick up the typed
        // value and a follow-up rename is scheduled if it differs.
        if (pending) return;
        void _submitPendingFinishRun();
      });
      if (wasNameInputFocused) {
        rowInput.focus();
        if (prevSelStart !== null && typeof rowInput.setSelectionRange === 'function') {
          try { rowInput.setSelectionRange(prevSelStart, prevSelEnd); } catch (e) { /* ignore */ }
        }
      }
    }

    setTimeout(() => {
      const ownLi = list.querySelector('li.own-current') || list.querySelector('li.own-history');
      if (ownLi) ownLi.scrollIntoView({ block: 'center' });
    }, 0);
  }

  // Update timer state indicator
  _setTimerHudState(!pending && rank > 0 ? `Finished #${rank}` : 'Finished', 'finished');
}

// ── Initialize: create DOM, bind events ─────────────────────────────

export function init() {
  _initPlayerId();
  _playerName = _readPlayerName() || 'Player';
  _loadLeaderboard();
  _createNameDialogDOM();
  _createFinishDialogDOM();
  _wireLeaderboardTabs();
  renderLeaderboardPanel();
  // Fetch shared leaderboard from API for both modes (non-blocking).
  for (const mode of VALID_LEADERBOARD_MODES) void refreshSharedLeaderboard(mode);
}

function _wireLeaderboardTabs() {
  const tabsHost = document.getElementById('fpLeaderboardTabs');
  if (!tabsHost) return;
  tabsHost.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest && ev.target.closest('[data-lb-mode]');
    if (!btn) return;
    setViewMode(btn.getAttribute('data-lb-mode'));
  });
}

// ── Name Dialog DOM ─────────────────────────────────────────────────

function _createNameDialogDOM() {
  const overlay = document.createElement('div');
  overlay.id = 'nameDialogOverlay';
  overlay.innerHTML = `
    <div class="name-dialog-card" role="dialog" aria-modal="true" aria-label="Enter your name">
      <form id="nameDialogForm" autocomplete="off">
        <div class="name-dialog-body">What should we call this cat on the leaderboard?</div>
        <div class="name-dialog-input-row">
          <input type="text" id="nameDialogInput" maxlength="24" placeholder="Enter your name..." autocomplete="off" spellcheck="false" />
          <span id="nameDialogCount" class="name-dialog-count">0/24</span>
        </div>
        <div id="nameDialogHint" class="name-dialog-hint"></div>
        <div class="name-dialog-actions">
          <button type="button" class="finishDlgBtn glass-btn glass-btn--secondary" id="nameDialogCancel">Cancel</button>
          <button type="submit" class="finishDlgBtn glass-btn glass-btn--primary">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('nameDialogCancel').addEventListener('click', () => _closeNameDialog());
  document.getElementById('nameDialogForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('nameDialogInput');
    const hint = document.getElementById('nameDialogHint');
    if (!_nameDialogManualTyped) {
      if (input) { input.value = ''; input.focus(); }
      if (hint) hint.textContent = 'Manual typing required.';
      return;
    }
    const name = _sanitizePlayerName(input ? input.value : '');
    if (name) setPlayerName(name, true);
    renderLeaderboardPanel();
    _closeNameDialog();
  });
  const input = document.getElementById('nameDialogInput');
  input.addEventListener('keydown', e => {
    const now = performance.now();
    const inGrace = _nameDialogOpenedAt && (now - _nameDialogOpenedAt) < 300;
    const isControl = (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab');
    if (inGrace && !isControl) { e.preventDefault(); e.stopPropagation(); return; }
    if ((e.key && e.key.length === 1) || e.key === 'Backspace' || e.key === 'Delete') {
      _nameDialogManualTyped = true;
    }
    if (e.key === 'Escape') { e.preventDefault(); _closeNameDialog(); }
    e.stopPropagation();
  });
  input.addEventListener('input', e => {
    if (!_nameDialogManualTyped) e.target.value = '';
    _updateNameDialogCount();
  });
  overlay.addEventListener('keydown', e => e.stopPropagation());
  overlay.addEventListener('click', e => { if (e.target === overlay) _closeNameDialog(); });
}

// ── Finish Dialog DOM ───────────────────────────────────────────────

function _createFinishDialogDOM() {
  const overlay = document.createElement('div');
  overlay.id = 'finishDialogOverlay';
  overlay.innerHTML = `
    <div id="finishDialogCard" role="dialog" aria-modal="true" aria-label="Run complete">
      <div id="finishDialogHeader">
        <div id="finishDialogSummaryGrid">
          <div class="finishDialogSummaryItem finishDialogSummaryItemTime">
            <span class="k">Time</span>
            <span class="v" id="finishDialogSummaryTime">00:00.000</span>
          </div>
          <div class="finishDialogSummaryItem">
            <span class="k">Placement</span>
            <span class="v" id="finishDialogSummaryRank">Pending save</span>
          </div>
          <div class="finishDialogSummaryItem">
            <span class="k">Coins</span>
            <span class="v" id="finishDialogCoinBadge">0 / 0</span>
          </div>
          <div class="finishDialogSummaryItem">
            <span class="k">Secret Coins</span>
            <span class="v" id="finishDialogSummarySecret">0 found</span>
          </div>
          <div class="finishDialogSummaryItem finishDialogSummaryItemCat">
            <span class="k">Cat</span>
            <span class="v" id="finishDialogCatPreview"><canvas id="finishDialogCatCanvas" aria-hidden="true"></canvas></span>
            <span id="finishDialogCatText" class="finishDialogCatText">Cat</span>
          </div>
        </div>
        <div id="finishDialogSaveHint"></div>
      </div>
      <div id="finishDialogBoard">
        <h4>LEADERBOARD · TOP 25</h4>
        <ol id="finishDialogList"></ol>
      </div>
      <div class="finishDialogActions">
        <button type="button" class="finishDlgBtn glass-btn glass-btn--tile glass-btn--danger" id="finishDialogExit"><i class="ph ph-sign-out"></i> Exit</button>
        <button type="button" class="finishDlgBtn finishDialogActions__spacer glass-btn glass-btn--tile" id="finishDialogAgain"><i class="ph-fill ph-play"></i> Play again</button>
        <button type="button" class="finishDlgBtn finishDlgBtn--cta glass-btn glass-btn--tile" id="finishDialogCopy"><i class="ph-fill ph-copy"></i> Copy &amp; share</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('finishDialogExit').addEventListener('click', async () => {
    await _submitPendingFinishRun();
    if (_finishPendingRun || (_finishNameDirty && _finishSaveStatus === 'error')) return;
    closeFinishDialog();
    if (_onExitGame) _onExitGame();
  });
  document.getElementById('finishDialogAgain').addEventListener('click', async () => {
    await _submitPendingFinishRun();
    if (_finishPendingRun || (_finishNameDirty && _finishSaveStatus === 'error')) return;
    closeFinishDialog();
    if (_onPlayAgain) _onPlayAgain();
  });
  document.getElementById('finishDialogCopy').addEventListener('click', async () => {
    if (!_finishDialogData) return;
    const btn = document.getElementById('finishDialogCopy');
    const defaultHtml = '<i class="ph-fill ph-copy"></i> Copy &amp; share';
    try {
      await _copyTextToClipboard(_buildShareText(_finishDialogData));
      if (btn) btn.innerHTML = '<i class="ph ph-check"></i> Copied!';
      setTimeout(() => { if (btn) btn.innerHTML = defaultHtml; }, 1300);
    } catch (err) {
      if (btn) btn.innerHTML = '<i class="ph ph-x"></i> Copy failed';
      setTimeout(() => { if (btn) btn.innerHTML = defaultHtml; }, 1500);
    }
  });
  // Intentionally no backdrop-click-to-close: dragging to select text in the
  // name input can end on the overlay and would otherwise dismiss the dialog.
  // Use Escape or the Exit / Play again buttons to close.
  overlay.addEventListener('keydown', e => e.stopPropagation());
  document.addEventListener('keydown', e => {
    if (!_finishDialogOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Block escape while the run save is pending so the dialog can't
      // be dismissed mid-save (matches the disabled action buttons).
      if (_finishPendingRun) return;
      void (async () => {
        await _submitPendingFinishRun();
        if (_finishPendingRun || (_finishNameDirty && _finishSaveStatus === 'error')) return;
        closeFinishDialog();
      })();
    }
  });
}
