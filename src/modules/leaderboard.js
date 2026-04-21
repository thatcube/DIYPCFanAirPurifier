// ─── Run timer + leaderboard ────────────────────────────────────────
// Speedrun timer, shared API leaderboard with local fallback,
// name dialog, finish dialog, copy-result, per-player cap.
// API: same-origin /api/* proxied to Cloudflare Worker in production.

import {
  catModelKey, catColorKey, catHairKey,
  sanitizeColorKey, sanitizeModelKey, sanitizeHairKey,
  CAT_COLOR_EMOJI, CAT_MODEL_EMOJI, CAT_MODEL_LABELS_SHORT
} from './cat-appearance.js';
import { trapFocus, saveFocus } from './a11y.js';
import { CAT_COLOR_PRESETS } from './constants.js';

// ── Config ──────────────────────────────────────────────────────────

const LB_MAX = 25;
const LB_PER_PLAYER = 25;
const LB_STORE_KEY = 'diy_air_purifier_leaderboard_v1';
const LB_PLAYER_KEY = 'diy_air_purifier_player_name_v1';
const LB_PLAYER_ID_KEY = 'diy_air_purifier_player_id_v1';
const LB_API_BASE = ''; // same-origin — Netlify proxies /api/* to Worker
const LB_SHARED_ENABLED = true;

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

export function resetTimer() {
  _startTs = 0;
  _elapsed = 0;
  _running = false;
  _finished = false;
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

async function _reconcileCoinClaims(runId) {
  if (!runId || !_claimedCoinIds.size) return;
  const jobs = [];
  for (const coinId of _claimedCoinIds) {
    jobs.push(
      _lbApiRequest('/run/coin', { runId, coinId })
        .then(() => { _failedCoinIds.delete(coinId); })
        .catch(() => { _failedCoinIds.add(coinId); })
    );
  }
  await Promise.allSettled(jobs);
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
      catModel: sanitizeModelKey(catModelKey)
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
          catModel: sanitizeModelKey(catModelKey)
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
  list.innerHTML = top.map((r, i) => {
    const own = r.playerId ? (r.playerId === _playerId) : (r.name === _playerName);
    return `<li class="${own ? 'own' : ''}">
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
let _onPlayAgain = null;
let _onExitGame = null;
let _finishFocusTrap = null;
let _finishSavedFocus = null;

export function isFinishDialogOpen() { return _finishDialogOpen; }

export function setCallbacks(opts) {
  _onPlayAgain = opts.onPlayAgain || null;
  _onExitGame = opts.onExitGame || null;
}

export function openFinishDialog(data) {
  _finishDialogData = data || null;
  _finishDialogOpen = true;

  if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();

  const overlay = document.getElementById('finishDialogOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    _finishSavedFocus = saveFocus();
    _finishFocusTrap = trapFocus(overlay);
    // Focus first action after render
    requestAnimationFrame(() => {
      const btn = document.getElementById('finishDialogAgain');
      if (btn) btn.focus();
    });
  }
  _renderFinishDialog();
}

export function closeFinishDialog() {
  if (!_finishDialogOpen) return;
  _finishDialogOpen = false;
  _finishDialogData = null;
  const overlay = document.getElementById('finishDialogOverlay');
  if (overlay) overlay.style.display = 'none';
  if (_finishFocusTrap) { _finishFocusTrap.release(); _finishFocusTrap = null; }
  if (_finishSavedFocus) { _finishSavedFocus.restore(); _finishSavedFocus = null; }
  const copyBtn = document.getElementById('finishDialogCopy');
  if (copyBtn) copyBtn.textContent = 'Copy result';
}

function _renderFinishDialog() {
  const data = _finishDialogData || {};
  const timeEl = document.getElementById('finishDialogTime');
  const nameEl = document.getElementById('finishDialogName');
  const rankHero = document.getElementById('finishDialogRankHero');
  const rankNum = document.getElementById('finishDialogRankNum');
  const rankText = document.getElementById('finishDialogRankText');
  const coinBadge = document.getElementById('finishDialogCoinBadge');
  const list = document.getElementById('finishDialogList');

  if (timeEl) timeEl.textContent = formatRunTime(data.timeMs || 0);
  if (nameEl) nameEl.textContent = data.name || _playerName || 'Player';

  const rank = Math.floor(Number(data.rank) || 0);
  if (rankHero && rankNum) {
    if (rank > 0) {
      rankHero.classList.add('on');
      rankHero.classList.toggle('medal', rank <= 3);
      rankNum.textContent = `#${rank}`;
      if (rankText) {
        if (rank === 1) rankText.textContent = 'First place — legendary.';
        else if (rank === 2) rankText.textContent = '2nd place — podium!';
        else if (rank === 3) rankText.textContent = '3rd place — podium!';
        else rankText.textContent = 'on the leaderboard';
      }
    } else {
      rankHero.classList.remove('on', 'medal');
    }
  }
  if (coinBadge) {
    const c = Math.floor(Number(data.coins) || 0);
    const t = Math.floor(Number(data.coinTotal) || 0);
    coinBadge.textContent = `${c} / ${t} coins`;
  }
  if (list) {
    if (!_leaderboard.length) {
      list.innerHTML = '<li style="opacity:0.62;padding:8px 10px">No runs yet.</li>';
    } else {
      const ownId = String(data.entryId || '');
      list.innerHTML = _leaderboard.map((r, i) => {
        const own = (ownId && r.id === ownId) || (!ownId && r.playerId === _playerId);
        return `<li class="${own ? 'own' : ''}">
          <span class="rk">#${i + 1}</span>
          <span class="nm">${_escapeHtml(r.name)}</span>
          ${_catBadgeHtml(r)}
          <span class="tm">${formatRunTime(r.timeMs)}</span>
        </li>`;
      }).join('');
      setTimeout(() => {
        const ownLi = list.querySelector('li.own');
        if (ownLi) ownLi.scrollIntoView({ block: 'center' });
      }, 0);
    }
  }

  // Update timer state indicator
  const st = document.getElementById('runTimerState');
  if (st) st.textContent = rank > 0 ? `FINISHED #${rank}` : 'FINISHED';
}

// ── Initialize: create DOM, bind events ─────────────────────────────

export function init() {
  _initPlayerId();
  _playerName = _readPlayerName() || 'Player';
  _loadLeaderboard();
  _createNameDialogDOM();
  _createFinishDialogDOM();
  renderLeaderboardPanel();
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
      <div id="finishDialogHeader">
        <div id="finishDialogEyebrow">
          <span>RUN COMPLETE</span>
          <span class="tag" id="finishDialogCoinBadge">0 / 0 coins</span>
        </div>
        <div id="finishDialogTime">00:00.000</div>
        <div id="finishDialogRankHero">
          <span class="rankNum" id="finishDialogRankNum">#—</span>
          <span class="rankTag">
            <b id="finishDialogName">Player</b>
            <span id="finishDialogRankText">on the board</span>
          </span>
        </div>
      </div>
      <div id="finishDialogBoard">
        <h4>LEADERBOARD · TOP 25</h4>
        <ol id="finishDialogList"></ol>
      </div>
      <div class="finishDialogActions">
        <button type="button" class="finishDlgBtn glass-btn glass-btn--danger" id="finishDialogExit"><i class="ph ph-sign-out"></i> Exit</button>
        <button type="button" class="finishDlgBtn glass-btn glass-btn--secondary" id="finishDialogAgain"><i class="ph-fill ph-play"></i> Play Again</button>
        <button type="button" class="finishDlgBtn glass-btn glass-btn--primary" id="finishDialogCopy"><i class="ph ph-copy"></i> Copy result</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('finishDialogExit').addEventListener('click', () => {
    closeFinishDialog();
    if (_onExitGame) _onExitGame();
  });
  document.getElementById('finishDialogAgain').addEventListener('click', () => {
    closeFinishDialog();
    if (_onPlayAgain) _onPlayAgain();
  });
  document.getElementById('finishDialogCopy').addEventListener('click', async () => {
    if (!_finishDialogData) return;
    const btn = document.getElementById('finishDialogCopy');
    try {
      await _copyTextToClipboard(_buildShareText(_finishDialogData));
      if (btn) btn.textContent = 'Copied!';
      setTimeout(() => { if (btn) btn.textContent = 'Copy result'; }, 1300);
    } catch (err) {
      if (btn) btn.textContent = 'Copy failed';
      setTimeout(() => { if (btn) btn.textContent = 'Copy result'; }, 1500);
    }
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeFinishDialog();
  });
  overlay.addEventListener('keydown', e => e.stopPropagation());
  document.addEventListener('keydown', e => {
    if (!_finishDialogOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closeFinishDialog(); }
  });
}
