// ─── Coins module ───────────────────────────────────────────────────
// Coin creation, pickup detection, score tracking, and SFX.

import * as THREE from 'three';
import { state } from './state.js';
import { TOTAL_SECRETS, SECRET_COIN_IDS } from './constants.js';
import { reportCoin as _reportCoinToServer } from './leaderboard.js';

// ── State ───────────────────────────────────────────────────────────

export const coins = [];
export let coinScore = 0;
export let coinSecretScore = 0;
export let coinTotal = 0;
export const PICK_RADIUS = 4.6;
const PICK_RADIUS_SQ = PICK_RADIUS * PICK_RADIUS;

// Shared geometry + materials (lazy init)
let _geo = null;
let _mat = null;
let _secretMat = null;
let _sparkleMat = null;
let _secretSparkleMat = null;

// Audio context — shared with music module
export let audioCtx = null;
export function setAudioCtx(ac) { audioCtx = ac; }
export function getAudioCtx() { return audioCtx; }

// Bonk SFX buffer
let _bonkBuffer = null;

// Toast callback
let _showToast = () => { };
export function setToastFn(fn) { _showToast = fn; }

const SFX_MUTE_KEY = 'diy_air_purifier_muted_v2';
let _sfxMuted = false;
try { _sfxMuted = localStorage.getItem(SFX_MUTE_KEY) === '1'; } catch (e) { }

const QUICK_COIN_MODE_KEY = 'diy_air_purifier_quick_coin_mode';
let _quickCoinMode = false;
try { _quickCoinMode = localStorage.getItem(QUICK_COIN_MODE_KEY) === '1'; } catch (e) { }

const SPEED_MODE_KEY = 'diy_air_purifier_speed_mode_v1';
let _speedMode = false;
try { _speedMode = localStorage.getItem(SPEED_MODE_KEY) === '1'; } catch (e) { }

// ── Secret-coin "ever found" persistence (unlock gate for Speed Mode) ──
const SECRET_FOUND_KEY = 'diy_air_purifier_secrets_found_v1';
const _secretFoundIds = new Set();
try {
  const raw = localStorage.getItem(SECRET_FOUND_KEY);
  if (raw) {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const id of arr) if (typeof id === 'string') _secretFoundIds.add(id);
  }
} catch (e) { }

function _getFoundRequiredSecretCount() {
  let found = 0;
  for (const id of SECRET_COIN_IDS) {
    if (_secretFoundIds.has(id)) found++;
  }
  return found;
}

export function getSecretFoundCount() { return _getFoundRequiredSecretCount(); }
export function getSecretTotal() { return TOTAL_SECRETS; }
export function hasFoundAllSecrets() { return _getFoundRequiredSecretCount() >= TOTAL_SECRETS; }
function _markSecretFound(id) {
  if (!id || _secretFoundIds.has(id)) return;
  _secretFoundIds.add(id);
  try { localStorage.setItem(SECRET_FOUND_KEY, JSON.stringify([..._secretFoundIds])); } catch (e) { }
}

export function isSpeedMode() {
  // Speed mode is gated behind finding every secret coin at least once.
  return !!_speedMode && hasFoundAllSecrets();
}
export function setSpeedMode(enabled) {
  // Refuse to enable speed mode until all secrets have been found.
  _speedMode = !!enabled && hasFoundAllSecrets();
  try { localStorage.setItem(SPEED_MODE_KEY, _speedMode ? '1' : '0'); } catch (e) { }
  _applyQuickCoinMode();
}

export function setSfxMuted(muted) {
  _sfxMuted = !!muted;
  try { localStorage.setItem(SFX_MUTE_KEY, _sfxMuted ? '1' : '0'); } catch (e) { }
}

export function isQuickCoinMode() {
  return !!_quickCoinMode;
}

export function setQuickCoinMode(enabled) {
  _quickCoinMode = !!enabled;
  try { localStorage.setItem(QUICK_COIN_MODE_KEY, _quickCoinMode ? '1' : '0'); } catch (e) { }
  _applyQuickCoinMode();
}

// ── Coin factory ────────────────────────────────────────────────────

export function makeCoin(opts) {
  if (!_geo) {
    // Coin profile: beveled rim with a slight dish on the face.
    // LatheGeometry revolves these points around Y to form the coin.
    const r = 1.2, h = 0.14, bevel = 0.06;
    const pts = [
      new THREE.Vector2(0, h),          // center-top
      new THREE.Vector2(r - bevel, h),          // face edge
      new THREE.Vector2(r, h - bevel),  // rim top bevel
      new THREE.Vector2(r, -h + bevel),  // rim bottom bevel
      new THREE.Vector2(r - bevel, -h),          // face edge bottom
      new THREE.Vector2(0, -h),           // center-bottom
    ];
    _geo = new THREE.LatheGeometry(pts, 24);
    _geo.rotateX(Math.PI / 2);
  }
  if (!_mat) {
    _mat = new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      emissive: 0xffb300,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.85
    });
  }
  if (!_sparkleMat) {
    _sparkleMat = new THREE.SpriteMaterial({
      color: 0xffd54f,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  if (opts && opts.secret && !_secretMat) {
    _secretMat = new THREE.MeshStandardMaterial({
      color: 0x4ab8ff,
      emissive: 0x1e88e5,
      emissiveIntensity: 1.5,
      roughness: 0.25,
      metalness: 0.85
    });
  }
  if (opts && opts.secret && !_secretSparkleMat) {
    _secretSparkleMat = new THREE.SpriteMaterial({
      color: 0x80d0ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  const mat = (opts && opts.secret) ? _secretMat : _mat;
  const m = new THREE.Mesh(_geo, mat);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/**
 * Add a coin to the scene.
 */
export function addCoin(parent, localPos, opts) {
  const coin = makeCoin(opts);
  const secret = !!(opts && opts.secret);
  const coinId = (opts && opts.id) || (secret
    ? `secret_${coins.filter(c => c.secret).length + 1}`
    : `coin_${coinTotal + 1}`);
  coin.position.copy(localPos);
  coin.visible = false;

  // Attach subtle glint sprites to the coin mesh
  const sMat = secret ? _secretSparkleMat : _sparkleMat;
  const sparkles = [];
  if (sMat) {
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Sprite(sMat);
      s._baseScale = 0.2 + Math.random() * 0.15;
      s.scale.setScalar(s._baseScale);
      s._phase = (i / 2) * Math.PI * 2 + Math.random() * 0.5;
      s._radius = 1.4 + Math.random() * 0.4;
      s._yOff = (Math.random() - 0.5) * 0.6;
      s._speed = 0.4 + Math.random() * 0.3;
      coin.add(s);
      sparkles.push(s);
    }
  }

  parent.add(coin);
  coins.push({
    id: coinId,
    mesh: coin,
    basePos: localPos.clone(),
    bobPhase: Math.random() * Math.PI * 2,
    spinSpeed: 0.04 + Math.random() * 0.02,
    parent,
    collected: false,
    insidePurifier: !!(opts && opts.insidePurifier),
    inDrawer: !!(opts && opts.inDrawer),
    consoleProp: !!(opts && opts.consoleProp),
    secret,
    sparkles,
    isDynamic: !!(opts && opts.isDynamic),
    highJump: !!(opts && opts.highJump),
    speedModeOnly: !!(opts && opts.speedModeOnly),
    onStandingDesk: !!(opts && opts.onStandingDesk)
  });
  if (!secret) coinTotal++;
}

/**
 * Reset scores + remove dynamic coins for a new run.
 */
export function resetScores() {
  coinScore = 0;
  coinSecretScore = 0;
  // Un-collect all coins so they reappear on the next run
  for (const c of coins) {
    c.collected = false;
    c.mesh.visible = true;
    c.mesh.position.copy(c.basePos);
  }
  // Re-apply quick/speed mode filters (may hide speed-only coins again).
  _applyQuickCoinMode();
}

/**
 * Play the coin chime SFX.
 * @param {boolean} isSecret - play the fancier arpeggio for secret coins
 */
export function playChime(isSecret) {
  try {
    if (_sfxMuted) return;
    const ac = _ensureAC();
    if (!ac) return;
    if (isSecret) {
      const notes = [1047, 1319, 1568, 2093];
      notes.forEach((freq, idx) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.value = 0.15;
        o.connect(g).connect(ac.destination);
        const t = ac.currentTime + idx * 0.08;
        o.start(t);
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.stop(t + 0.32);
      });
    } else {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = 880;
      g.gain.value = 0.12;
      o.connect(g).connect(ac.destination);
      o.start();
      o.frequency.exponentialRampToValueAtTime(1760, ac.currentTime + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
      o.stop(ac.currentTime + 0.26);
    }
  } catch (e) { /* ignore */ }
}

// ── Bonk SFX ────────────────────────────────────────────────────────

export function ensureBonkBuffer(ac) {
  if (_bonkBuffer || !ac) return;
  try {
    const sr = ac.sampleRate;
    const len = Math.ceil(sr * 0.12);
    const buf = ac.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const f0 = 220, f1 = 110;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 28);
      const freq = f0 + (f1 - f0) * (t / 0.12);
      d[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.35;
    }
    _bonkBuffer = buf;
  } catch (e) { /* ignore */ }
}

export function playBonk(intensity) {
  try {
    if (_sfxMuted) return;
    const ac = _ensureAC();
    if (!ac || !_bonkBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = _bonkBuffer;
    const g = ac.createGain();
    g.gain.value = Math.min(0.6, 0.15 + intensity * 0.3);
    src.connect(g).connect(ac.destination);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    src.start();
  } catch (e) { /* ignore */ }
}

/**
 * Play a soft, magical sparkle when a secret coin spawns.
 */
export function playSecretSpawnSfx() {
  try {
    if (_sfxMuted) return;
    const ac = _ensureAC();
    if (!ac) return;
    // Gentle rising sparkle — quiet and mysterious
    const notes = [523, 659, 784];
    notes.forEach((freq, idx) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      const vol = 0.04 - idx * 0.008;          // each note softer
      g.gain.value = 0;
      o.connect(g).connect(ac.destination);
      const t = ac.currentTime + idx * 0.15;
      o.start(t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.06);  // soft fade-in
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.stop(t + 0.47);
    });
  } catch (e) { /* ignore */ }
}

// ── Internal ────────────────────────────────────────────────────────

function _ensureAC() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
  return audioCtx;
}

// ── Coin group ──────────────────────────────────────────────────────

let _coinGroup = null;

export function getCoinGroup() { return _coinGroup; }

export function createCoinGroup(scene) {
  _coinGroup = new THREE.Group();
  _coinGroup.visible = false;
  _coinGroup._isCoins = true; // prevent being scooped into purifierGroup
  scene.add(_coinGroup);
  return _coinGroup;
}

export function setCoinsVisible(vis) {
  if (_coinGroup) _coinGroup.visible = vis;
  for (const c of coins) {
    if (!c.collected) c.mesh.visible = vis;
  }
}

// ── Roof easter-egg sign ────────────────────────────────────────────
// Small wooden post + sign board planted on top of the ceiling, next
// to the `secret_roof` coin. Only visible while coins are visible
// (i.e. game mode), since that's the only context where someone would
// be hunting hard enough to clip up there.

// Sign placement constants (world coords). Exported so collision
// registration in game-fp.js can stay in sync without duplicating math.
export const ROOF_SIGN_X = 6;        // world X of sign group origin
export const ROOF_SIGN_Z = -15;      // world Z of sign group origin
export const ROOF_SIGN_YAW = Math.PI * 0.15; // tilt toward spawn
export const ROOF_SIGN_BOARD_W = 10;
export const ROOF_SIGN_BOARD_H = 5;
export const ROOF_SIGN_BOARD_T = 0.6;
export const ROOF_SIGN_POST_H = 7;
export const ROOF_SIGN_BOARD_CY = ROOF_SIGN_POST_H + 2.5; // local Y of board center

let _woodTex = null;
function _getWoodTexture() {
  if (_woodTex) return _woodTex;
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 256;
  const ctx = cvs.getContext('2d');
  // Base plank color
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(0, 0, 256, 256);
  // Long horizontal grain streaks
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * 256;
    const a = 0.05 + Math.random() * 0.18;
    const c = 40 + Math.random() * 30;
    ctx.strokeStyle = `rgba(${c}, ${c * 0.55}, ${c * 0.25}, ${a})`;
    ctx.lineWidth = 0.4 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      64, y + (Math.random() - 0.5) * 5,
      160, y + (Math.random() - 0.5) * 7,
      256, y + (Math.random() - 0.5) * 5
    );
    ctx.stroke();
  }
  // Highlights for warmth
  for (let i = 0; i < 25; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(220, 170, 110, ${0.04 + Math.random() * 0.08})`;
    ctx.lineWidth = 0.3 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      80, y + (Math.random() - 0.5) * 3,
      170, y + (Math.random() - 0.5) * 4,
      256, y + (Math.random() - 0.5) * 3
    );
    ctx.stroke();
  }
  // A couple of dark knots
  for (let i = 0; i < 2; i++) {
    const x = 30 + Math.random() * 196;
    const y = 30 + Math.random() * 196;
    const r = 5 + Math.random() * 7;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(35, 18, 5, 0.8)');
    grad.addColorStop(0.6, 'rgba(45, 25, 10, 0.4)');
    grad.addColorStop(1, 'rgba(45, 25, 10, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  _woodTex = new THREE.CanvasTexture(cvs);
  _woodTex.wrapS = THREE.RepeatWrapping;
  _woodTex.wrapT = THREE.RepeatWrapping;
  _woodTex.anisotropy = 4;
  return _woodTex;
}

function _makeSignFrontCanvas(lines) {
  const cvs = document.createElement('canvas');
  cvs.width = 512; cvs.height = 256;
  const ctx = cvs.getContext('2d');
  // Wood background tinted lighter so text is readable
  const wood = _getWoodTexture().image;
  ctx.drawImage(wood, 0, 0, cvs.width, cvs.height);
  ctx.fillStyle = 'rgba(244, 228, 188, 0.55)'; // creamy wash
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  // Inner darker border (carved-edge look)
  ctx.strokeStyle = 'rgba(60, 35, 15, 0.7)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, cvs.width - 20, cvs.height - 20);
  ctx.strokeStyle = 'rgba(120, 80, 40, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, cvs.width - 36, cvs.height - 36);
  // Text
  ctx.fillStyle = '#2a1808';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = 30;
  ctx.font = `bold ${fontSize}px -apple-system,BlinkMacSystemFont,sans-serif`;
  const lineH = fontSize + 10;
  const startY = cvs.height / 2 - ((lines.length - 1) * lineH) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cvs.width / 2, startY + i * lineH);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

function _addRoofSign(parent, x, y, z, lines) {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  const woodTex = _getWoodTexture();
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.02
  });

  // Wooden post (slightly thicker than before)
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, ROOF_SIGN_POST_H, 10),
    woodMat
  );
  post.position.y = ROOF_SIGN_POST_H / 2;
  group.add(post);

  // Thick wooden board. Materials array order: [+X, -X, +Y, -Y, +Z, -Z].
  // +Z is the side that faces spawn after the group's CCW yaw, so only
  // that face shows the text; the other five faces are plain wood.
  const frontTex = _makeSignFrontCanvas(lines);
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.02
  });
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(ROOF_SIGN_BOARD_W, ROOF_SIGN_BOARD_H, ROOF_SIGN_BOARD_T),
    [woodMat, woodMat, woodMat, woodMat, frontMat, woodMat]
  );
  board.position.y = ROOF_SIGN_BOARD_CY;
  board.castShadow = false;
  board.receiveShadow = false;
  group.add(board);

  // Tilt so the +Z face points toward the bedroom spawn area.
  group.rotation.y = ROOF_SIGN_YAW;

  parent.add(group);
}

// ── Spawn coins in room (exact monolith placements) ─────────────────

// Import spatial constants for coin placement
import {
  BED_X, BED_Z, BED_W, BED_L, BED_CLEARANCE, BED_SLATS_FROM_FLOOR,
  TBL_X, TBL_Z, TBL_W, TBL_D, TBL_H,
  SIDE_WALL_X, LEFT_WALL_X, OPP_WALL_Z, BACK_WALL_Z, CLOSET_DEPTH, CLOSET_INTERIOR_W, CLOSET_Z,
  getFloorY, getWinCenterY, WIN_W, WIN_H, WIN_CENTER_Z
} from './spatial.js';

export function spawnRoomCoins(roomRefs) {
  if (!_coinGroup) return;
  const fy = getFloorY();
  const bedClearance = BED_CLEARANCE;
  const slatY = fy + BED_SLATS_FROM_FLOOR;
  const mattH = 10, mattY = slatY + 1 + mattH / 2;
  const duvetH = 1.5;
  const hbThick = 3, hbH = 42 - bedClearance; // bedH - bedClearance
  const mattCenterZ = BED_Z - 2;
  // TV vars
  const tvCenterX = BED_X, tvCenterY = fy + 46;
  const tvW = 56.7, tvH = 31.9, tvD = 1.0, bezel = 0.3;
  const tvZ = OPP_WALL_Z + 0.5 + tvD / 2 + 1.1;
  // Mini split vars (must match room.js: msX=51-18-32/2=17 pre-mirror, msH=11, msD=8)
  const msW_r = 32, msH_r = 11, msD_r = 8;
  const msX_r = SIDE_WALL_X - 18 - msW_r / 2; // 17 pre-mirror → world -17
  const msY_r = fy + 80 - 12 - msH_r / 2;     // = fy + 62.5
  const msZ_r = OPP_WALL_Z + 0.5 + msD_r / 2; // = -73.5
  // Console prop world coords (purifier at (45,0,-68) rotated 90° on Y)
  // Xbox local (0, topY+xbH, 8) → world (45+8, topY+xbH, -68)
  const purX = 45, purZ = -68;
  const topY = state.H / 2 + state.ply; // purifier top surface
  const xbH = 11.85; // Xbox Series X height
  // Switch game stack: local (0, floorLocal+stackH, -(D/2+ply+gameD/2+8))
  const floorLocal = -(state.H / 2 + state.ply + state.bunFootH);
  const gameStackH = 29 * 0.43; // 29 cases × 0.43" each
  const gameStackZLocal = -(state.D / 2 + state.ply + 4.1 / 2 + 8.0);

  // 1. Under the bed
  addCoin(_coinGroup, new THREE.Vector3(-BED_X, fy + bedClearance - 1.8, BED_Z + 4), {});
  // 2. Above nightstand (jump to grab)
  addCoin(_coinGroup, new THREE.Vector3(-TBL_X, fy + TBL_H + 5, TBL_Z), {});
  // 3. Middle of room
  addCoin(_coinGroup, new THREE.Vector3(0, fy + 5, 10), {});
  // 4. Near TV wall
  addCoin(_coinGroup, new THREE.Vector3(25, fy + 6, -40), {});
  // 5. High near mini split (jump!)
  addCoin(_coinGroup, new THREE.Vector3(-20, fy + 28, -60), {});
  // 6. On top of bed
  addCoin(_coinGroup, new THREE.Vector3(-BED_X, mattY + mattH / 2 + duvetH + 3, mattCenterZ), {});
  // 7. On top of headboard
  addCoin(_coinGroup, new THREE.Vector3(-BED_X, fy + bedClearance + hbH + 2.5, BED_Z + BED_L / 2 - hbThick / 2), {});
  // 8. On top of switch game stack (world: purX + gameStackZLocal, floorLocal + stackH + 2.5, purZ)
  addCoin(_coinGroup, new THREE.Vector3(purX + gameStackZLocal, floorLocal + gameStackH + 2.5, purZ), { consoleProp: true });
  // 9. On top of Xbox Series X (world: purX + 8, topY + xbH + 2.5, purZ)
  addCoin(_coinGroup, new THREE.Vector3(purX + 8, topY + xbH + 2.5, purZ), { consoleProp: true });
  // 10. On top of mini split
  addCoin(_coinGroup, new THREE.Vector3(-msX_r, msY_r + msH_r / 2 + 2.2, msZ_r), {});
  // 11. On top of TV
  addCoin(_coinGroup, new THREE.Vector3(-tvCenterX, tvCenterY + tvH / 2 + bezel + 2.2, tvZ - tvD / 2 + 1.2), {});
  // 12. In the far corner of the closet (back wall, TV-wall side)
  addCoin(_coinGroup, new THREE.Vector3(-(SIDE_WALL_X + CLOSET_DEPTH - 3), fy + 3, CLOSET_Z - CLOSET_INTERIOR_W / 2 + 4), {});
  // 12b. On the bedroom-closet upper shelf (section 2 of 4 — middle).
  //   Shelf top Y ≈ fy + 56.4 (room.js shelfDrop=24, shelfThk=0.8 → fy+80-24+0.4).
  //   shelfCenterX pre-mirror = SIDE_WALL_X + CLOSET_DEPTH - 0.5 - 0.1 - 14/2 = 79.4 → world -79.4.
  //   shelfZMin = CLOSET_Z - (CLOSET_INTERIOR_W - 1)/2 = -77.5; section 2 center ≈ shelfZMin + shelfLen*3/8 ≈ -53.875.
  addCoin(_coinGroup, new THREE.Vector3(-79.4, fy + 58.9, -53.875), {});
  // 13. On top of lamp shade
  addCoin(_coinGroup, new THREE.Vector3(-(TBL_X + TBL_W / 2 - 6), fy + TBL_H + 28.5, TBL_Z + TBL_D / 2 - 6), {});
  // 14. Inside the purifier, floating in the middle (accessible when filter is open)
  addCoin(_coinGroup, new THREE.Vector3(purX, 0, purZ), { insidePurifier: true });
  // 14b. On top of the cat feeder hopper (jump from the shoe box to grab it)
  //   Pre-mirror feeder X = 28 + 6 = 34, Z = -74, stack = box(5) + body(8) + hopper(6) = 19
  addCoin(_coinGroup, new THREE.Vector3(-34, fy + 19 + 2.5, -74), {});
  // 14c. End of the hallway — centered in the 40" wide corridor, just shy
  //   of the end wall. Hallway runs Z=49..289, X=-51..-11 (post-mirror).
  addCoin(_coinGroup, new THREE.Vector3(-31, fy + 3, 285), {});
  // 14d. Resting on top of the doorknob of the decorative "far" hallway
  //   door (-X wall, 6 ft into the corridor). Door panel center pre-mirror
  //   X≈11.45, knob ball protrudes ~1.5" into the hallway → world X≈-13.65.
  //   Lock rail on the 67"-tall leaf sits ~24" off the floor; coin perches
  //   ~5" above the ball so it reads as balanced on the knob.
  addCoin(_coinGroup, new THREE.Vector3(-13.65, fy + 29.5, 133), {});

  // ── Office coins ─────────────────────────────────────────────────
  // The secret blue desk-top coin (id 'secret_drawer') is spawned on demand
  // by spawnSecretDrawerCoin() the first time the standing desk is raised.
  // 14f. Inside the office (bypass) closet — on the floor, mid-closet.
  //   Closet interior pre-mirror: X=51..87 (innerCx≈69), Z=-14..32 (cz=9).
  addCoin(_coinGroup, new THREE.Vector3(-69, fy + 3, 9), {});
  // 14g. On the office closet upper shelf (middle section, jump challenge).
  //   Shelf top Y ≈ fy + 56.4. Shelf center pre-mirror X ≈ 58.6.
  //   Shelf Z spans -13.5..31.5 → middle of section 2 ≈ Z=2.5.
  addCoin(_coinGroup, new THREE.Vector3(-58.6, fy + 58.9, 2.5), {});
  // 14h. On top of the center OLED monitor on the standing desk (sitting pose).
  //   Desk pre-mirror: deskX=164, deskZ=27, deskTopY = fy + 28.75 (legH=28, topH=1.5).
  //   Center monitor: X = deskX + deskD/2 - 5 = 174, Y center = fy + 42.5, Z = deskZ = 27.
  //   Top of 14"-tall monitor = fy + 49.5; coin floats 2.5" above.
  //   Tagged onStandingDesk so it rides up/down with the desk lerp.
  addCoin(_coinGroup, new THREE.Vector3(-174, fy + 52, 27), { onStandingDesk: true });

  // 14i. Roof easter egg — a secret coin sitting on top of the ceiling,
  //   with a little sign next to it. You're not supposed to be able to
  //   reach this; it's a fourth-wall wink for anyone who finds a clip.
  //   `secret_roof` is intentionally NOT in SECRET_COIN_IDS, so collecting
  //   it doesn't count toward Speed Mode unlock.
  //   The sign sits at (signX, _, signZ); the coin is tucked behind it
  //   on the far side, so you have to walk around the sign to grab it.
  const _signX = 6, _signZ = -15;
  const _ceilY = fy + 80;
  _addRoofSign(_coinGroup, _signX, _ceilY + 0.2, _signZ, [
    "How'd you get up here?",
    "This isn't finished yet!",
    '— Brandon'
  ]);
  addCoin(_coinGroup, new THREE.Vector3(_signX + 8, _ceilY + 6, _signZ + 1), {
    id: 'secret_roof',
    secret: true
  });

  // 15. Hidden inside a random nightstand drawer (moves with the drawer when opened)
  if (roomRefs && roomRefs.drawers && roomRefs.drawers.length > 0) {
    const drawerIdx = Math.floor(Math.random() * roomRefs.drawers.length);
    const drw = roomRefs.drawers[drawerIdx];
    // Place coin inside the drawer tray (local coords relative to drawer group)
    // After X-mirror, drawer group.position.x is pre-mirror, so coin world X = -drw.pos.x
    // Coin is in _coinGroup (world space), so we compute the world position
    const coinInDrawer = makeCoin();
    // Drawer center in world space (already mirrored since drawer is _isRoom)
    const dwx = drw.position.x;
    const dwy = drw.position.y;
    const dwz = drw.position.z + (drw._drawerTrayD || 10) / 2 + 0.4; // center of tray
    coinInDrawer.position.set(dwx, dwy, dwz);
    coinInDrawer.visible = false;
    // Add glint sprites to drawer coin
    const drawerSparkles = [];
    if (_sparkleMat) {
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Sprite(_sparkleMat);
        s._baseScale = 0.2 + Math.random() * 0.15;
        s.scale.setScalar(s._baseScale);
        s._phase = (i / 2) * Math.PI * 2 + Math.random() * 0.5;
        s._radius = 1.4 + Math.random() * 0.4;
        s._yOff = (Math.random() - 0.5) * 0.6;
        s._speed = 0.4 + Math.random() * 0.3;
        coinInDrawer.add(s);
        drawerSparkles.push(s);
      }
    }
    _coinGroup.add(coinInDrawer);
    const drawerCoinEntry = {
      id: 'coin_' + (coinTotal + 1),
      mesh: coinInDrawer,
      basePos: new THREE.Vector3(dwx, dwy, dwz),
      bobPhase: Math.random() * Math.PI * 2,
      spinSpeed: 0.04 + Math.random() * 0.02,
      parent: _coinGroup,
      collected: false,
      insidePurifier: false,
      inDrawer: true,
      consoleProp: false,
      secret: false,
      sparkles: drawerSparkles,
      isDynamic: false,
      _drawerRef: drw,
      _allDrawers: roomRefs.drawers,
      _wasAnyOpen: false
    };
    coins.push(drawerCoinEntry);
    coinTotal++;
  }

  _spawnSpeedModeCoins();

  _applyQuickCoinMode();
}

// 12 extra coins that only spawn in Speed Mode. Floating in the air through
// the main room and inside the closet — no guest-room hallway since it's
// inaccessible. Heights vary so some require jumps off furniture.
function _spawnSpeedModeCoins() {
  const fy = getFloorY();
  // World-space (post-mirror) coords. Room ≈ X[-51..+80], Z[-78..+49].
  // Closet interior ≈ X[-87..-51], Z[-78..-14]. Avoid solid furniture by
  // staying mid-air or above known walkable spots.
  const positions = [
    // ── Main room — air coins along a meandering trail ──
    new THREE.Vector3(10, fy + 22, 30),  // 1. above center, near back wall
    new THREE.Vector3(35, fy + 38, 20),  // 2. high over middle-window side
    new THREE.Vector3(60, fy + 28, -10),  // 3. window side, mid-room
    new THREE.Vector3(55, fy + 14, -45),  // 4. low near window/TV corner
    new THREE.Vector3(20, fy + 32, -55),  // 5. high mid-room, TV side
    new THREE.Vector3(-10, fy + 18, -30),  // 6. mid-air, TV-wall side
    new THREE.Vector3(-25, fy + 44, 15),  // 7. very high near closet-wall edge
    new THREE.Vector3(-5, fy + 10, 35),  // 8. low between bed & nightstand area
    new THREE.Vector3(40, fy + 50, 5),  // 9. ceiling-light height, mid-room
    // ── Closet — three coins sitting on the upper shelf, in 3 of the 4 sections ──
    // Shelf top Y ≈ fy + 56.4 (interiorH 80 - drop 24 + 0.4 half-thickness).
    // Shelf X spans world -86.4 .. -72.4 (centered at -79.4).
    // Section centers along Z (shelfZMin=-77.5, sectionW=15.75):
    //   sec1=-69.625, sec2=-53.875, sec3=-38.125, sec4=-22.375.
    new THREE.Vector3(-79.4, fy + 58.9, -69.6),  // 10. shelf section 1 (back-left)
    new THREE.Vector3(-79.4, fy + 58.9, -53.9),  // 11. shelf section 2
    new THREE.Vector3(-79.4, fy + 58.9, -22.4),  // 12. shelf section 4 (front-right)
  ];
  // Apply a small per-session jitter so positions feel "random" but stay
  // inside their hand-picked safe pockets.
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const jx = (Math.random() - 0.5) * 6;
    const jy = (Math.random() - 0.5) * 4;
    const jz = (Math.random() - 0.5) * 6;
    addCoin(_coinGroup, new THREE.Vector3(p.x + jx, p.y + jy, p.z + jz),
      { speedModeOnly: true, id: `coin_speed_${i + 1}` });
  }
}

// ── Secret coin system ──────────────────────────────────────────────

const _secretTriggered = {};

function _spawnSecretIfUntriggered(id, parent, pos, opts) {
  if (_secretTriggered[id]) return;
  _secretTriggered[id] = true;
  addCoin(parent, pos, { ...opts, secret: true, isDynamic: true, id: 'secret_' + id });
  // Make the just-spawned coin visible immediately (we're already in game mode)
  const justAdded = coins[coins.length - 1];
  if (justAdded) justAdded.mesh.visible = true;
  playSecretSpawnSfx();
}

export function spawnSecretBinderCoin(worldPos) {
  if (!worldPos) return;
  // Floats above the open Pokémon binder under the bed.
  _spawnSecretIfUntriggered('binder', _coinGroup, worldPos.clone(), {});
}

export function spawnSecretLampCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('lamp', _coinGroup,
    new THREE.Vector3(-(TBL_X + TBL_W / 2 - 6), fy + TBL_H + 22.4, TBL_Z + TBL_D / 2 - 6), {});
}

export function spawnSecretMiniSplitCoin() {
  // Hovers in the air-stream just in front of the mini-split vent.
  // Mini-split center (post-mirror world): x=-17, y≈fy+62.5, z=-73.5;
  // vent face is ~4.16" forward of center along +Z. We park the coin
  // ~14" forward of the vent and a bit below the louvers so it sits
  // squarely in the visible airflow.
  const fy = getFloorY();
  _spawnSecretIfUntriggered('minisplit', _coinGroup,
    new THREE.Vector3(-17, fy + 53, -55), {});
}

// Shift basePos.y of every active coin tagged onStandingDesk. Called from
// the standing-desk raise/lower lerp so the coin rides on the desktop.
export function nudgeStandingDeskCoins(deltaY) {
  if (!deltaY) return;
  for (const c of coins) {
    if (c && c.onStandingDesk && c.basePos) c.basePos.y += deltaY;
  }
}

export function spawnSecretWindowCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('window', _coinGroup,
    new THREE.Vector3(-LEFT_WALL_X - 2, getWinCenterY() - WIN_H / 2 + 3, WIN_CENTER_Z), {});
}

// Spawned the first time the player slides the office window open.
// Floats just outside the opening (a few inches past the front-wall
// plane), in the lower half of the sash so the player can grab it
// without cracking their head on the upper sash. Office front wall
// pre-mirror X = 183 → post-mirror X = -183; we park the coin 8" further
// out at X = -191. Y sits ~10" below window center; Z matches the
// opening's center (grWinCenterZ = -4.5).
export function spawnSecretWindowOpenCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('windowOpen', _coinGroup,
    new THREE.Vector3(-191, fy + 38, -4.5), {});
}

// Spawned the first time the player raises the standing desk. The coin
// sits on top of the desktop and is tagged onStandingDesk so the desk
// lerp can drag it up/down with the surface. Reset by resetSecrets().
export function spawnSecretDrawerCoin() {
  const fy = getFloorY();
  // Pre-mirror desk: X=164, Z=27, top Y=fy+30 at sit height. Use the
  // raised height (fy+30+rise) so it spawns at the desk's current top.
  // Caller is purifier.js click handler — it spawns this when sd is being
  // raised, so the desk-lerp will then carry the coin up by sd.max.
  // Y here is base (sit) Y; the lerp delta from rise=0 → rise=max will
  // lift basePos by sd.max via nudgeStandingDeskCoins.
  _spawnSecretIfUntriggered('drawer', _coinGroup,
    new THREE.Vector3(-(164 - 6), fy + 30 + 2.5, 27),
    { onStandingDesk: true });
}

export function spawnSecretMacbookCoin() {
  const fy = getFloorY();
  // Float above the macbook on the bed
  const mattH = 10, slatY = fy + BED_SLATS_FROM_FLOOR;
  const mattY = slatY + 1 + mattH / 2;
  const bedTopY = mattY + mattH / 2 + 1.5;
  const rawX = BED_X - 58 / 2 + 12 + 24;
  _spawnSecretIfUntriggered('macbook', _coinGroup,
    new THREE.Vector3(-rawX, bedTopY + 9, BED_Z + 6), {});
}

export function spawnSecretTvCoin() {
  const fy = getFloorY();
  const tvD = 1.0;
  const tvZ = OPP_WALL_Z + 0.5 + tvD / 2 + 1.1;
  // Below the TV, centered, floating 6" off the ground
  _spawnSecretIfUntriggered('tv', _coinGroup,
    new THREE.Vector3(-BED_X, fy + 6, tvZ), {});
}

export function spawnSecretFoodBowlCoin(worldPos) {
  if (!worldPos) return;
  _spawnSecretIfUntriggered('foodBowl', _coinGroup, worldPos.clone(), {});
}

// ── Full reset for new run ──────────────────────────────────────────

export function fullReset() {
  coinScore = 0;
  coinSecretScore = 0;

  // Remove dynamic (secret) coins
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (c.isDynamic) {
      if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
      coins.splice(i, 1);
    }
  }

  // Clear secret triggers so they can re-spawn
  for (const k of Object.keys(_secretTriggered)) delete _secretTriggered[k];

  // Un-collect all remaining coins
  for (const c of coins) {
    c.collected = false;
    c.mesh.visible = true;
    c.mesh.position.copy(c.basePos);
  }

  // Recalculate coinTotal (secrets were removed)
  coinTotal = coins.filter(c => !c.secret).length;
  _applyQuickCoinMode();
}

// ── Per-frame update ────────────────────────────────────────────────

export function updateCoins(ts, playerPos) {
  if (!_coinGroup || !_coinGroup.visible) return;

  const t = ts * 0.001;

  for (const c of coins) {
    if (c.collected) continue;

    // Spin + bob
    c.mesh.rotation.y = t * c.spinSpeed * 60;
    c.mesh.position.y = c.basePos.y + Math.sin(t * 2 + c.bobPhase) * 0.8;

    // Animate glint sprites — slow orbit, intermittent flash
    if (c.sparkles) {
      const coinRot = c.mesh.rotation.y;
      for (const s of c.sparkles) {
        const angle = s._phase + t * s._speed;
        const localAngle = angle - coinRot;
        s.position.set(
          Math.cos(localAngle) * s._radius,
          s._yOff + Math.sin(t * 1.5 + s._phase) * 0.3,
          Math.sin(localAngle) * s._radius
        );
        // Glint: mostly invisible, brief flash peaks
        const wave = Math.sin(t * 2.5 + s._phase * 3);
        const flash = Math.max(0, wave * wave * wave); // sharp peaks
        s.scale.setScalar(s._baseScale * flash);
      }
    }

    // Drawer coins: track the drawer's slide position
    if (c.inDrawer && c._drawerRef) {
      // Reshuffle to a different drawer when all drawers transition to closed.
      if (c._allDrawers && c._allDrawers.length > 1) {
        let anyOpen = false;
        for (const d of c._allDrawers) {
          if (d._drawerSlide > 0.01 || d._drawerOpen) { anyOpen = true; break; }
        }
        if (c._wasAnyOpen && !anyOpen) {
          // Pick a different drawer than the current one
          const others = c._allDrawers.filter(d => d !== c._drawerRef);
          if (others.length > 0) {
            c._drawerRef = others[Math.floor(Math.random() * others.length)];
          }
        }
        c._wasAnyOpen = anyOpen;
      }
      const drw = c._drawerRef;
      const dwz = drw.position.z + (drw._drawerTrayD || 10) / 2 + 0.4;
      c.mesh.position.x = drw.position.x;
      c.basePos.x = drw.position.x;
      c.basePos.y = drw.position.y;
      c.mesh.position.z = dwz;
      c.basePos.z = dwz;
    }

    // Pickup check
    if (playerPos) {
      const dx = c.mesh.position.x - playerPos.x;
      const dy = (c.mesh.position.y) - (playerPos.y - 2); // mid-body
      const dz = c.mesh.position.z - playerPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < PICK_RADIUS_SQ) {
        c.collected = true;
        c.mesh.visible = false;
        if (c.secret) {
          coinSecretScore++;
          const wasComplete = hasFoundAllSecrets();
          _markSecretFound(c.id);
          playChime(true);
          if (!wasComplete && hasFoundAllSecrets()) {
            _showToast('All secrets found — Speed Mode unlocked!');
          } else {
            _showToast('Secret coin found!');
          }
        } else {
          coinScore++;
          playChime(false);
          // Report to shared leaderboard API (non-blocking, fire-and-forget)
          _reportCoinToServer(c.id);
        }
      }
    }
  }
}

function _applyQuickCoinMode() {
  // Speed-mode coins only count/show when speed mode is enabled.
  const allRegular = coins.filter(c => !c.secret);
  const activeRegular = allRegular.filter(c => _speedMode || !c.speedModeOnly);
  // Hide (and mark collected to avoid pickup) any speed-only coin that
  // shouldn't be active this run.
  for (const c of allRegular) {
    if (c.speedModeOnly && !_speedMode) {
      c.collected = true;
      c.mesh.visible = false;
    }
  }
  if (!activeRegular.length) {
    coinTotal = 0;
    return;
  }

  if (!_quickCoinMode) {
    coinTotal = activeRegular.length;
    for (const c of activeRegular) {
      c.collected = false;
      c.mesh.visible = !!(_coinGroup && _coinGroup.visible);
      c.mesh.position.copy(c.basePos);
    }
    return;
  }

  const keep = activeRegular.find(c => c.id === 'coin_3')
    || activeRegular.find(c => !c.inDrawer && !c.insidePurifier)
    || activeRegular[0];

  for (const c of activeRegular) {
    if (c === keep) {
      c.collected = false;
      c.mesh.visible = !!(_coinGroup && _coinGroup.visible);
      c.mesh.position.copy(c.basePos);
    } else {
      c.collected = true;
      c.mesh.visible = false;
    }
  }

  coinTotal = 1;
}
