// ─── Music module ───────────────────────────────────────────────────
// MacBook playlist system: chiptune synth + audio file playback.
// Proximity-based volume in game mode.

// ── Playlist ────────────────────────────────────────────────────────
// Songs can be:
//   { kind:'chiptune', name, bpm, loops, bass:[midi…], lead:[midi…], bassOct?, leadGain?, leadDur? }
//   { kind:'audio',    name, src, volume? }
//
// To add a song: drop audio into assets/songs/ and push an entry here.

export const PLAYLIST = [
  { kind: 'audio', name: 'Octodad Theme',        src: 'assets/songs/Octodad (Nobody Suspects a Thing).mp3',        volume: 0.22 },
  { kind: 'audio', name: 'Escape from the City', src: 'assets/songs/Escape From The City ... for City Escape.mp3', volume: 0.22 },
  { kind: 'audio', name: 'Warthog Run',          src: 'assets/songs/H3 Warthog Run OST - Copyright Free.mp3',      volume: 0.22 },
  { kind: 'audio', name: 'Gerudo Valley',        src: 'assets/songs/Gerudo Valley - The Legend of Zelda_ Ocarina Of Time Copyright free.mp3', volume: 0.22 },
  { kind: 'audio', name: 'Through the Fire and Flames', src: 'assets/songs/Through The Fire And Flames.mp3', volume: 0.24 },
];

// ── State ───────────────────────────────────────────────────────────

let _queue = [];
let _queueIdx = 0;
let _lastPlayed = null;
let _currentAudio = null;   // HTMLAudioElement (audio songs)
let _chiptuneTimer = null;
let _advanceTimer = null;
let _musicGain = null;       // WebAudio gain node (chiptune songs)
let _musicStart = 0;
let _musicStep = 0;
let _currentSong = null;
let _on = false;
let _proxSmooth = 1;        // smoothed proximity multiplier (1 = full vol)

// Shared AudioContext — caller must set via setAudioContext()
let _ac = null;

// Toast callback — set via setToastFn()
let _showToast = () => {};

// Song-change observer — fires with song name (string) when a new song
// starts and with null when playback stops. Set via setOnSongChange().
let _onSongChange = null;
let _lastNotifiedSong = null;

function _emitSongChange() {
  const name = _currentSong ? _currentSong.name : null;
  if (name === _lastNotifiedSong) return;
  _lastNotifiedSong = name;
  if (name) _showToast(`♪ ${name}`);
  if (_onSongChange) {
    try { _onSongChange(name); } catch (e) { /* ignore */ }
  }
}

// ── Public API ──────────────────────────────────────────────────────

export function setAudioContext(ac) { _ac = ac; }
export function getAudioContext() { return _ac; }
export function setToastFn(fn) { _showToast = fn; }
export function setOnSongChange(fn) { _onSongChange = (typeof fn === 'function') ? fn : null; }

export function isPlaying() { return _on; }
export function getCurrentSong() { return _currentSong; }
export function getCurrentAudio() { return _currentAudio; }
export function getMusicGain() { return _musicGain; }

export function start() {
  try {
    _ensureAC();
    if (_on) return;
    _on = true;
    _queue = _buildQueue();
    _queueIdx = 0;
    playNext();
  } catch (e) {
    console.warn('[music] start failed', e);
  }
}

export function stop() {
  _on = false;
  _stopCurrent();
  _queue = [];
  _queueIdx = 0;
  _proxSmooth = 1;
  _emitSongChange();
}

export function playNext() {
  _stopCurrent();
  if (!_on) return;
  if (!_queue.length || _queueIdx >= _queue.length) {
    _queue = _buildQueue();
    _queueIdx = 0;
    if (!_queue.length) return;
  }
  const song = _queue[_queueIdx++];
  if (!song) return;
  _currentSong = song;
  _lastPlayed = song.name;
  if (song.kind === 'audio') _playAudio(song);
  else _playChiptune(song);
  _emitSongChange();
}

export function skipNext() {
  if (!_on) return;
  _showToast('⏭ NEXT');
  playNext();
}

export function skipPrev() {
  if (!_on) return;
  _showToast('⏮ PREV');
  _stopCurrent();
  _queueIdx = Math.max(0, _queueIdx - 2);
  playNext();
}

/**
 * Force playback to a specific playlist song by name.
 * Useful for world interactions that should trigger a named track.
 */
export function playSongByName(name, opts = {}) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return false;

  const song = PLAYLIST.find((s) => String(s?.name || '').toLowerCase() === target);
  if (!song) return false;

  _ensureAC();

  const startIfStopped = opts.startIfStopped !== false;
  if (!_on && startIfStopped) _on = true;
  if (!_on) return false;

  const restart = opts.restart !== false;
  if (!restart && _currentSong && _currentSong.name === song.name) return true;

  _stopCurrent();
  _currentSong = song;
  _lastPlayed = song.name;
  if (song.kind === 'audio') _playAudio(song);
  else _playChiptune(song);
  _emitSongChange();
  return true;
}

/** Mute/unmute music (separate from SFX) */
export function setMuted(muted) {
  try {
    if (_musicGain && _ac) {
      _musicGain.gain.setTargetAtTime(muted ? 0 : 0.16, _ac.currentTime, 0.08);
    }
    if (_currentAudio) {
      _currentAudio.muted = muted;
    }
  } catch (e) { /* ignore */ }
}

/**
 * Set proximity-based volume.
 * @param {number} vol - 0..1 volume multiplier
 */
export function setProximityVolume(vol) {
  try {
    if (_musicGain && _ac) {
      _musicGain.gain.setTargetAtTime(0.16 * vol, _ac.currentTime, 0.06);
    }
    if (_currentAudio) {
      const base = (_currentSong && _currentSong.volume !== undefined) ? _currentSong.volume : 0.3;
      _currentAudio.volume = Math.max(0, Math.min(1, base * vol));
    }
  } catch (e) { /* ignore */ }
}

/** Reset volume to full (call when exiting game mode) */
export function resetVolume() {
  try {
    if (_musicGain && _ac) _musicGain.gain.setTargetAtTime(0.16, _ac.currentTime, 0.06);
    if (_currentAudio) _currentAudio.volume = (_currentSong && _currentSong.volume !== undefined) ? _currentSong.volume : 0.3;
  } catch (e) { /* ignore */ }
}

/**
 * Proximity-based volume: full inside ~24" of `anchor`, steep inverse-square
 * dropoff beyond, with a floor so the song stays faintly audible at long
 * range. Mirrors the MacBook proximity model in room.js so both music
 * sources share the same listener feel.
 */
export function updateProximity(playerVec3, anchorVec3) {
  if (!_currentAudio || !_currentSong || !playerVec3 || !anchorVec3) return;
  const dx = anchorVec3.x - playerVec3.x;
  const dy = anchorVec3.y - playerVec3.y;
  const dz = anchorVec3.z - playerVec3.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const near = 24;       // 2 ft — full volume inside this radius
  const floorVol = 0.18; // minimum proximity multiplier at extreme distance
  let prox = 1;
  if (dist > near) {
    const k = near / dist;
    prox = floorVol + (1 - floorVol) * (k * k);
  }
  _proxSmooth += (prox - _proxSmooth) * 0.2;
  const base = (_currentSong.volume !== undefined) ? _currentSong.volume : 0.3;
  try { _currentAudio.volume = Math.max(0, Math.min(1, base * _proxSmooth)); } catch (e) { /* ignore */ }
}

// ── Internals ───────────────────────────────────────────────────────

function _ensureAC() {
  if (!_ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) _ac = new AC();
  }
  if (_ac && _ac.state === 'suspended' && _ac.resume) _ac.resume();
  return _ac;
}

function _mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function _fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function _buildQueue() {
  const pool = PLAYLIST.filter(s => s.enabled !== false);
  if (!pool.length) return [];
  const arr = _fisherYates(pool.slice());
  if (arr.length > 1 && _lastPlayed && arr[0].name === _lastPlayed) {
    const swap = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swap]] = [arr[swap], arr[0]];
  }
  return arr;
}

function _stopCurrent() {
  if (_chiptuneTimer) { clearTimeout(_chiptuneTimer); _chiptuneTimer = null; }
  if (_advanceTimer) { clearTimeout(_advanceTimer); _advanceTimer = null; }
  _proxSmooth = 1;
  if (_musicGain && _ac) {
    const g = _musicGain, ac = _ac;
    try {
      g.gain.cancelScheduledValues(ac.currentTime);
      g.gain.setValueAtTime(g.gain.value, ac.currentTime);
      g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.12);
      setTimeout(() => { try { g.disconnect(); } catch (_) {} }, 200);
    } catch (_) {}
  }
  _musicGain = null;
  if (_currentAudio) {
    try {
      _currentAudio.pause();
      _currentAudio.onended = null;
      _currentAudio.onerror = null;
      _currentAudio.src = '';
    } catch (_) {}
    _currentAudio = null;
  }
  _currentSong = null;
}

function _scheduleBeat(ac, t, midi, type, dur, gain) {
  if (!_musicGain) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.value = _mtof(midi);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(_musicGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function _playChiptune(song) {
  const ac = _ensureAC();
  if (!ac) { playNext(); return; }
  _musicGain = ac.createGain();
  _musicGain.gain.value = 0;
  _musicGain.gain.linearRampToValueAtTime(0.16, ac.currentTime + 0.08);
  _musicGain.connect(ac.destination);
  const step = 60 / (song.bpm || 120) / 2;
  const bass = song.bass || [], lead = song.lead || [];
  const patLen = Math.max(bass.length, lead.length, 1);
  const loops = Math.max(1, song.loops || 1);
  const endStep = patLen * loops;
  const bassOct = (song.bassOct !== undefined) ? song.bassOct : -12;
  const leadDur = song.leadDur || (step * 0.9);
  const leadGain = song.leadGain || 0.18;
  _musicStart = ac.currentTime + 0.05;
  _musicStep = 0;

  const tick = () => {
    if (!_musicGain) return;
    const now = ac.currentTime;
    const aheadSteps = 8;
    while (_musicStep < endStep && _musicStart + _musicStep * step < now + aheadSteps * step) {
      const t = _musicStart + _musicStep * step;
      const i = _musicStep % patLen;
      if (bass[i] !== undefined) _scheduleBeat(ac, t, bass[i] + bassOct, 'triangle', step * 1.6, 0.45);
      if (lead[i] !== undefined) _scheduleBeat(ac, t, lead[i], 'square', leadDur, leadGain);
      _musicStep++;
    }
    if (_musicStep >= endStep) {
      const endTime = _musicStart + endStep * step + step * 1.7;
      const waitMs = Math.max(0, (endTime - ac.currentTime) * 1000);
      _advanceTimer = setTimeout(() => { _advanceTimer = null; playNext(); }, waitMs);
      return;
    }
    _chiptuneTimer = setTimeout(tick, step * 1000 * 2);
  };
  tick();
}

function _playAudio(song) {
  try {
    const a = new Audio(song.src);
    a.volume = Math.max(0, Math.min(1, (song.volume !== undefined) ? song.volume : 0.3));
    a.preload = 'auto';
    a.loop = false;
    _currentAudio = a;
    const advance = () => {
      if (_currentAudio !== a) return;
      _currentAudio = null;
      playNext();
    };
    a.addEventListener('ended', advance);
    a.addEventListener('error', () => {
      console.warn('[music] audio failed, skipping:', song.src);
      advance();
    });
    const p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(err => {
        console.warn('[music] audio play() rejected:', song.src, err);
        advance();
      });
    }
  } catch (e) {
    console.warn('[music] audio error:', e);
    playNext();
  }
}
