// ─── Run timer + leaderboard ────────────────────────────────────────
// Speedrun timer, shared API leaderboard with local fallback,
// name dialog, finish dialog, copy-result, per-player cap.
// API: same-origin /api/* proxied to Cloudflare Worker in production.

import {
  catModelKey, catColorKey, catHairKey,
  sanitizeColorKey, sanitizeModelKey, sanitizeHairKey,
  CAT_COLOR_EMOJI, CAT_MODEL_EMOJI, CAT_MODEL_LABELS_SHORT
} from './cat-appearance.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { trapFocus, saveFocus } from './a11y.js';
import { CAT_COLOR_PRESETS, CAT_MODEL_PRESETS } from './constants.js';

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
  return _isQuickCoinMode() || _isLocalTestMode();
}

export function isTestRun() { return _isTestSubmission(); }

function _testRunReason() {
  if (_isQuickCoinMode()) return 'Quick-coin mode';
  if (_isLocalTestMode()) return 'Local dev';
  return '';
}

function _syncTestRunBadge() {
  try {
    const isTest = _isTestSubmission();
    if (typeof document === 'undefined') return;
    document.body && document.body.classList.toggle('is-test-run', !!isTest);
    const combo = document.querySelector('.run-pill--combo');
    if (combo) {
      let badge = document.getElementById('runTestBadge');
      if (isTest) {
        if (!badge) {
          badge = document.createElement('span');
          badge.id = 'runTestBadge';
          badge.className = 'run-pill__test-badge';
          badge.setAttribute('aria-label', 'Test run — not submitted to public leaderboard');
          badge.innerHTML = '<i class="ph ph-flask"></i><span>TEST</span>';
          combo.appendChild(badge);
        }
        badge.title = `Test run (${_testRunReason()}) — not submitted to the public leaderboard`;
      } else if (badge) {
        badge.remove();
      }
    }
  } catch (e) { /* ignore */ }
}

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
  _syncTestRunBadge();
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

export function formatRunTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const z = total % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(z).padStart(3, '0')}`;
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

let _leaderboard = [];

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

function _catColorHex(key) {
  const p = CAT_COLOR_PRESETS[String(key || '').toLowerCase()];
  if (!p) return '#9aa4b4';
  return '#' + (p.coat >>> 0).toString(16).padStart(6, '0');
}

function _catBadgeHtml(entry) {
  const model = String((entry && entry.catModel) || 'classic').toLowerCase();
  const emoji = CAT_MODEL_EMOJI[model] || CAT_MODEL_EMOJI.classic;
  const label = CAT_MODEL_LABELS_SHORT[model] || 'Cat';
  const colorable = (model !== 'bababooey');
  const colorKey = (entry && entry.catColor) || 'charcoal';
  const dot = colorable ? `<span class="catDot" style="background:${_catColorHex(colorKey)}"></span>` : '';
  return `<span class="catBadge" title="${_escapeHtml(colorable ? label + ' · ' + colorKey : label)}"><span class="catEmoji">${emoji}</span>${dot}<span class="catLabel">${label}</span></span>`;
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
      playerId: _sanitizePlayerId(r.playerId || '')
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

function _loadLeaderboard() {
  try {
    const raw = localStorage.getItem(LB_STORE_KEY);
    _leaderboard = _normalizeLeaderboard(raw ? JSON.parse(raw) : []);
  } catch (e) { _leaderboard = []; }
}

function _saveLeaderboard() {
  try { localStorage.setItem(LB_STORE_KEY, JSON.stringify(_leaderboard)); } catch (e) { /* ignore */ }
}

export function getEntries() { return _leaderboard; }

// ── Shared API ──────────────────────────────────────────────────────

async function _lbApiRequest(path, body) {
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

export async function refreshSharedLeaderboard() {
  if (!LB_SHARED_ENABLED) return;
  try {
    const data = await _lbApiRequest('/leaderboard');
    _sharedOnline = true;
    _statusNote = '';
    _leaderboard = _normalizeLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
  } catch (e) {
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    _loadLeaderboard();
  }
  renderLeaderboardPanel();
}

export async function startSharedRun() {
  _sharedRunId = '';
  _claimedCoinIds.clear();
  _failedCoinIds.clear();
  _pendingCoinReports.clear();
  if (!LB_SHARED_ENABLED) return;
  try {
    const data = await _lbApiRequest('/run/start', {});
    _sharedRunId = String(data.runId || '');
    _sharedOnline = !!_sharedRunId;
    if (_sharedOnline) _statusNote = '';
  } catch (e) {
    _sharedOnline = false;
    _statusNote = 'Local fallback';
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

function _recordRunLocal(timeMs, coinTotal, secretCoins) {
  const name = _playerName || 'Player';
  const now = Date.now();
  const entry = {
    id: _makeEntryId(name, timeMs, now),
    name, timeMs: Math.floor(timeMs), at: now,
    catColor: sanitizeColorKey(catColorKey),
    catHair: sanitizeHairKey(catHairKey),
    catModel: sanitizeModelKey(catModelKey),
    playerId: _playerId
  };
  _leaderboard = _normalizeLeaderboard(_leaderboard.concat(entry));
  _saveLeaderboard();

  let rank = 0;
  for (let i = 0; i < _leaderboard.length; i++) {
    if (_leaderboard[i].id === entry.id) { rank = i + 1; break; }
  }

  return {
    entryId: entry.id, rank, name: entry.name,
    timeMs: entry.timeMs, coins: coinTotal, coinTotal,
    secretCoins: secretCoins || 0,
    catColor: entry.catColor, catHair: entry.catHair, catModel: entry.catModel
  };
}

async function _recordRunShared(timeMs, coinTotal, secretCoins) {
  if (!_sharedRunId || !_sharedOnline) {
    return _recordRunLocal(timeMs, coinTotal, secretCoins);
  }
  const runId = _sharedRunId;
  await _flushCoinReports();
  if (_failedCoinIds.size) await _reconcileCoinClaims(runId);
  try {
    const data = await _lbApiRequest('/run/finish', {
      runId,
      name: _playerName || 'Player',
      playerId: _playerId,
      catColor: sanitizeColorKey(catColorKey),
      catHair: sanitizeHairKey(catHairKey),
      catModel: sanitizeModelKey(catModelKey),
      isTest: _isTestSubmission(),
      timeMs: Math.max(1, Math.floor(Number(timeMs) || 0))
    });
    _sharedRunId = '';
    _claimedCoinIds.clear();
    _failedCoinIds.clear();
    _pendingCoinReports.clear();
    _sharedOnline = true;
    _statusNote = '';
    _leaderboard = _normalizeLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
    const serverEntry = (data && data.entry) ? data.entry : {};
    return {
      entryId: String(serverEntry.id || ''),
      rank: Math.floor(Number(data && data.rank) || 0),
      name: _sanitizePlayerName(serverEntry.name || _playerName || 'Player'),
      timeMs: Math.floor(Number(serverEntry.timeMs) || Math.floor(timeMs)),
      coins: coinTotal, coinTotal,
      secretCoins: secretCoins || 0,
      catColor: sanitizeColorKey(serverEntry.catColor || catColorKey),
      catHair: sanitizeHairKey(serverEntry.catHair || catHairKey),
      catModel: sanitizeModelKey(serverEntry.catModel || catModelKey)
    };
  } catch (e) {
    // Retry if incomplete_run (coin claims may have been lost)
    if (e && e.apiCode === 'incomplete_run') {
      try {
        await _reconcileCoinClaims(runId);
        const retryData = await _lbApiRequest('/run/finish', {
          runId,
          name: _playerName || 'Player',
          playerId: _playerId,
          catColor: sanitizeColorKey(catColorKey),
          catHair: sanitizeHairKey(catHairKey),
          catModel: sanitizeModelKey(catModelKey),
          isTest: _isTestSubmission(),
          timeMs: Math.max(1, Math.floor(Number(timeMs) || 0))
        });
        _sharedRunId = '';
        _claimedCoinIds.clear();
        _failedCoinIds.clear();
        _pendingCoinReports.clear();
        _sharedOnline = true;
        _statusNote = '';
        _leaderboard = _normalizeLeaderboard(Array.isArray(retryData.leaderboard) ? retryData.leaderboard : []);
        const retryEntry = (retryData && retryData.entry) ? retryData.entry : {};
        return {
          entryId: String(retryEntry.id || ''),
          rank: Math.floor(Number(retryData && retryData.rank) || 0),
          name: _sanitizePlayerName(retryEntry.name || _playerName || 'Player'),
          timeMs: Math.floor(Number(retryEntry.timeMs) || Math.floor(timeMs)),
          coins: coinTotal, coinTotal,
          secretCoins: secretCoins || 0,
          catColor: sanitizeColorKey(retryEntry.catColor || catColorKey),
          catHair: sanitizeHairKey(retryEntry.catHair || catHairKey),
          catModel: sanitizeModelKey(retryEntry.catModel || catModelKey)
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
      void refreshSharedLeaderboard();
      return { entryId: '', rank: 0, name: _playerName || 'Player', timeMs: Math.floor(timeMs), coins: coinTotal, coinTotal, secretCoins: secretCoins || 0, catColor: sanitizeColorKey(catColorKey), catHair: sanitizeHairKey(catHairKey), catModel: sanitizeModelKey(catModelKey) };
    }
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    return _recordRunLocal(timeMs, coinTotal, secretCoins);
  }
}

export async function recordRun(timeMs, coinTotal, secretCoins) {
  if (LB_SHARED_ENABLED) {
    return _recordRunShared(timeMs, coinTotal, secretCoins);
  }
  return _recordRunLocal(timeMs, coinTotal, secretCoins);
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

function _renameLatestEntryLocal(entryId, nextName, baseData) {
  const cleanId = String(entryId || '').trim();
  const cleanName = _sanitizePlayerName(nextName || '');
  if (!cleanId || !cleanName) return null;

  const idx = _leaderboard.findIndex((row) => String(row && row.id || '') === cleanId);
  if (idx < 0) return null;

  const target = _leaderboard[idx];
  const targetPid = _sanitizePlayerId(target.playerId || '');
  if (!targetPid || targetPid !== _playerId) return null;

  const latest = _latestEntryForPlayer(_leaderboard, _playerId);
  if (!latest || String(latest.id || '') !== cleanId) return null;

  _leaderboard[idx] = { ...target, name: cleanName };
  _leaderboard = _normalizeLeaderboard(_leaderboard);
  _saveLeaderboard();

  const rank = _leaderboard.findIndex((row) => String(row.id || '') === cleanId) + 1;
  const row = _leaderboard.find((r) => String(r.id || '') === cleanId) || _leaderboard[idx];
  return {
    ...(baseData || {}),
    entryId: cleanId,
    rank: rank > 0 ? rank : 0,
    name: cleanName,
    timeMs: Math.floor(Number((row && row.timeMs) || (baseData && baseData.timeMs) || 0)),
    catColor: sanitizeColorKey((row && row.catColor) || (baseData && baseData.catColor) || catColorKey),
    catHair: sanitizeHairKey((row && row.catHair) || (baseData && baseData.catHair) || catHairKey),
    catModel: sanitizeModelKey((row && row.catModel) || (baseData && baseData.catModel) || catModelKey),
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
    _leaderboard = _normalizeLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : _leaderboard);
    const serverEntry = (data && data.entry) ? data.entry : {};
    return {
      ...(baseData || {}),
      entryId: cleanId,
      rank: Math.floor(Number(data && data.rank) || 0),
      name: _sanitizePlayerName(serverEntry.name || cleanName || (baseData && baseData.name) || _playerName || 'Player'),
      timeMs: Math.floor(Number(serverEntry.timeMs) || Number((baseData && baseData.timeMs) || 0)),
      catColor: sanitizeColorKey(serverEntry.catColor || (baseData && baseData.catColor) || catColorKey),
      catHair: sanitizeHairKey(serverEntry.catHair || (baseData && baseData.catHair) || catHairKey),
      catModel: sanitizeModelKey(serverEntry.catModel || (baseData && baseData.catModel) || catModelKey),
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
      void refreshSharedLeaderboard();
      return null;
    }
    _sharedOnline = false;
    _statusNote = 'Local fallback';
    return _renameLatestEntryLocal(cleanId, cleanName, baseData);
  }
}

async function _renameLatestEntry(entryId, nextName, baseData) {
  if (LB_SHARED_ENABLED) return _renameLatestEntryShared(entryId, nextName, baseData);
  return _renameLatestEntryLocal(entryId, nextName, baseData);
}

// ── Render leaderboard panel (in-game, shown on pause) ──────────────

export function renderLeaderboardPanel() {
  const list = document.getElementById('fpLeaderboardList');
  const emptyEl = document.getElementById('fpLeaderboardEmpty');
  if (!list) return;
  if (!_leaderboard.length) {
    list.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  // Show top 5 in the pause card
  const top = _leaderboard.slice(0, 5);
  const latestEntryId = String(((_lastRunData && _lastRunData.entryId) || (_finishDialogData && _finishDialogData.entryId) || '')).trim();
  list.innerHTML = top.map((r, i) => {
    const isHistory = r.playerId ? (r.playerId === _playerId) : (r.name === _playerName);
    const isCurrent = !!latestEntryId && String(r.id || '') === latestEntryId;
    const rowClass = `${isHistory ? 'own-history ' : ''}${isCurrent ? 'own-current' : ''}`.trim();
    return `<li class="${rowClass}">
      <span class="rk">#${i + 1}</span>
      <span class="nm">${_escapeHtml(r.name)}</span>
      ${_catBadgeHtml(r)}
      <span class="tm">${formatRunTime(r.timeMs)}</span>
    </li>`;
  }).join('');
}

// ── Share / Copy result ─────────────────────────────────────────────

function _buildLeaderboardUrl(entryId, timeMs) {
  const base = `${location.origin}/leaderboard`;
  const params = new URLSearchParams();
  const cleanId = String(entryId || '').trim();
  const ms = Math.floor(Number(timeMs));
  if (cleanId) params.set('entry', cleanId);
  if (Number.isFinite(ms) && ms > 0) params.set('timeMs', String(ms));
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

function _buildShareText(data) {
  const row = data || {};
  const rankTxt = row.rank && row.rank > 0 ? `#${row.rank}` : 'Unranked';
  const who = _sanitizePlayerName(row.name) || (_playerName || 'Player');
  const catColor = sanitizeColorKey(row.catColor || catColorKey);
  const catModel = sanitizeModelKey(row.catModel || catModelKey);
  const modelEmoji = CAT_MODEL_EMOJI[catModel] || '🐱';
  const modelLabel = CAT_MODEL_LABELS_SHORT[catModel] || 'Cat';
  const colorChip = (catModel !== 'bababooey')
    ? ` ${CAT_COLOR_EMOJI[catColor] || ''} ${catColor.charAt(0).toUpperCase() + catColor.slice(1)}`
    : '';
  const url = _buildLeaderboardUrl(row.entryId || '', row.timeMs || 0);
  const secretCount = Math.floor(Number(row.secretCoins) || 0);
  const secretChip = secretCount > 0 ? ` · 🔵 ${secretCount} secret${secretCount > 1 ? 's' : ''}` : '';
  return [
    `${who} · DIY Air Purifier · ${formatRunTime(row.timeMs || 0)} · ${rankTxt} · ${modelEmoji} ${modelLabel}${colorChip}${secretChip}`,
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
  if (!model || modelKey !== 'classic') return;
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
  const sources = (preset.sources && preset.sources.length ? preset.sources : ['assets/cat.glb']).slice();
  const token = ++_finishPreviewLoadToken;
  _finishPreviewLoading = true;

  const tryLoad = (idx) => {
    if (idx >= sources.length || !_finishPreviewLoader) {
      if (token === _finishPreviewLoadToken) _finishPreviewLoading = false;
      return;
    }
    _finishPreviewLoader.load(sources[idx], (gltf) => {
      if (token !== _finishPreviewLoadToken) return;
      const model = gltf.scene;
      if (safeModel === 'bababooey') _stripFinishPreviewBackdrop(model);
      _placeFinishPreviewModel(model, safeModel);
      _tintFinishPreviewModel(model, safeModel, safeColor);
      _finishPreviewScene.add(model);
      _finishPreviewModel = model;
      _finishPreviewLoading = false;
      _startFinishPreviewLoop();
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

  _openFinishDialogOverlay(false);
  // Save immediately so editable name appears in the final leaderboard row.
  void _submitPendingFinishRun().then(() => {
    _focusFinishRowNameInput();
  });
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
  if (copyBtn) copyBtn.innerHTML = '<i class="ph-fill ph-share-network"></i> Copy &amp; share result';
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
  if (input) input.disabled = true;
  _renderFinishDialog();

  const job = (async () => {
    try {
      if (hasPendingRun) {
        const pending = _finishPendingRun;
        const runData = await recordRun(pending.timeMs, pending.coinTotal, pending.secretCoins);
        _finishPendingRun = null;
        _finishEditableEntryId = String((runData && runData.entryId) || '').trim();
        _finishSubmitting = false;
        _finishSaveStatus = 'saved';
        _finishDialogData = runData || null;
        renderLeaderboardPanel();
        showShareButton(runData);
        _renderFinishDialog();
        _focusFinishRowNameInput();
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
  const testBanner = document.getElementById('finishDialogTestBanner');
  const testReasonEl = document.getElementById('finishDialogTestReason');
  const isTest = _isTestSubmission();
  const card = document.getElementById('finishDialogCard');
  if (card) card.classList.toggle('is-test-run', isTest);
  if (testBanner) {
    testBanner.hidden = !isTest;
    if (testReasonEl) testReasonEl.textContent = isTest ? `(${_testRunReason()})` : '';
  }

  const runTimeMs = Math.floor(Number(data.timeMs) || Number(_finishPendingRun?.timeMs) || 0);
  const rank = Math.floor(Number(data.rank) || 0);
  const secretCount = Math.max(0, Math.floor(Number(data.secretCoins) || Number(_finishPendingRun?.secretCoins) || 0));

  if (summaryTime) summaryTime.textContent = formatRunTime(runTimeMs);
  if (summaryRank) {
    if (pending) {
      summaryRank.innerHTML = '<span class="finishRankSkel" aria-hidden="true"></span>';
      summaryRank.setAttribute('aria-label', 'Saving rank');
    } else {
      summaryRank.textContent = rank > 0 ? `#${rank}` : 'Unranked';
      summaryRank.removeAttribute('aria-label');
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

  if (saveHint) {
    if (pending) {
      if (_finishSaveStatus === 'error') saveHint.textContent = 'Save failed. Please wait and it will retry.';
      else saveHint.textContent = isTest ? 'Recording test run...' : 'Saving run...';
    } else if (canRenameSavedEntry) {
      if (_finishSaveStatus === 'saving') saveHint.textContent = 'Saving...';
      else if (_finishSaveStatus === 'error') saveHint.textContent = 'Save failed. Leave the field again to retry.';
      else if (isTest) saveHint.textContent = 'Test run recorded (hidden from the public leaderboard). Edit and leave the row to rename.';
      else saveHint.textContent = 'Saved. Edit and leave your leaderboard row to update this run.';
    } else if (Math.floor(Number(data.rank) || 0) > 0 || _finishSaveStatus === 'saved') {
      saveHint.textContent = isTest ? 'Test run recorded (hidden from the public leaderboard).' : 'Saved.';
    } else {
      saveHint.textContent = '';
    }
  }
  if (copyBtn) copyBtn.style.display = pending ? 'none' : '';

  if (coinBadge) {
    const c = Math.floor(Number(data.coins) || Number(data.coinTotal) || Number(_finishPendingRun?.coinTotal) || 0);
    const t = Math.floor(Number(data.coinTotal) || Number(_finishPendingRun?.coinTotal) || 0);
    coinBadge.textContent = `${c} / ${t}`;
  }
  if (list) {
    const ownId = String(data.entryId || '');
    const editableEntryId = canRenameSavedEntry ? _finishEditableEntryId : '';
    const rows = [];

    if (_leaderboard.length || pending) {
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
        const pendingEntry = {
          catModel: data.catModel || catModelKey,
          catColor: data.catColor || catColorKey,
          catHair: data.catHair || catHairKey
        };
        pendingInsertAt = _leaderboard.length;
        for (let i = 0; i < _leaderboard.length; i++) {
          if (pendingTimeMs < _leaderboard[i].timeMs) { pendingInsertAt = i; break; }
        }
        pendingHtml = `<li class="own-current pending" data-entry-id="">
          <span class="rk rk-pending" aria-label="Saving rank">
            <span class="finishRankSkel finishRankSkel--row" aria-hidden="true"></span>
          </span>
          <span class="nm nm-edit">
            <input type="text" class="finishDialogRowNameInput" maxlength="24" value="${_escapeHtml(pendingName)}" autocomplete="off" spellcheck="false" disabled aria-label="Your name (saving)" />
          </span>
          ${_catBadgeHtml(pendingEntry)}
          <span class="tm">${formatRunTime(pendingTimeMs)}</span>
        </li>`;
      }

      for (let i = 0; i < _leaderboard.length; i++) {
        if (pending && i === pendingInsertAt) rows.push(pendingHtml);
        const r = _leaderboard[i];
        const isHistory = !!r.playerId && r.playerId === _playerId;
        const isCurrent = !!ownId && r.id === ownId;
        const rowClass = `${isHistory ? 'own-history ' : ''}${isCurrent ? 'own-current' : ''}`.trim();
        const editable = !pending && !!editableEntryId && r.id === editableEntryId;
        rows.push(`<li class="${rowClass}" data-entry-id="${_escapeHtml(r.id)}">
          <span class="rk">#${i + 1}</span>
          <span class="nm ${editable ? 'nm-edit' : ''}">${editable
            ? `<input type="text" class="finishDialogRowNameInput" maxlength="24" value="${_escapeHtml(r.name)}" autocomplete="off" spellcheck="false" />`
            : _escapeHtml(r.name)
          }</span>
          ${_catBadgeHtml(r)}
          <span class="tm">${formatRunTime(r.timeMs)}</span>
        </li>`);
      }
      if (pending && pendingInsertAt >= _leaderboard.length) rows.push(pendingHtml);
    } else {
      rows.push('<li style="opacity:0.62;padding:8px 10px">No runs yet.</li>');
    }

    list.innerHTML = rows.join('');

    const rowInput = _getFinishRowNameInput();
    if (rowInput) {
      rowInput.disabled = _finishSubmitting || !canRenameSavedEntry;
      rowInput.addEventListener('input', () => {
        _finishNameDirty = true;
        _finishSaveStatus = 'idle';
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
        void _submitPendingFinishRun();
      });
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
  renderLeaderboardPanel();
  _syncTestRunBadge();
  // Fetch shared leaderboard from API (non-blocking)
  void refreshSharedLeaderboard();
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
      <div id="finishDialogTestBanner" hidden><i class="ph ph-flask"></i> <strong>TEST RUN</strong> <span id="finishDialogTestReason"></span> — not submitted to the public leaderboard.</div>
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
        <button type="button" class="finishDlgBtn glass-btn glass-btn--danger" id="finishDialogExit"><i class="ph ph-sign-out"></i> Exit</button>
        <button type="button" class="finishDlgBtn glass-btn glass-btn--secondary" id="finishDialogAgain"><i class="ph-fill ph-play"></i> Play again</button>
        <button type="button" class="finishDlgBtn finishDlgBtn--cta glass-btn glass-btn--primary" id="finishDialogCopy"><i class="ph-fill ph-share-network"></i> Copy &amp; share result</button>
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
    const defaultHtml = '<i class="ph-fill ph-share-network"></i> Copy &amp; share result';
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
      void (async () => {
        await _submitPendingFinishRun();
        if (_finishPendingRun || (_finishNameDirty && _finishSaveStatus === 'error')) return;
        closeFinishDialog();
      })();
    }
  });
}
