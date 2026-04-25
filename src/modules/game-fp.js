// ─── First-person game mode ─────────────────────────────────────────
// FP physics, camera, input, collision, and mode transitions.
// Ported from the monolith (index.html ~L8224-8530, L10595-10830).

import * as THREE from 'three';
import { state } from './state.js';
import {
  PLAYER_EYE_H, PLAYER_BODY_R, PLAYER_HEAD_EXTRA,
  PLAYER_SPAWN_X, PLAYER_SPAWN_Z,
  getPlayerFloorY, getFloorY,
  SIDE_WALL_X, LEFT_WALL_X, OPP_WALL_Z,
  CLOSET_DEPTH, CLOSET_INTERIOR_W, CLOSET_W, CLOSET_Z,
  BED_X, BED_Z, BED_W, BED_L, BED_H, BED_CLEARANCE, BED_SLATS_FROM_FLOOR,
  TBL_X, TBL_Z, TBL_W, TBL_D, TBL_H,
  WALL_HEIGHT, PLACEMENT_OFFSETS
} from './spatial.js';
import { getBounds, boundsBase, acquireBox, resetBoxPool, easeAlpha, BODY_R, EYE_H, HEAD_EXTRA } from './game-collision.js';
import * as coins from './coins.js';
import * as leaderboard from './leaderboard.js';
import * as catAnimation from './cat-animation.js';
import { trapFocus, saveFocus } from './a11y.js';
import { RAYCAST_INTERVAL_MS } from './constants.js';

// ── State ───────────────────────────────────────────────────────────

export let fpMode = false;
export const fpPos = new THREE.Vector3(PLAYER_SPAWN_X, getPlayerFloorY(), PLAYER_SPAWN_Z);
export let fpYaw = 0;
export let fpPitch = 0;
export let fpVy = 0;
export let fpPaused = false;

export const fpKeys = { w: false, a: false, s: false, d: false, space: false, shift: false };
export let fpLookDX = 0;
export let fpLookDY = 0;

export let lastCatFacingYaw = Math.PI;
export let fpCamMode = 'third'; // 'first' or 'third'

// ── SFX mute state ─────────────────────────────────────────────────

export let sfxMuted = false;
export let musicMuted = false;

const SFX_MUTE_KEY = 'diy_air_purifier_muted_v2';
const MUSIC_MUTE_KEY = 'diy_air_purifier_music_muted_v2';
const MOUSE_SENS_KEY = 'diy_air_purifier_mouse_sens_v1';
const SPEED_MODE_KEY = 'diy_air_purifier_speed_mode_v1';

try { sfxMuted = localStorage.getItem(SFX_MUTE_KEY) === '1'; } catch (e) {}
try { musicMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1'; } catch (e) {}

// ── Speed mode (3x top speed, slower acceleration) ──────────────────
// Gated behind finding every secret coin at least once (see coins.hasFoundAllSecrets).
export let speedMode = false;
try { speedMode = localStorage.getItem(SPEED_MODE_KEY) === '1'; } catch (e) {}
// Force-off at boot if the unlock hasn't happened on this device yet.
if (speedMode && !coins.hasFoundAllSecrets()) {
  speedMode = false;
  try { localStorage.setItem(SPEED_MODE_KEY, '0'); } catch (e) {}
}
export function isSpeedMode() { return speedMode && coins.hasFoundAllSecrets(); }
export function setSpeedMode(enabled) {
  speedMode = !!enabled && coins.hasFoundAllSecrets();
  try { localStorage.setItem(SPEED_MODE_KEY, speedMode ? '1' : '0'); } catch (e) {}
}

// ── Mouse sensitivity (1.0 = default) ───────────────────────────────
export let mouseSens = 1.0;
try {
  const raw = localStorage.getItem(MOUSE_SENS_KEY);
  if (raw != null) {
    const v = parseFloat(raw);
    if (isFinite(v)) mouseSens = Math.max(0.25, Math.min(2.5, v));
  }
} catch (e) {}

function _syncMouseSensUi() {
  const slider = document.getElementById('fpPauseMouseSens');
  const label = document.getElementById('fpPauseMouseSensVal');
  if (slider && slider.value !== String(mouseSens)) slider.value = String(mouseSens);
  if (label) label.textContent = `${mouseSens.toFixed(2)}×`;
}

export function setMouseSens(v) {
  const n = parseFloat(v);
  if (!isFinite(n)) return;
  mouseSens = Math.max(0.25, Math.min(2.5, n));
  try { localStorage.setItem(MOUSE_SENS_KEY, String(mouseSens)); } catch (e) {}
  _syncMouseSensUi();
}

export function syncMouseSensUi() {
  _syncMouseSensUi();
}

function _syncAudioToggleUi() {
  const sfxTog = document.getElementById('fpPauseMuteSfx');
  const musicTog = document.getElementById('fpPauseMuteMusic');
  const sfxState = document.getElementById('fpPauseMuteSfxState');
  const musicState = document.getElementById('fpPauseMuteMusicState');

  const sfxOn = !sfxMuted;
  const musicOn = !musicMuted;

  if (sfxTog) {
    sfxTog.classList.toggle('on', sfxOn);
    sfxTog.setAttribute('aria-checked', String(sfxOn));
    sfxTog.setAttribute('aria-label', sfxOn ? 'SFX enabled' : 'SFX muted');
  }
  if (musicTog) {
    musicTog.classList.toggle('on', musicOn);
    musicTog.setAttribute('aria-checked', String(musicOn));
    musicTog.setAttribute('aria-label', musicOn ? 'Music enabled' : 'Music muted');
  }

  if (sfxState) {
    sfxState.textContent = sfxOn ? 'On' : 'Muted';
    sfxState.classList.toggle('off', !sfxOn);
  }
  if (musicState) {
    musicState.textContent = musicOn ? 'On' : 'Muted';
    musicState.classList.toggle('off', !musicOn);
  }
}

export function syncAudioToggleUi() {
  _syncAudioToggleUi();
}

export function setSfxMuted(muted) {
  sfxMuted = !!muted;
  try { localStorage.setItem(SFX_MUTE_KEY, sfxMuted ? '1' : '0'); } catch (e) {}
  _syncAudioToggleUi();
}

export function setMusicMuted(muted) {
  musicMuted = !!muted;
  try { localStorage.setItem(MUSIC_MUTE_KEY, musicMuted ? '1' : '0'); } catch (e) {}
  _syncAudioToggleUi();
}

// ── Internal state ──────────────────────────────────────────────────

let _velX = 0, _velZ = 0;

/**
 * Return the current horizontal speed in inches/second.
 * Uses physics velocity directly — no noisy position-delta math.
 */
export function getHorizSpeed() {
  // _velX/_velZ are in units-per-frame-at-60fps; multiply by 60 for per-second
  return Math.hypot(_velX, _velZ) * 60;
}

let _bobPhase = 0;
let _lastPhysicsTs = 0;
let _spaceHeld = 0;            // total frames space has been held (legacy: jump-hold UI)
let _jumpHoldFrames = 0;       // frames of variable-height boost applied this jump
let _isJumping = false;        // true between liftoff and apex of current jump
let _coyoteFrames = 0;         // frames remaining where a late jump is still allowed
let _jumpBufferFrames = 0;     // frames remaining where a pre-press will trigger on land
let _spaceWasDown = false;     // edge-detect for space press
let _wasBonking = false;
let _wasGroundedLast = true;
let _wasAimingAtInteractable = false;
let _lastAimToneTs = 0;
let _lastCrosshairRaycastTs = 0;
let _crosshairAimingAtInteractable = false;
let _lastFootstepTs = 0;
let _wasFootstepMoving = false;
let _lastUiInteractTs = 0;
let _quickControlsVisible = false;

// Cached DOM elements (looked up once in init or on first use)
let _cachedCbBar = null, _cachedCbFill = null, _cachedCbValue = null, _cachedCbLabel = null;
let _cachedCrosshair = null;
let _domCached = false;

function _cacheDom() {
  if (_domCached) return;
  _domCached = true;
  _cachedCbBar = document.getElementById('fpChargeBar');
  _cachedCbFill = document.getElementById('fpChargeFill');
  _cachedCbValue = document.getElementById('fpChargeValue');
  _cachedCbLabel = document.getElementById('fpChargeLabel');
  _cachedCrosshair = document.getElementById('fpCrosshair');
}

// Charge glow light parented to the cat — intensity ramps with charge tier.
let _chargeLight = null;
let _chargeLightTarget = 0;
function _ensureChargeLight() {
  if (_chargeLight || !_catGroup) return;
  // PointLight at the cat's belly height; tinted toward gold as it intensifies
  // (driven by per-frame .color updates in the charge UI block).
  _chargeLight = new THREE.PointLight(0x88ddff, 0, 60, 1.6);
  _chargeLight.position.set(0, 4, 0);
  _catGroup.add(_chargeLight);
}

// ── Super Saiyan aura (full charge / MEGA tier) ────────────────────
// Yellow emissive boost on every cat material + a flickering additive
// sphere/halo around the cat. Only kicks in once chargeTier === 3.
let _ssAura = null;          // additive yellow sphere child of _catGroup
let _ssHalo = null;          // additive yellow ring/sprite child of _catGroup
let _ssMatCache = null;      // Map<material, {emissive:Color, intensity:number}>
let _ssAuraStrength = 0;     // smoothed 0..1 drive value
const _ssGold = new THREE.Color(0xffe070);
const _ssGoldHot = new THREE.Color(0xfff8b0);

function _ensureSuperSaiyanAura() {
  if (_ssAura || !_catGroup) return;
  // Soft additive sphere a bit larger than the cat — looks like a body halo.
  const geom = new THREE.SphereGeometry(7.5, 24, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffe070,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide, // glow is brighter on the silhouette edge
  });
  _ssAura = new THREE.Mesh(geom, mat);
  _ssAura.position.set(0, 4, 0);
  _ssAura.renderOrder = 999;
  _ssAura.frustumCulled = false;
  _catGroup.add(_ssAura);

  // Outer flickery halo — slightly bigger, front side, lower opacity.
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff2a0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _ssHalo = new THREE.Mesh(new THREE.SphereGeometry(10, 20, 12), haloMat);
  _ssHalo.position.set(0, 4, 0);
  _ssHalo.renderOrder = 999;
  _ssHalo.frustumCulled = false;
  _catGroup.add(_ssHalo);
}

function _applySuperSaiyan(strength /* 0..1 */, ts) {
  _ensureSuperSaiyanAura();
  if (!_ssAura) return;
  // Smooth strength so leaving tier-3 fades out instead of popping.
  const lerpK = 0.18;
  _ssAuraStrength += (strength - _ssAuraStrength) * lerpK;
  const s = _ssAuraStrength;

  // Aura visibility + flicker
  const flicker = 0.85 + 0.15 * Math.sin(ts * 0.06) + 0.05 * Math.sin(ts * 0.013);
  const auraOpacity = Math.min(1, s * 0.55) * flicker;
  _ssAura.material.opacity = auraOpacity;
  _ssAura.visible = auraOpacity > 0.005;
  const pulse = 1 + 0.08 * Math.sin(ts * 0.02);
  const baseScale = 0.85 + s * 0.55;
  _ssAura.scale.setScalar(baseScale * pulse);

  if (_ssHalo) {
    const haloOpacity = Math.min(1, s * 0.32) * flicker;
    _ssHalo.material.opacity = haloOpacity;
    _ssHalo.visible = haloOpacity > 0.005;
    _ssHalo.scale.setScalar(baseScale * (1.05 + 0.06 * Math.sin(ts * 0.018)));
  }

  // Walk meshes once and patch emissive. Cache originals so we can restore
  // when the strength falls back to ~0.
  if (!_ssMatCache) _ssMatCache = new Map();
  const wantOverride = s > 0.005;
  _catGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (obj === _ssAura || obj === _ssHalo) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || !('emissive' in m)) continue;
      let entry = _ssMatCache.get(m);
      if (!entry) {
        entry = {
          emissive: m.emissive.clone(),
          intensity: m.emissiveIntensity ?? 1,
        };
        _ssMatCache.set(m, entry);
      }
      if (wantOverride) {
        // Blend original emissive toward gold based on strength.
        m.emissive.copy(entry.emissive).lerp(_ssGoldHot, Math.min(1, s));
        m.emissiveIntensity = entry.intensity + s * 1.4 * flicker;
      } else {
        m.emissive.copy(entry.emissive);
        m.emissiveIntensity = entry.intensity;
      }
    }
  });
}

const HUD_IDLE_CONTROLS_MS = 1400;

const PITCH_MIN = -1.45;
const PITCH_MAX = 1.55;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _viewDir = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _ray = new THREE.Raycaster();
_ray.far = 220;
_ray.firstHitOnly = true;
const _rayCenter = new THREE.Vector2(0, 0);
let _pointerLockRetryTimer = null;

let _savedFov = 42;
let _fpIgnorePointerUnlock = false;

// References set by init()
let _camera = null;
let _canvas = null;
let _controls = null;
let _catGroup = null;
let _catMixer = null;
let _scene = null;
let _placementOffset = null;
let _markShadowsDirty = null;
let _showToast = null;
let _roomRefs = null;
let _purifierRefs = null;
let _fpHud = null;
let _purifierGroup = null;

// Collision boxes from room (set during init)
let _staticBoxes = [];
const _dynWorldBox = new THREE.Box3();
const _dynMin = new THREE.Vector3();
const _dynMax = new THREE.Vector3();

// Reusable vectors for dynamic collision (avoid per-frame allocations)
const _doorWP = new THREE.Vector3();
const _doorWQ = new THREE.Quaternion();
const _doorEuler = new THREE.Euler();
const _macWP = new THREE.Vector3();
const _macBB = new THREE.Box3();
const _macSz = new THREE.Vector3();
const _knobWP = new THREE.Vector3();
let _macScreenBBCached = false;
let _macScreenHW = 0, _macScreenHH = 0;

// Cached purifier + console collision (rebuilt only on placement/config change)
let _purifierBoxesCache = null;
let _purifierBoxesDirtyFlag = true;
let _purifierFilterSig = -1;
export function invalidatePurifierCollision() { _purifierBoxesDirtyFlag = true; }

function _isObjectVisibleInWorld(obj) {
  for (let n = obj; n; n = n.parent) {
    if (n.visible === false) return false;
  }
  return true;
}

function _pushWorldAabbBox(result, obj, padXZ = 0) {
  if (!obj || !obj.isObject3D || !_isObjectVisibleInWorld(obj)) return;
  obj.updateWorldMatrix(true, true);
  _dynWorldBox.setFromObject(obj);
  if (_dynWorldBox.isEmpty()) return;

  _dynMin.copy(_dynWorldBox.min);
  _dynMax.copy(_dynWorldBox.max);

  const b = acquireBox();
  b.xMin = _dynMin.x - padXZ;
  b.xMax = _dynMax.x + padXZ;
  b.zMin = _dynMin.z - padXZ;
  b.zMax = _dynMax.z + padXZ;
  b.yTop = _dynMax.y;
  b.yBottom = _dynMin.y;
  result.push(b);
}

// ── Bonk SFX ────────────────────────────────────────────────────────

let _bonkBuffer = null;
let _bonkAC = null;

function _ensureSfxAudioCtx() {
  let ac = _bonkAC || coins.getAudioCtx();
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ac = new AC();
    if (ac && coins.setAudioCtx) coins.setAudioCtx(ac);
  }
  if (ac && ac.state === 'suspended' && ac.resume) ac.resume();
  _bonkAC = ac;
  return ac;
}

function _ensureBonkBuffer(ac) {
  if (_bonkBuffer || !ac) return;
  const sr = ac.sampleRate;
  const dur = 0.12;
  const len = Math.floor(sr * dur);
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    d[i] = Math.sin(2 * Math.PI * 180 * t) * 0.3 * Math.exp(-t * 30);
  }
  _bonkBuffer = buf;
}

function _playBonk(intensity) {
  const ac = _ensureSfxAudioCtx();
  if (!ac || sfxMuted) return;
  _ensureBonkBuffer(ac);
  if (!_bonkBuffer) return;
  const src = ac.createBufferSource();
  src.buffer = _bonkBuffer;
  const gain = ac.createGain();
  gain.gain.value = Math.min(1, intensity * 0.6);
  src.connect(gain).connect(ac.destination);
  src.start();
}

function _playTone({ freq, endFreq, dur = 0.06, gain = 0.02, type = 'sine' }) {
  const ac = _ensureSfxAudioCtx();
  if (!ac || sfxMuted) return;
  const now = ac.currentTime;
  const src = ac.createOscillator();
  const g = ac.createGain();
  src.type = type;
  src.frequency.setValueAtTime(Math.max(40, Number(freq) || 440), now);
  if (Number.isFinite(endFreq) && endFreq > 0) {
    src.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + dur);
  }
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gain, now + Math.min(0.012, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(g).connect(ac.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

function _playModeCue(entering) {
  if (entering) {
    _playTone({ freq: 420, endFreq: 560, dur: 0.075, gain: 0.016, type: 'sine' });
  } else {
    _playTone({ freq: 560, endFreq: 390, dur: 0.075, gain: 0.016, type: 'sine' });
  }
}

function _playPauseCue(pausing) {
  if (pausing) {
    _playTone({ freq: 520, endFreq: 450, dur: 0.05, gain: 0.014, type: 'triangle' });
  } else {
    _playTone({ freq: 450, endFreq: 520, dur: 0.05, gain: 0.014, type: 'triangle' });
  }
}

function _playJumpCue(chargeNorm) {
  const n = Math.max(0, Math.min(1, chargeNorm));
  _playTone({
    freq: 300 + n * 120,
    endFreq: 500 + n * 180,
    dur: 0.065,
    gain: 0.016 + n * 0.01,
    type: 'triangle'
  });
}

function _playLandCue(impactNorm) {
  const n = Math.max(0, Math.min(1, impactNorm));
  if (n < 0.12) return;
  _playTone({
    freq: 170 - n * 35,
    endFreq: 115 - n * 25,
    dur: 0.075,
    gain: 0.011 + n * 0.012,
    type: 'sine'
  });
}

function _playAimCue() {
  _playTone({ freq: 900, endFreq: 760, dur: 0.03, gain: 0.009, type: 'sine' });
}

function _playFootstepCue(speedNorm, sprinting) {
  const n = Math.max(0, Math.min(1, speedNorm));
  const base = sprinting ? 160 : 145;
  const jitter = (Math.random() - 0.5) * 16;
  _playTone({
    freq: base + jitter,
    endFreq: base - 34 + jitter * 0.4,
    dur: sprinting ? 0.06 : 0.052,
    gain: 0.007 + n * 0.006,
    type: 'triangle'
  });
  _playTone({
    freq: 520 + Math.random() * 120,
    endFreq: 390 + Math.random() * 30,
    dur: 0.02,
    gain: 0.0025 + n * 0.0015,
    type: 'sine'
  });
}

// ── Init ────────────────────────────────────────────────────────────

// Cached list of interactive objects for crosshair raycasting
let _interactiveObjects = [];

export function init(refs) {
  _camera = refs.camera;
  _canvas = refs.canvas;
  _controls = refs.controls;
  _catGroup = refs.catGroup;
  _scene = refs.scene;
  _placementOffset = refs.placementOffset || new THREE.Vector3();
  _purifierGroup = refs.purifierGroup || null;
  _markShadowsDirty = refs.markShadowsDirty || (() => {});
  _showToast = refs.showToast || (() => {});
  _roomRefs = refs.roomRefs || {};
  _purifierRefs = refs.purifierRefs || null;

  // Build static collision boxes from room refs
  _buildStaticBoxes();

  // Build interactive object list for crosshair raycasting (once).
  // Keep this in sync with getInteractiveTarget() in purifier.js — any flag
  // that makes a mesh clickable must be listed here or the blue FP-mode
  // crosshair (aka game-mode cursor) won't grow/turn blue over it.
  _interactiveObjects = [];
  _scene.traverse(obj => {
    if (obj._isLamp || obj._isCeilLight || obj._isFan || obj._isFilterL || obj._isFilterR ||
        obj._isDrawer || obj._isBifoldLeaf || obj._isCornerDoorHandle || obj._isCornerDoor || obj._isWindow ||
        obj._isMacbook || obj._isTV || obj._isFoodBowl) {
      _interactiveObjects.push(obj);
    }
  });

  // Bind input
  _bindInputs();
  _syncAudioToggleUi();
}

function _setQuickControlsVisible(visible) {
  const next = !!visible;
  if (_quickControlsVisible === next) return;
  _quickControlsVisible = next;
  const dock = document.getElementById('fpQuickControls');
  if (dock) dock.classList.toggle('is-hidden', !next);
}

function _clearPointerLockRetry() {
  if (_pointerLockRetryTimer) {
    clearTimeout(_pointerLockRetryTimer);
    _pointerLockRetryTimer = null;
  }
}

function _isPointerLockCooldownError(err) {
  if (!err) return false;
  if (err.name === 'SecurityError') return true;
  const msg = String(err.message || err);
  return /pointer lock cannot be acquired immediately after the user has exited the lock/i.test(msg);
}

function _requestPointerLockWithRetry(retries = 2, delayMs = 0) {
  const attempt = () => {
    if (!_canvas || !fpMode || fpPaused || document.pointerLockElement) return;
    let req;
    try {
      req = _canvas.requestPointerLock();
    } catch (err) {
      if (_isPointerLockCooldownError(err) && retries > 0) {
        _clearPointerLockRetry();
        _pointerLockRetryTimer = setTimeout(() => {
          _pointerLockRetryTimer = null;
          _requestPointerLockWithRetry(retries - 1, 0);
        }, 260);
      }
      return;
    }

    // Safari/modern browsers may return a Promise; always handle rejection.
    if (req && typeof req.then === 'function') {
      req.catch(err => {
        if (_isPointerLockCooldownError(err) && retries > 0) {
          _clearPointerLockRetry();
          _pointerLockRetryTimer = setTimeout(() => {
            _pointerLockRetryTimer = null;
            _requestPointerLockWithRetry(retries - 1, 0);
          }, 260);
        }
      });
    }
  };

  if (delayMs > 0) {
    _clearPointerLockRetry();
    _pointerLockRetryTimer = setTimeout(() => {
      _pointerLockRetryTimer = null;
      attempt();
    }, delayMs);
    return;
  }

  attempt();
}

// ── Static collision boxes ──────────────────────────────────────────
// Simplified set — just the major furniture. Full monolith had ~40 AABBs.

function _buildStaticBoxes() {
  const fy = getFloorY();
  _staticBoxes = [];

  // Bed — sleeping surface is mattress + duvet top
  // mattY = floorY + bedSlatsFromFloor + 1 + mattH/2 = fy + 10 + 1 + 5 = fy + 16
  // bed top = mattY + mattH/2 + duvetH = fy + 16 + 5 + 1.5 = fy + 22.5
  const bedTop = fy + BED_SLATS_FROM_FLOOR + 1 + 10 + 1.5; // slatY + 1 + mattH + duvetH
  _staticBoxes.push({
    xMin: -(BED_X + BED_W / 2), xMax: -(BED_X - BED_W / 2),
    zMin: BED_Z - BED_L / 2, zMax: BED_Z + BED_L / 2,
    yTop: bedTop, yBottom: fy + BED_CLEARANCE, room: true
  });

  // Bed legs — corner posts from floor up to slat platform.
  const bedLegR = 1.2;
  const bedLegH = BED_SLATS_FROM_FLOOR;
  for (const [lx, lz] of [
    [BED_X - BED_W / 2 + 3, BED_Z - BED_L / 2 + 3],
    [BED_X + BED_W / 2 - 3, BED_Z - BED_L / 2 + 3],
    [BED_X - BED_W / 2 + 3, BED_Z + BED_L / 2 - 3],
    [BED_X + BED_W / 2 - 3, BED_Z + BED_L / 2 - 3],
  ]) {
    const wx = -lx; // room meshes are mirrored on X in createRoom()
    _staticBoxes.push({
      xMin: wx - bedLegR,
      xMax: wx + bedLegR,
      zMin: lz - bedLegR,
      zMax: lz + bedLegR,
      yTop: fy + bedLegH,
      yBottom: fy,
      room: true
    });
  }

  // Nightstand — top slab (drawer holes below are walk-through when open)
  _staticBoxes.push({
    xMin: -(TBL_X + TBL_W / 2), xMax: -(TBL_X - TBL_W / 2),
    zMin: TBL_Z - TBL_D / 2, zMax: TBL_Z + TBL_D / 2,
    yTop: fy + TBL_H, yBottom: fy + 25, room: true
  });
  // Nightstand side pillars
  _staticBoxes.push({
    xMin: -(TBL_X + TBL_W / 2), xMax: -(TBL_X + TBL_W / 2 - 0.6),
    zMin: TBL_Z - TBL_D / 2, zMax: TBL_Z + TBL_D / 2,
    yTop: fy + TBL_H, room: true
  });
  _staticBoxes.push({
    xMin: -(TBL_X - TBL_W / 2 + 0.6), xMax: -(TBL_X - TBL_W / 2),
    zMin: TBL_Z - TBL_D / 2, zMax: TBL_Z + TBL_D / 2,
    yTop: fy + TBL_H, room: true
  });

  // Objects on nightstand (all X-mirrored)
  const lampX = TBL_X + TBL_W / 2 - 6, lampZ = TBL_Z + TBL_D / 2 - 6;
  // Coffee mug (cylinder r=1.4, h=3.5)
  _staticBoxes.push({
    xMin: -(TBL_X - 3 + 1.4), xMax: -(TBL_X - 3 - 1.4),
    zMin: TBL_Z - 5 - 1.4, zMax: TBL_Z - 5 + 1.4,
    yTop: fy + TBL_H + 3.5, yBottom: fy + TBL_H, room: true
  });
  // Air quality monitor (wedge 3.5x4x2.8)
  _staticBoxes.push({
    xMin: -(TBL_X - 8 + 3.5 / 2), xMax: -(TBL_X - 8 - 3.5 / 2),
    zMin: TBL_Z + 2 - 2.8 / 2, zMax: TBL_Z + 2 + 2.8 / 2,
    yTop: fy + TBL_H + 4.0, yBottom: fy + TBL_H, room: true
  });
  // Book stack (5x2x7)
  _staticBoxes.push({
    xMin: -(TBL_X - 1 + 5 / 2), xMax: -(TBL_X - 1 - 5 / 2),
    zMin: TBL_Z + 2 - 7 / 2, zMax: TBL_Z + 2 + 7 / 2,
    yTop: fy + TBL_H + 2.0, yBottom: fy + TBL_H, room: true
  });
  // Lamp base (cylinder r≈4, h=0.8)
  _staticBoxes.push({
    xMin: -(lampX + 4), xMax: -(lampX - 4),
    zMin: lampZ - 4, zMax: lampZ + 4,
    yTop: fy + TBL_H + 0.8, yBottom: fy + TBL_H, room: true
  });
  // Lamp shade walls (4 slabs around the shade so interior stays open)
  {
    const shadeR = 6.5, shadeThick = 1.1;
    const shadeBot = fy + TBL_H + 16.8, shadeTop = fy + TBL_H + 26.8;
    _staticBoxes.push(
      { xMin: -(lampX + shadeR), xMax: -(lampX + shadeR - shadeThick), zMin: lampZ - shadeR, zMax: lampZ + shadeR, yTop: shadeTop, yBottom: shadeBot, room: true },
      { xMin: -(lampX - shadeR + shadeThick), xMax: -(lampX - shadeR), zMin: lampZ - shadeR, zMax: lampZ + shadeR, yTop: shadeTop, yBottom: shadeBot, room: true },
      { xMin: -(lampX + shadeR - shadeThick), xMax: -(lampX - shadeR + shadeThick), zMin: lampZ - shadeR, zMax: lampZ - shadeR + shadeThick, yTop: shadeTop, yBottom: shadeBot, room: true },
      { xMin: -(lampX + shadeR - shadeThick), xMax: -(lampX - shadeR + shadeThick), zMin: lampZ + shadeR - shadeThick, zMax: lampZ + shadeR, yTop: shadeTop, yBottom: shadeBot, room: true }
    );
    // Bulb collision pad inside shade (so player can land and grab coin)
    _staticBoxes.push({
      xMin: -(lampX + 2.4), xMax: -(lampX - 2.4),
      zMin: lampZ - 2.4, zMax: lampZ + 2.4,
      yTop: fy + TBL_H + 20.8, yBottom: fy + TBL_H + 18.6, room: true
    });
  }

  // Right wall solid portions (flanking closet opening)
  _staticBoxes.push(
    { xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: OPP_WALL_Z, zMax: CLOSET_Z - CLOSET_W / 2, yTop: fy + WALL_HEIGHT, room: true },
    { xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: CLOSET_Z + CLOSET_W / 2, zMax: 49, yTop: fy + WALL_HEIGHT, room: true }
  );

  // ── Closet collision (exact match to monolith _fpBoxesBase) ──

  const cZ = CLOSET_Z;        // -50
  const cW = CLOSET_W;        // 48
  const cD = CLOSET_DEPTH;    // 36
  const cIW = CLOSET_INTERIOR_W; // 78
  const cH = 66;              // CLOSET_H (opening height)
  const cIH = WALL_HEIGHT;    // 80 (interior height = wall height)

  // Closet back wall
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + cD + 0.25), xMax: -(SIDE_WALL_X + cD - 0.25),
    zMin: cZ - cIW / 2, zMax: cZ + cIW / 2,
    yTop: fy + cIH, room: true
  });
  // Closet +Z side wall
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + cD), xMax: -(SIDE_WALL_X + 0.5),
    zMin: cZ + cIW / 2 - 0.25, zMax: cZ + cIW / 2 + 0.25,
    yTop: fy + cIH, room: true
  });
  // Closet -Z side wall
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + cD), xMax: -(SIDE_WALL_X + 0.5),
    zMin: cZ - cIW / 2 - 0.25, zMax: cZ - cIW / 2 + 0.25,
    yTop: fy + cIH, room: true
  });
  // Wings between opening edges and wider interior side walls
  // +Z wing
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X,
    zMin: cZ + cW / 2, zMax: cZ + cIW / 2,
    yTop: fy + cIH, room: true
  });
  // -Z wing
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X,
    zMin: cZ - cIW / 2, zMax: cZ - cW / 2,
    yTop: fy + cIH, room: true
  });
  // Closet door header trim
  _staticBoxes.push({
    xMin: -SIDE_WALL_X, xMax: -(SIDE_WALL_X - 1),
    zMin: cZ - cW / 2 - 2.5, zMax: cZ + cW / 2 + 2.5,
    yTop: fy + cH + 4, yBottom: fy + cH, room: true
  });
  // Solid wall above closet door opening
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X,
    zMin: cZ - cW / 2, zMax: cZ + cW / 2,
    yTop: fy + WALL_HEIGHT, yBottom: fy + cH, room: true
  });
  // Closet shelf
  {
    const shelfCx = SIDE_WALL_X + cD - 0.5 - 0.1 - 7; // 79.4
    const shelfLen = cIW - 1;
    const shelfZMin = cZ - shelfLen / 2;
    _staticBoxes.push({
      xMin: -(shelfCx + 7), xMax: -(shelfCx - 7),
      zMin: cZ - shelfLen / 2, zMax: cZ + shelfLen / 2,
      yTop: fy + cIH - 24 + 0.4, yBottom: fy + cIH - 24 - 0.4, room: true
    });
    // Three vertical dividers splitting the shelf into 4 sections.
    // Match the geometry in room.js: divThick=0.6, full height from
    // just above the shelf top to just below the closet ceiling, and
    // X-extent equal to the shelf depth.
    const divThick = 0.6;
    const divBotY = fy + cIH - 24 + 0.4;
    const divTopY = fy + cIH - 0.5;
    for (let i = 1; i <= 3; i++) {
      const zC = shelfZMin + (shelfLen * i / 4);
      _staticBoxes.push({
        xMin: -(shelfCx + 7), xMax: -(shelfCx - 7),
        zMin: zC - divThick / 2, zMax: zC + divThick / 2,
        yTop: divTopY, yBottom: divBotY, room: true
      });
    }
  }
  // Clothes rod
  {
    const rodCx = (SIDE_WALL_X + 0.5) + (cD - 0.5) / 2; // 69.25
    _staticBoxes.push({
      xMin: -(rodCx + 0.4), xMax: -(rodCx - 0.4),
      zMin: cZ - (cIW - 2) / 2, zMax: cZ + (cIW - 2) / 2,
      yTop: fy + cIH - 30 + 0.4, yBottom: fy + cIH - 30 - 0.4, room: true
    });
  }

  // Opposite wall (TV wall)
  _staticBoxes.push({
    xMin: -SIDE_WALL_X, xMax: -LEFT_WALL_X,
    zMin: OPP_WALL_Z - 0.25, zMax: OPP_WALL_Z + 0.25,
    yTop: fy + WALL_HEIGHT, room: true
  });

  // TV (wall-mounted, walkable under)
  const tvCenterX = BED_X;
  const tvCenterY = fy + 46;
  const tvW = 56.7, tvH = 31.9, tvD = 1.0, bezel = 0.3;
  const tvZ = OPP_WALL_Z + 0.5 + tvD / 2 + 1.1;
  _staticBoxes.push({
    xMin: -(tvCenterX + (tvW + bezel * 2) / 2), xMax: -(tvCenterX - (tvW + bezel * 2) / 2),
    zMin: OPP_WALL_Z, zMax: tvZ + tvD / 2 + 1,
    yTop: tvCenterY + tvH / 2 + bezel, yBottom: tvCenterY - tvH / 2 - bezel, room: true
  });

  // Mini split (wall-mounted, walkable under)
  const msW = 32, msH = 11, msD = 8;
  const msX = SIDE_WALL_X - 18 - msW / 2;
  const msY = fy + WALL_HEIGHT - 12 - msH / 2;
  const msZ = OPP_WALL_Z + 0.5 + msD / 2;
  _staticBoxes.push({
    xMin: -(msX + msW / 2), xMax: -(msX - msW / 2),
    zMin: OPP_WALL_Z, zMax: msZ + msD / 2 + 1,
    yTop: msY + msH / 2, yBottom: msY - msH / 2, room: true
  });

  // Cat feeder + shoe box + water bowl (TV wall / closet corner)
  // Pre-mirror: boxCenterX=28, feederZ=-74, boxW=24, boxH=5, boxD=16
  // Feeder at boxCenterX+6=34, bowl at boxCenterX-6=22
  {
    const bCX = 28, fZ = -74;
    const bxW = 24, bxH = 5, bxD = 16;
    // Shoe box
    _staticBoxes.push({
      xMin: -(bCX + bxW/2), xMax: -(bCX - bxW/2),
      zMin: fZ - bxD/2, zMax: fZ + bxD/2,
      yTop: fy + bxH, yBottom: fy, room: true
    });
    // Feeder body + hopper (cylinder simplified as AABB)
    const fX = bCX + 6; // feeder offset toward closet
    const bodyR = 4.2, bodyH = 8, hopperH = 6;
    _staticBoxes.push({
      xMin: -(fX + bodyR), xMax: -(fX - bodyR),
      zMin: fZ - bodyR, zMax: fZ + bodyR,
      yTop: fy + bxH + bodyH + hopperH + 1.3, yBottom: fy + bxH, room: true
    });
    // Food tray (rounded bowl, AABB approximation)
    const trayR = 3.5, trayH = 1.8;
    const trayZ = fZ + bodyR + trayR - 0.5;
    _staticBoxes.push({
      xMin: -(fX + trayR), xMax: -(fX - trayR),
      zMin: trayZ - trayR, zMax: trayZ + trayR,
      yTop: fy + bxH + trayH, yBottom: fy + bxH, room: true
    });
    // Water bowl (right / window side)
    const bowlX = bCX - 6;
    const bowlR = 3.6, bowlH = 1.2; // slightly larger AABB for lip
    _staticBoxes.push({
      xMin: -(bowlX + bowlR), xMax: -(bowlX - bowlR),
      zMin: fZ - bowlR, zMax: fZ + bowlR,
      yTop: fy + bxH + bowlH + 0.2, yBottom: fy + bxH, room: true
    });
  }

  // Headboard — full height from bed clearance to top of headboard
  // Monolith: hbW=bedW, hbThick=3, hbH=bedH-bedClearance=35.5
  const hbW = BED_W, hbThick = 3, hbH = BED_H - BED_CLEARANCE;
  _staticBoxes.push({
    xMin: -(BED_X + hbW / 2), xMax: -(BED_X - hbW / 2),
    zMin: BED_Z + BED_L / 2 - hbThick, zMax: BED_Z + BED_L / 2,
    yTop: fy + BED_CLEARANCE + hbH, room: true
  });

  // Pillows — visual pillowW=22 but collision trimmed to 18 so the cat fits between them
  const pillowW = 18, pillowD = 14, pillowH = 4;
  const slatY = fy + BED_SLATS_FROM_FLOOR; // = fy + 10
  const mattH = 10;
  const mattY = slatY + 1 + mattH / 2; // = fy + 16
  const pillowY = mattY + mattH / 2 - 0.8; // = fy + 20.2
  const pillowBaseZ = BED_Z + BED_L / 2 - hbThick - pillowD / 2 - 2;
  _staticBoxes.push({
    xMin: -(BED_X - 13 + pillowW / 2), xMax: -(BED_X - 13 - pillowW / 2),
    zMin: pillowBaseZ - pillowD / 2, zMax: pillowBaseZ + pillowD / 2,
    yTop: pillowY + pillowH + 1.5, yBottom: fy + BED_CLEARANCE, room: true
  });
  _staticBoxes.push({
    xMin: -(BED_X + 13 + pillowW / 2), xMax: -(BED_X + 13 - pillowW / 2),
    zMin: pillowBaseZ - pillowD / 2, zMax: pillowBaseZ + pillowD / 2,
    yTop: pillowY + pillowH + 1.5, yBottom: fy + BED_CLEARANCE, room: true
  });

  // Corner-door recess structure (door by the nightstand).
  // Extrusion front face at Z=29 (pre-mirror; recessDepth=20) has door hole
  // X=15..47; solid flanks X=11..15 and X=47..51. After X-mirror these
  // become world X -15..-11 and -51..-47. Header solid above Y=doorH=68.
  // Recess side wall (returnWallL) at pre-mirror X=11 spans Z=28.75..49.
  _staticBoxes.push(
    // Recess return wall (X=-11, Z=28.75..49)
    { xMin: -11.25, xMax: -10.75, zMin: 28.75, zMax: 49, yTop: fy + WALL_HEIGHT, room: true },
    // Front face left of doorway (world X=-15..-11, Z=28.75..29.25)
    { xMin: -15, xMax: -11, zMin: 28.75, zMax: 29.25, yTop: fy + WALL_HEIGHT, room: true },
    // Front face right of doorway (world X=-51..-47, Z=28.75..29.25)
    { xMin: -51, xMax: -47, zMin: 28.75, zMax: 29.25, yTop: fy + WALL_HEIGHT, room: true },
    // Header above door on extrusion front (Y=68..ceiling)
    { xMin: -47, xMax: -15, zMin: 28.75, zMax: 29.25,
      yBottom: fy + 68, yTop: fy + WALL_HEIGHT, room: true }
  );

  // ── Back wall solid flanks at Z=49 (around the 40" hallway opening) ──
  // Pre-mirror the back wall spans X=-81..51 with a full-height hole at
  // X=11..51 (flush with right/side wall). After mirror, solid flank at
  // world X=-11..81; the other side has zero width and is omitted.
  _staticBoxes.push(
    { xMin: -11, xMax: 81, zMin: 48.75, zMax: 49.25, yTop: fy + WALL_HEIGHT, room: true }
  );

  // ── Hallway walls (20 ft extension past the bedroom door) ──
  // Pre-mirror hallway X = 11..51, Z = 49..289. World X = -51..-11.
  const hzStart = 49, hzEnd = 289;
  _staticBoxes.push(
    // -X side wall of hallway (pre-mirror X=10.5..11)
    { xMin: -11, xMax: -10.5, zMin: hzStart, zMax: hzEnd, yTop: fy + WALL_HEIGHT, room: true },
    // +X side wall of hallway (pre-mirror X=51..51.5)
    { xMin: -51.5, xMax: -51, zMin: hzStart, zMax: hzEnd, yTop: fy + WALL_HEIGHT, room: true },
    // End wall at Z=_hallZEnd
    { xMin: -51.5, xMax: -10.5, zMin: hzEnd, zMax: hzEnd + 0.5, yTop: fy + WALL_HEIGHT, room: true }
  );

  // ── Guest room walls (behind the hallway's +X door) ──
  // Pre-mirror footprint X=51..183, Z=-13..130. -Z wall sits just past the
  // closet's +Z exterior face (closet occupies Z=-78..-14) so it doesn't
  // clip through the closet body. Shared -X wall is the existing
  // bedroom/hallway right wall (already in _staticBoxes via the
  // sideWall + hallWallR blocks); we only collide the three new walls here.
  // World X = -183..-51 after mirror.
  {
    const gXmin = 51, gXmax = 183, gZmin = -13, gZmax = 130;
    _staticBoxes.push(
      // Far wall (pre-mirror X=183..183.5)
      { xMin: -gXmax - 0.5, xMax: -gXmax, zMin: gZmin - 0.5, zMax: gZmax + 0.5, yTop: fy + WALL_HEIGHT, room: true },
      // -Z wall (pre-mirror Z=-30.5..-30) spans full interior X range.
      { xMin: -gXmax, xMax: -gXmin, zMin: gZmin - 0.5, zMax: gZmin, yTop: fy + WALL_HEIGHT, room: true },
      // +Z wall (pre-mirror Z=130..130.5) spans full interior X range.
      { xMin: -gXmax, xMax: -gXmin, zMin: gZmax, zMax: gZmax + 0.5, yTop: fy + WALL_HEIGHT, room: true }
    );
  }
}

// ── Get collision boxes (per-frame) ─────────────────────────────────

function _buildPurifierBoxes() {
  const boxes = [];
  const px = _placementOffset ? _placementOffset.x : 0;
  const py = _placementOffset ? _placementOffset.y : 0;
  const pz = _placementOffset ? _placementOffset.z : 0;
  const { W, H, D, ply, ft, bunFootH } = state;
  const panelW = W + 2 * ft;
  const hwOuter = panelW / 2;
  const hdOuter = D / 2 + ply;
  const yTopPanel = py + H / 2 + ply;
  const yBotPanel = py - H / 2 - ply;
  const rotated = _purifierGroup ? Math.abs(_purifierGroup.rotation.y) > 0.1 : false;
  const filtersOn = _purifierRefs && _purifierRefs.isFilterOn ? _purifierRefs.isFilterOn() : true;
  const filtersSlid = _purifierRefs && _purifierRefs.areFiltersSlid ? _purifierRefs.areFiltersSlid() : { left: false, right: false };
  const leftOpen = !filtersOn || filtersSlid.right;
  const rightOpen = !filtersOn || filtersSlid.left;
  const localBoxes = [
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: -hdOuter, lzMax: hdOuter, yTop: yTopPanel, yBottom: yTopPanel - ply },
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: -hdOuter, lzMax: hdOuter, yTop: yBotPanel + ply, yBottom: yBotPanel },
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: -hdOuter, lzMax: -D / 2, yTop: yTopPanel, yBottom: yBotPanel },
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: D / 2, lzMax: hdOuter, yTop: yTopPanel, yBottom: yBotPanel },
  ];
  if (!leftOpen) {
    localBoxes.push({ lxMin: -hwOuter, lxMax: -hwOuter + ft, lzMin: -D / 2, lzMax: D / 2, yTop: yTopPanel, yBottom: yBotPanel });
  }
  if (!rightOpen) {
    localBoxes.push({ lxMin: hwOuter - ft, lxMax: hwOuter, lzMin: -D / 2, lzMax: D / 2, yTop: yTopPanel, yBottom: yBotPanel });
  }
  for (const lb of localBoxes) {
    const b = {};
    if (rotated) {
      b.xMin = px - lb.lzMax; b.xMax = px - lb.lzMin;
      b.zMin = pz + lb.lxMin; b.zMax = pz + lb.lxMax;
    } else {
      b.xMin = px + lb.lxMin; b.xMax = px + lb.lxMax;
      b.zMin = pz + lb.lzMin; b.zMax = pz + lb.lzMax;
    }
    b.yTop = lb.yTop; b.yBottom = lb.yBottom;
    boxes.push(b);
  }
  // Console props collision
  if (_purifierRefs && _purifierRefs.getConsoleCollisionBoxes) {
    const consoleBoxes = _purifierRefs.getConsoleCollisionBoxes();
    if (Array.isArray(consoleBoxes)) {
      for (const src of consoleBoxes) {
        if (src) boxes.push({ xMin: src.xMin, xMax: src.xMax, zMin: src.zMin, zMax: src.zMax, yTop: src.yTop, yBottom: src.yBottom });
      }
    }
  }
  // Purifier feet/legs collision
  const purifierLegGroup = _purifierRefs && _purifierRefs.parts && _purifierRefs.parts.legs;
  if (purifierLegGroup && Array.isArray(purifierLegGroup.children)) {
    for (const legMesh of purifierLegGroup.children) {
      if (!legMesh || !legMesh.isMesh) continue;
      if (!_isObjectVisibleInWorld(legMesh)) continue;
      legMesh.updateWorldMatrix(true, true);
      _dynWorldBox.setFromObject(legMesh);
      if (_dynWorldBox.isEmpty()) continue;
      _dynMin.copy(_dynWorldBox.min);
      _dynMax.copy(_dynWorldBox.max);
      boxes.push({ xMin: _dynMin.x - 0.04, xMax: _dynMax.x + 0.04, zMin: _dynMin.z - 0.04, zMax: _dynMax.z + 0.04, yTop: _dynMax.y, yBottom: _dynMin.y });
    }
  }
  return boxes;
}

function _getBoxes() {
  resetBoxPool();
  const result = _staticBoxes.slice();

  // Purifier collision (cached — only rebuilt on placement/config change
  // or when filter on/slide state changes, so removed filters don't leave
  // invisible walls blocking the player from reaching the coin inside).
  if (_purifierRefs) {
    const fOn = _purifierRefs.isFilterOn ? _purifierRefs.isFilterOn() : true;
    const fSlid = _purifierRefs.areFiltersSlid ? _purifierRefs.areFiltersSlid() : { left: false, right: false };
    const sig = (fOn ? 1 : 0) | (fSlid.left ? 2 : 0) | (fSlid.right ? 4 : 0);
    if (sig !== _purifierFilterSig) {
      _purifierFilterSig = sig;
      _purifierBoxesDirtyFlag = true;
    }
  }
  if (_purifierBoxesDirtyFlag) {
    _purifierBoxesDirtyFlag = false;
    _purifierBoxesCache = _buildPurifierBoxes();
  }
  if (_purifierBoxesCache) {
    for (let i = 0; i < _purifierBoxesCache.length; i++) result.push(_purifierBoxesCache[i]);
  }

  // Closet bifold doors — dynamic collision based on door state
  // Each leaf has 2 panels (outer + inner) that fold into a V when open.
  // When closed, panels form a flat wall blocking the opening.
  // When open, the folded panels sit against the jambs and the opening is clear.
  if (window._bifoldLeavesRef) {
    const fy = getFloorY();
    const cH = 66;           // closet door height
    const panelW = 12;       // each panel is closetW/4 = 12"
    const panelThick = 1.2;

    for (const leaf of window._bifoldLeavesRef) {
      const angle = leaf._leafAngle || 0;
      // Leaf pivot world position (already mirrored)
      const px = leaf.position.x; // world X (post-mirror, set by mirror pass)
      const pz = leaf.position.z; // world Z
      // leafSide: -1 means -Z jamb, +1 means +Z jamb
      const ls = leaf._leafSide;
      // sign used for rotation direction (matches purifier.js animation)
      const sign = ls < 0 ? 1 : -1;
      const theta = sign * angle; // actual rotation.y

      if (angle < 0.05) {
        // Doors effectively closed — single flat wall from this leaf's two panels
        // Outer panel: from pivot to panelW along -leafSide*Z
        // Inner panel: from panelW to 2*panelW along -leafSide*Z
        const z0 = pz;
        const z1 = pz - ls * panelW * 2; // far end of both panels
        result.push({
          xMin: px - panelThick / 2 - 0.3, xMax: px + panelThick / 2 + 0.3,
          zMin: Math.min(z0, z1), zMax: Math.max(z0, z1),
          yTop: fy + cH, yBottom: fy, room: true
        });
      } else {
        // Doors open — compute world positions of outer and inner panels
        // Outer panel: center at angle θ from pivot, panelW/2 along rotated -leafSide*Z
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        // Outer panel center in local coords: (0, 0, -ls*panelW/2)
        // Rotated by theta around Y: x' = -ls*panelW/2 * sin(theta), z' = -ls*panelW/2 * cos(theta)
        // But rotation is around Y axis, so local Z → world Z*cos - world X*sin... 
        // Actually the pivot rotation.y = theta means:
        //   local_x → world_x*cos(theta) + world_z*sin(theta)  [relative to pivot]
        //   local_z → -world_x*sin(theta) + world_z*cos(theta)
        // The outer panel local pos is (0, 0, -ls*panelW/2)
        const outerLocalZ = -ls * panelW / 2;
        const outerWX = px + outerLocalZ * sinT;  // local z contributes to world x
        const outerWZ = pz + outerLocalZ * cosT;  // local z contributes to world z
        // Outer panel extents (rotated rectangle approximated as AABB)
        const outerHalfW = panelW / 2;
        const outerExtX = Math.abs(outerHalfW * sinT) + panelThick / 2;
        const outerExtZ = Math.abs(outerHalfW * cosT) + panelThick / 2;
        result.push({
          xMin: outerWX - outerExtX, xMax: outerWX + outerExtX,
          zMin: outerWZ - outerExtZ, zMax: outerWZ + outerExtZ,
          yTop: fy + cH, yBottom: fy, room: true
        });

        // Inner panel: hinged at the mid-joint (panelW along -ls*Z from pivot, rotated)
        // Mid-joint world position:
        const midLocalZ = -ls * panelW;
        const midWX = px + midLocalZ * sinT;
        const midWZ = pz + midLocalZ * cosT;
        // Inner group rotation.y = -2*sign*angle = -2*theta
        const innerTheta = theta - 2 * theta; // = -theta (inner folds back)
        const innerCosT = Math.cos(innerTheta);
        const innerSinT = Math.sin(innerTheta);
        // Inner panel local pos relative to mid-joint: (0, 0, -ls*panelW/2)
        const innerLocalZ = -ls * panelW / 2;
        const innerWX = midWX + innerLocalZ * innerSinT;
        const innerWZ = midWZ + innerLocalZ * innerCosT;
        const innerExtX = Math.abs(outerHalfW * innerSinT) + panelThick / 2;
        const innerExtZ = Math.abs(outerHalfW * innerCosT) + panelThick / 2;
        result.push({
          xMin: innerWX - innerExtX, xMax: innerWX + innerExtX,
          zMin: innerWZ - innerExtZ, zMax: innerWZ + innerExtZ,
          yTop: fy + cH, yBottom: fy, room: true
        });
      }
    }
  }

  // Corner door (by nightstand) — dynamic collision from animated panel.
  if (_roomRefs && _roomRefs.getCornerDoorPanelMesh) {
    const doorPanel = _roomRefs.getCornerDoorPanelMesh();
    if (doorPanel && doorPanel.parent) {
      doorPanel.updateMatrixWorld(true);
      doorPanel.getWorldPosition(_doorWP);
      doorPanel.getWorldQuaternion(_doorWQ);
      _doorEuler.setFromQuaternion(_doorWQ, 'YXZ');
      // Matches room.js dimensions: doorW-1 by doorH-0.5 by doorThick
      const doorAngle = -_doorEuler.y;
      // Door height (68") — matches room.js bedroom doorH.
      const doorHeight = 68 - 0.5;
      result.push({
        cx: _doorWP.x,
        cz: _doorWP.z,
        hw: (32 - 1) / 2,
        hd: 1.5 / 2 + 0.12,
        angle: doorAngle,
        cosA: Math.cos(-doorAngle), sinA: Math.sin(-doorAngle),
        cosB: Math.cos(doorAngle), sinB: Math.sin(doorAngle),
        yTop: _doorWP.y + doorHeight / 2,
        yBottom: _doorWP.y - doorHeight / 2,
        obb: true,
        room: true
      });
    }
  }

  // Guest door (bedroom right wall, past extrusion) — dynamic OBB collision.
  if (_roomRefs && _roomRefs.getGuestDoorPanelMesh) {
    const gPanel = _roomRefs.getGuestDoorPanelMesh();
    if (gPanel && gPanel.parent) {
      gPanel.updateMatrixWorld(true);
      gPanel.getWorldPosition(_doorWP);
      gPanel.getWorldQuaternion(_doorWQ);
      _doorEuler.setFromQuaternion(_doorWQ, 'YXZ');
      const gAngle = -_doorEuler.y;
      const gHeight = 68 - 0.5;
      result.push({
        cx: _doorWP.x,
        cz: _doorWP.z,
        hw: (32 - 1) / 2,
        hd: 1.4 / 2 + 0.12,
        angle: gAngle,
        cosA: Math.cos(-gAngle), sinA: Math.sin(-gAngle),
        cosB: Math.cos(gAngle), sinB: Math.sin(gAngle),
        yTop: _doorWP.y + gHeight / 2,
        yBottom: _doorWP.y - gHeight / 2,
        obb: true,
        room: true
      });
    }
  }

  // MacBook open lid — thin wall matching the screen overlay mesh exactly
  if (_roomRefs && _roomRefs.getMacbookScreenMesh) {
    const scrMesh = _roomRefs.getMacbookScreenMesh();
    if (scrMesh && scrMesh.parent) {
      scrMesh.parent.updateMatrixWorld(true);
      scrMesh.getWorldPosition(_macWP);
      const parentRotY = scrMesh.parent.rotation.y;
      const screenRotY = scrMesh.rotation.y;
      const worldRotY = parentRotY + screenRotY;
      // Cache screen bounding box dimensions (geometry never changes)
      if (!_macScreenBBCached) {
        _macBB.setFromBufferAttribute(scrMesh.geometry.attributes.position);
        _macBB.getSize(_macSz);
        _macScreenHW = _macSz.x / 2;
        _macScreenHH = _macSz.y / 2;
        _macScreenBBCached = true;
      }
      const macAngle = -worldRotY;
      result.push({
        cx: _macWP.x, cz: _macWP.z,
        hw: _macScreenHW, hd: 0.3,
        angle: macAngle,
        cosA: Math.cos(-macAngle), sinA: Math.sin(-macAngle),
        cosB: Math.cos(macAngle), sinB: Math.sin(macAngle),
        yTop: _macWP.y + _macScreenHH, yBottom: _macWP.y - _macScreenHH,
        obb: true
      });
    }
  }

  // Nightstand drawer fronts — dynamic collision (tracks slide position)
  if (_roomRefs && _roomRefs.drawers) {
    for (const drw of _roomRefs.drawers) {
      if (!drw || !drw._drawerW) continue;
      const wx = drw.position.x;
      const wy = drw.position.y;
      const wz = drw.position.z;
      const hw = drw._drawerW / 2;
      const hh = drw._drawerH / 2;
      const trayD = drw._drawerTrayD || 10;
      const trayWall = drw._drawerTrayWall || 0.5;
      // Front face — always solid
      result.push({
        xMin: wx - hw, xMax: wx + hw,
        zMin: wz - 0.5, zMax: wz + 0.5,
        yTop: wy + hh, yBottom: wy - hh
      });
      if (drw._drawerOpen) {
        // Open drawer: add tray side walls + back wall + floor
        // Left wall
        result.push({
          xMin: wx - hw, xMax: wx - hw + trayWall,
          zMin: wz, zMax: wz + trayD + 1,
          yTop: wy + hh, yBottom: wy - hh
        });
        // Right wall
        result.push({
          xMin: wx + hw - trayWall, xMax: wx + hw,
          zMin: wz, zMax: wz + trayD + 1,
          yTop: wy + hh, yBottom: wy - hh
        });
        // Back wall
        result.push({
          xMin: wx - hw, xMax: wx + hw,
          zMin: wz + trayD, zMax: wz + trayD + 1,
          yTop: wy + hh, yBottom: wy - hh
        });
        // Tray floor — standable
        result.push({
          xMin: wx - hw, xMax: wx + hw,
          zMin: wz, zMax: wz + trayD + 1,
          yTop: wy - hh + trayWall, yBottom: wy - hh
        });
      } else {
        // Closed: full body is solid
        result.push({
          xMin: wx - hw, xMax: wx + hw,
          zMin: wz - 1, zMax: wz + trayD + 1,
          yTop: wy + hh, yBottom: wy - hh
        });
      }
    }
  }

  // Door knobs — standardized buildDoorKnob() groups (corner door + hallway
  // doors). Give each one a small AABB around the ball so the player can
  // jump up and land on top of them. Ball center is at knob-local (0,0,1.5)
  // with radius ~1.0.
  if (_roomRefs && _roomRefs.doorKnobs) {
    for (const knob of _roomRefs.doorKnobs) {
      if (!knob || !knob.parent) continue;
      knob.updateMatrixWorld(true);
      _knobWP.set(0, 0, 1.5);
      knob.localToWorld(_knobWP);
      const r = 1.05;
      result.push({
        xMin: _knobWP.x - r, xMax: _knobWP.x + r,
        zMin: _knobWP.z - r, zMax: _knobWP.z + r,
        yTop: _knobWP.y + r, yBottom: _knobWP.y - r,
        room: true
      });
    }
  }

  return result;
}

// ── Toggle first person ─────────────────────────────────────────────

export function toggleFirstPerson() {
  fpMode = !fpMode;

  if (_fpHud) _fpHud.style.display = fpMode ? 'block' : 'none';
  const crosshair = document.getElementById('fpCrosshair');
  if (crosshair) crosshair.style.display = fpMode ? 'block' : 'none';

  if (fpMode) {
    // Reset help panel state on new run for a cleaner HUD start.
    _toggleHelp(false);
    _lastUiInteractTs = performance.now() - HUD_IDLE_CONTROLS_MS;
    _setQuickControlsVisible(true);
    _wasAimingAtInteractable = false;
    _wasGroundedLast = true;
    _lastFootstepTs = 0;
    _wasFootstepMoving = false;

    // Enter FP
    _savedFov = _camera.fov;
    _camera.fov = 75;
    _camera.updateProjectionMatrix();

    // Request pointer lock
    _fpIgnorePointerUnlock = true;
    setTimeout(() => { _fpIgnorePointerUnlock = false; }, 300);
    _requestPointerLockWithRetry(3, 0);

    // Disable orbit controls
    if (_controls) _controls.enabled = false;

    // Reset position
    _respawn();

    // Snap doors / drawers / filters / closet leaves back to their default
    // closed pose so the run starts from a canonical world state.
    _resetWorldState();

    // Reset coins + timer
    coins.fullReset();
    coins.setCoinsVisible(true);
    leaderboard.startTimer();
    void leaderboard.startSharedRun();

    // Show cat in third-person
    if (_catGroup) {
      _catGroup.visible = fpCamMode === 'third';
      if (_catGroup.parent !== _scene) _scene.add(_catGroup);
    }
    // Disable cat shadow casting — shadow map refreshes at ~8 Hz so the
    // cat's shadow visually trails behind during movement at high FPS.
    catAnimation.setCatShadows(false);

    if (_markShadowsDirty) _markShadowsDirty();
    document.body.classList.add('play-mode');
    _playModeCue(true);
    if (_showToast) _showToast('Game mode! WASD to move, Space to jump');
  } else {
    _toggleHelp(false);
    _setQuickControlsVisible(false);
    _wasAimingAtInteractable = false;
    _wasGroundedLast = true;
    _lastFootstepTs = 0;
    _wasFootstepMoving = false;

    // Exit FP
    _camera.fov = _savedFov;
    _camera.updateProjectionMatrix();

    if (_controls) _controls.enabled = true;

    // Clear input
    for (const k in fpKeys) fpKeys[k] = false;
    fpLookDX = 0;
    fpLookDY = 0;
    _velX = 0;
    _velZ = 0;
    _lastPhysicsTs = 0;

    // Exit pointer lock
    if (document.pointerLockElement) document.exitPointerLock();

    // Hide coins + cat, stop timer
    coins.setCoinsVisible(false);
    leaderboard.stopTimer();
    if (_catGroup) {
      _catGroup.visible = false;
      _catGroup.position.set(0, 0, 0);
      _catGroup.rotation.set(0, 0, 0);
    }

    // Restore orbit camera to look at purifier
    if (_controls && _placementOffset) {
      _controls.target.set(_placementOffset.x, _placementOffset.y + 8, _placementOffset.z);
      _camera.position.set(_placementOffset.x + 25, _placementOffset.y + 20, _placementOffset.z + 35);
      _controls.update();
    }

    if (_markShadowsDirty) _markShadowsDirty();
    // Restore cat shadow casting for orbit mode
    catAnimation.setCatShadows(true);
    document.body.classList.remove('play-mode');
    _playModeCue(false);
  }
}

function _respawn() {
  fpPos.set(PLAYER_SPAWN_X, getPlayerFloorY(), PLAYER_SPAWN_Z);
  fpYaw = 0;
  fpPitch = 0;
  fpVy = 0;
  _velX = 0;
  _velZ = 0;
  _bobPhase = 0;
  _spaceHeld = 0;
  _jumpHoldFrames = 0;
  _isJumping = false;
  _coyoteFrames = 0;
  _jumpBufferFrames = 0;
  _spaceWasDown = false;
  _lastPhysicsTs = 0;
  fpPaused = false;
}

// Reset all run-affecting world state (drawers, doors, purifier filters,
// closet bifold leaves) so each run starts from the same canonical pose.
function _resetWorldState() {
  if (_purifierRefs && typeof _purifierRefs.resetWorld === 'function') {
    _purifierRefs.resetWorld(_roomRefs);
  }
  if (_roomRefs) {
    if (typeof _roomRefs.toggleCornerDoor === 'function') _roomRefs.toggleCornerDoor(false);
    if (typeof _roomRefs.toggleGuestDoor  === 'function') _roomRefs.toggleGuestDoor(false);
  }
  // Filter / drawer collision boxes are cached; force a rebuild.
  _purifierBoxesDirtyFlag = true;
}

// In-place run reset: respawn, clear coins, restart timer. Stays in FP.
export function resetRun() { _resetRun(); }
function _resetRun() {
  _respawn();
  _resetWorldState();
  coins.fullReset();
  coins.setCoinsVisible(true);
  leaderboard.resetTimer();
  leaderboard.startTimer();
  void leaderboard.startSharedRun();
}

// ── Set paused ──────────────────────────────────────────────────────

let _pauseFocusTrap = null;
let _pauseSavedFocus = null;

// Release pause focus trap without unpausing (for exit flow)
export function releasePauseFocusTrap() {
  if (_pauseFocusTrap) { _pauseFocusTrap.release(); _pauseFocusTrap = null; }
  if (_pauseSavedFocus) { _pauseSavedFocus.restore(); _pauseSavedFocus = null; }
}

// Clear pause flag without triggering re-lock (for exit flow)
export function clearPauseState() {
  fpPaused = false;
}

export function setPaused(paused) {
  if (!fpMode) return;
  fpPaused = !!paused;
  _playPauseCue(fpPaused);

  const overlay = document.getElementById('fpPauseOverlay');
  const crosshair = document.getElementById('fpCrosshair');
  // Don't show pause overlay if finish dialog or name dialog is open
  const finishOpen = leaderboard.isFinishDialogOpen() || leaderboard.isNameDialogOpen();

  if (fpPaused) {
    // Clear held keys + look deltas
    for (const k in fpKeys) fpKeys[k] = false;
    fpLookDX = 0;
    fpLookDY = 0;
    _lastPhysicsTs = 0;

    // Show pause overlay (unless finish is showing)
    if (overlay && !finishOpen) {
      overlay.style.display = 'flex';
      leaderboard.renderLeaderboardPanel();
      // Focus trap
      _pauseSavedFocus = saveFocus();
      _pauseFocusTrap = trapFocus(overlay);
      const resumeBtn = overlay.querySelector('.pause-btn.primary');
      if (resumeBtn) resumeBtn.focus();
    }
    if (crosshair) crosshair.style.opacity = '0.25';

    _setQuickControlsVisible(true);
    _syncAudioToggleUi();
    _syncMouseSensUi();

    // Release pointer lock
    _clearPointerLockRetry();
    _fpIgnorePointerUnlock = true;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => { _fpIgnorePointerUnlock = false; }, 300);
  } else {
    // Hide overlays
    if (overlay) overlay.style.display = 'none';
    if (crosshair) crosshair.style.opacity = '';
    // Release focus trap
    if (_pauseFocusTrap) { _pauseFocusTrap.release(); _pauseFocusTrap = null; }
    if (_pauseSavedFocus) { _pauseSavedFocus.restore(); _pauseSavedFocus = null; }
    _lastUiInteractTs = performance.now();
    _setQuickControlsVisible(false);

    // Re-lock pointer (desktop only) — delay to avoid SecurityError
    if (_canvas && !state.isMobile) {
      _fpIgnorePointerUnlock = true;
      setTimeout(() => {
        _requestPointerLockWithRetry(4, 0);
        setTimeout(() => { _fpIgnorePointerUnlock = false; }, 300);
      }, 200);
    }
  }
}

// ── Help panel toggle ───────────────────────────────────────────────

let _helpOpen = false;
function _toggleHelp(open) {
  if (typeof open === 'boolean') _helpOpen = open;
  else _helpOpen = !_helpOpen;

  const panel = document.getElementById('fpControlsPanel');
  const hint = document.getElementById('fpControlsHint');
  const quickHelp = document.getElementById('fpQuickHelpBtn');
  if (panel) panel.style.display = _helpOpen ? 'block' : 'none';
  if (hint) hint.style.display = _helpOpen ? 'none' : '';
  if (quickHelp) quickHelp.classList.toggle('on', _helpOpen);
  if (_helpOpen) _setQuickControlsVisible(true);
}
// Expose for HTML onclick
window._toggleHelp = _toggleHelp;

// ── Set cam mode ────────────────────────────────────────────────────

export function setCamMode(mode) {
  fpCamMode = mode || (fpCamMode === 'first' ? 'third' : 'first');
  if (_catGroup) _catGroup.visible = fpMode && fpCamMode === 'third';
  const text = fpCamMode === 'first' ? 'First person' : 'Third person';
  const label = document.getElementById('fpQuickCamLabel');
  if (label) label.textContent = text;
  const pauseLabel = document.getElementById('fpPauseCamLabel');
  if (pauseLabel) pauseLabel.textContent = text;
}

export function getJumpHoldFrames() {
  // Cat-squash anim uses this to drive the ground-charge windup; mirror our
  // charge progress on a 0..60 scale so existing thresholds keep working.
  return _spaceHeld * 2;
}

// ── Physics tick ────────────────────────────────────────────────────

export function updatePhysics(ts, dtSec, animFrameScale) {
  if (!fpMode || fpPaused) return;

  const fpDtMs = _lastPhysicsTs ? Math.min(80, Math.max(1, ts - _lastPhysicsTs)) : (1000 / 60);
  _lastPhysicsTs = ts;
  const frameScale = fpDtMs / (1000 / 60);

  // ── Look (smoothed) ────────────────────────────────────────────────
  const maxLookStep = 32;
  const stepX = Math.max(-maxLookStep, Math.min(maxLookStep, fpLookDX));
  const stepY = Math.max(-maxLookStep, Math.min(maxLookStep, fpLookDY));
  fpLookDX -= stepX;
  fpLookDY -= stepY;
  if (Math.abs(fpLookDX) > maxLookStep * 4) fpLookDX *= 0.5;
  if (Math.abs(fpLookDY) > maxLookStep * 4) fpLookDY *= 0.5;
  fpYaw -= stepX * 0.0022 * mouseSens;
  fpPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, fpPitch - stepY * 0.0022 * mouseSens));

  // ── Movement ──────────────────────────────────────────────────────
  // Speed mode triples top speed but uses a lower accel rate so you must
  // ramp up to it (heavier feel, longer slide on stop).
  const speedMul = speedMode ? 3.0 : 1.0;
  const spd = (fpKeys.shift ? 0.65 : 0.30) * speedMul;
  const fwd = _fwd.set(-Math.sin(fpYaw), 0, -Math.cos(fpYaw));
  const right = _right.set(fwd.z, 0, -fwd.x);

  let tgtX = 0, tgtZ = 0;
  if (fpKeys.w) { tgtX += fwd.x * spd; tgtZ += fwd.z * spd; }
  if (fpKeys.s) { tgtX -= fwd.x * spd; tgtZ -= fwd.z * spd; }
  if (fpKeys.a) { tgtX += right.x * spd; tgtZ += right.z * spd; }
  if (fpKeys.d) { tgtX -= right.x * spd; tgtZ -= right.z * spd; }

  const inputActive = fpKeys.w || fpKeys.a || fpKeys.s || fpKeys.d;
  // Slower accel = weightier start, slower decel = more slide/momentum.
  // Speed mode further reduces accel so the 3x top speed must be earned.
  const accelBase = speedMode
    ? (inputActive ? 0.045 : 0.035)
    : (inputActive ? 0.12 : 0.10);
  const accel = 1 - Math.pow(1 - accelBase, frameScale);
  _velX += (tgtX - _velX) * accel;
  _velZ += (tgtZ - _velZ) * accel;
  // Lower dead zone so momentum carries further before stopping
  if (!inputActive && Math.hypot(_velX, _velZ) < 0.002) { _velX = 0; _velZ = 0; }

  const isInteracting = inputActive
    || fpKeys.space
    || fpKeys.shift
    || Math.abs(stepX) > 0
    || Math.abs(stepY) > 0
    || _spaceHeld > 0;
  if (isInteracting) _lastUiInteractTs = ts;
  const showQuickControls = _helpOpen || (ts - _lastUiInteractTs >= HUD_IDLE_CONTROLS_MS);
  _setQuickControlsVisible(showQuickControls);

  const moveX = _velX * frameScale;
  const moveZ = _velZ * frameScale;

  // ── Jump (charged on ground, with coyote & buffer) ───────────────
  // Hold space while on the ground to charge; release to fire. Coyote frames
  // let you still jump for a moment after stepping off; the jump buffer
  // remembers a press right before landing so you don't lose presses.
  // Asymmetric gravity (snappier fall) is below in the gravity section.
  const JUMP_BASE_VY         = 0.55;  // power on a near-zero-charge release
  const JUMP_MAX_BONUS       = 1.25;  // extra power at full charge — enough to bonk the ceiling
  const JUMP_CHARGE_FRAMES   = 30;    // frames to reach full charge (~0.5s)
  const COYOTE_FRAMES        = 6;     // grace frames after walking off a ledge
  const JUMP_BUFFER_FRAMES   = 8;     // grace frames for a press just before landing
  const GRAVITY_RISE         = 0.018; // gravity while ascending
  const GRAVITY_FALL         = 0.028; // stronger gravity while falling — snappier feel

  // Grounded gate matches the old vy≈0 check; _wasGroundedLast is set at the
  // end of the previous frame and is the most reliable "on something" signal.
  const onGround = _wasGroundedLast && Math.abs(fpVy) < 0.01;

  // Coyote: full window while grounded, decays once we leave.
  if (onGround) _coyoteFrames = COYOTE_FRAMES;
  else _coyoteFrames = Math.max(0, _coyoteFrames - frameScale);

  // Edge-detect space press; refresh the buffer on the press only.
  const spacePressed = fpKeys.space && !_spaceWasDown;
  const releasedThisFrame = !fpKeys.space && _spaceWasDown;
  if (spacePressed) _jumpBufferFrames = JUMP_BUFFER_FRAMES;
  else _jumpBufferFrames = Math.max(0, _jumpBufferFrames - frameScale);

  // Snapshot charge BEFORE we mutate it below — release-fire reads this.
  const chargeAtFrameStart = _spaceHeld;

  // Charge while space is held AND we're on the ground (or in coyote window).
  // Off-ground holds don't accumulate (no air-charge cheese).
  if (fpKeys.space && (onGround || _coyoteFrames > 0)) {
    _spaceHeld = Math.min(JUMP_CHARGE_FRAMES, _spaceHeld + frameScale);
  } else if (!fpKeys.space) {
    _spaceHeld = 0;
  }

  // Fire on release while still groundable, OR if a buffered press lands while
  // we're standing still (you tapped just before landing — fires now).
  const canJump = _coyoteFrames > 0 && fpVy <= 0.01;
  let firedThisFrame = false;

  if (canJump && releasedThisFrame) {
    // Released — fire with whatever charge had built up (min = base jump).
    const chargeN = Math.min(1, chargeAtFrameStart / JUMP_CHARGE_FRAMES);
    fpVy = JUMP_BASE_VY + JUMP_MAX_BONUS * chargeN;
    _playJumpCue(chargeN);
    firedThisFrame = true;
  } else if (canJump && _jumpBufferFrames > 0 && !fpKeys.space) {
    // Buffered press from before landing — fire a base jump on touchdown.
    fpVy = JUMP_BASE_VY;
    _playJumpCue(0);
    firedThisFrame = true;
  }

  if (firedThisFrame) {
    _spaceHeld = 0;
    _jumpBufferFrames = 0;
    _coyoteFrames = 0;
    _isJumping = true;
  }
  if (fpVy <= 0) _isJumping = false;

  _spaceWasDown = fpKeys.space;

  // Charge bar UI: shows fill + tier visuals while holding on ground; drives
  // a glowing point light parented to the cat that ramps with charge tier.
  _cacheDom();
  _ensureChargeLight();
  const chargePct = (onGround && _spaceHeld > 0)
    ? Math.min(_spaceHeld / JUMP_CHARGE_FRAMES, 1)
    : 0;
  // Tier 0 = no charge, 1 = small (>0–33%), 2 = big (33–66%), 3 = MEGA (66–100%)
  let chargeTier = 0;
  if (chargePct > 0.66)      chargeTier = 3;
  else if (chargePct > 0.33) chargeTier = 2;
  else if (chargePct > 0)    chargeTier = 1;

  if (_cachedCbFill) {
    _cachedCbFill.style.width = `${Math.round(chargePct * 100)}%`;
  }
  if (_cachedCbBar) {
    _cachedCbBar.classList.toggle('charging', chargePct > 0);
    _cachedCbBar.classList.toggle('charged', chargePct >= 0.95);
    _cachedCbBar.classList.toggle('tier-1', chargeTier === 1);
    _cachedCbBar.classList.toggle('tier-2', chargeTier === 2);
    _cachedCbBar.classList.toggle('tier-3', chargeTier === 3);
  }
  if (_cachedCbLabel) {
    _cachedCbLabel.textContent =
      chargeTier === 3 ? 'MEGA JUMP!' :
      chargeTier === 2 ? 'Big jump' :
      chargeTier === 1 ? 'Small jump' :
      'Jump charge';
  }
  if (_cachedCbValue) {
    _cachedCbValue.textContent = onGround
      ? (chargePct > 0 ? `${Math.round(chargePct * 100)}%` : 'Ready')
      : 'Air';
  }

  // Cat charge glow — color blends cyan → teal → gold as tier rises.
  if (_chargeLight) {
    // Smoothed target intensity per tier (0, ~6, ~14, ~28). Scales with
    // chargePct within the tier so it ramps in instead of stepping.
    let targetI = 0;
    if (chargeTier === 1)      targetI = 4 + chargePct * 4;
    else if (chargeTier === 2) targetI = 10 + (chargePct - 0.33) * 12;
    else if (chargeTier === 3) targetI = 22 + (chargePct - 0.66) * 22;
    // Add a subtle MEGA flicker so it feels alive, not static.
    if (chargeTier === 3) targetI *= 0.85 + 0.15 * Math.sin(ts * 0.05);
    _chargeLightTarget = targetI;
    const lerpK = 1 - Math.exp(-Math.max(0, dtSec) * 18);
    _chargeLight.intensity += (_chargeLightTarget - _chargeLight.intensity) * lerpK;
    // Hue: cyan(0x88ddff) → teal(0x88ffe0) → gold(0xffc870)
    if (chargeTier === 3) _chargeLight.color.setHex(0xffc870);
    else if (chargeTier === 2) _chargeLight.color.setHex(0x88ffe0);
    else _chargeLight.color.setHex(0x88ddff);
  }

  // Super Saiyan aura at MEGA tier — ramps in across the top third of the
  // charge bar so it builds toward "fully charged" rather than popping in.
  {
    const ssStrength = chargeTier === 3
      ? Math.min(1, (chargePct - 0.66) / 0.34)
      : 0;
    _applySuperSaiyan(ssStrength, ts);
  }

  // ── Gravity (asymmetric: fall faster than rise) ───────────────────
  const g = fpVy > 0 ? GRAVITY_RISE : GRAVITY_FALL;
  fpVy -= g * frameScale;
  let newY = fpPos.y + fpVy * frameScale;

  // ── Collision ─────────────────────────────────────────────────────
  let nx = fpPos.x + moveX;
  let nz = fpPos.z + moveZ;
  const r = BODY_R;

  // Wall bounds — room stays at origin, use pre-computed base bounds
  const bounds = boundsBase;
  if (nx < bounds.xMin + r) { nx = bounds.xMin + r; _velX = Math.max(_velX, 0); }
  else if (nx > bounds.xMax - r) { nx = bounds.xMax - r; _velX = Math.min(_velX, 0); }
  if (nz < bounds.zMin + r) { nz = bounds.zMin + r; _velZ = Math.max(_velZ, 0); }
  else if (nz > bounds.zMax - r) { nz = bounds.zMax - r; _velZ = Math.min(_velZ, 0); }

  // Furniture AABBs (+ OBBs)
  let bonkedThisFrame = false;
  let bonkIntensity = 0;
  let groundY = getPlayerFloorY(); // eye-height floor (floorY + EYE_H)
  const boxes = _getBoxes();

  for (const box of boxes) {
    // ── OBB (rotated box) collision ───────────────────────────────
    if (box.obb) {
      // Transform player into OBB local space (trig pre-computed on box)
      const dx = nx - box.cx, dz = nz - box.cz;
      const lx = dx * box.cosA - dz * box.sinA;
      const lz = dx * box.sinA + dz * box.cosA;
      // Closest point on local AABB to local player pos
      const clampX = Math.max(-box.hw, Math.min(box.hw, lx));
      const clampZ = Math.max(-box.hd, Math.min(box.hd, lz));
      const distX = lx - clampX, distZ = lz - clampZ;
      const distSq = distX * distX + distZ * distZ;
      if (distSq < r * r) {
        // Y-axis checks (same as AABB path)
        const prevFeet = fpPos.y - EYE_H;
        const newFeet = newY - EYE_H;
        const newHeadTop = newY + HEAD_EXTRA;
        const onTopPrev = prevFeet >= box.yTop - 0.25;
        // Swept-landing: if we started at/above the top and are descending (or
        // barely moving down), treat this as a landing regardless of how far
        // we'd overshoot this frame. Otherwise fast falls would punch through.
        const descendingOntoTop = onTopPrev && (fpVy <= 0 || newFeet <= prevFeet);
        if (descendingOntoTop || (onTopPrev && newFeet >= box.yTop - 0.5)) {
          groundY = Math.max(groundY, box.yTop + EYE_H);
        } else if (box.yBottom !== undefined && newHeadTop <= box.yBottom - 0.2) {
          // Fully beneath — pass through
        } else if (box.yBottom !== undefined && newFeet < box.yBottom - 0.2 && fpVy > 0.05) {
          bonkedThisFrame = true;
          bonkIntensity = Math.max(bonkIntensity, fpVy * 1.2);
          newY = box.yBottom - 0.2 - HEAD_EXTRA;
          fpVy = -0.05;
          _spaceHeld = 0;
          _isJumping = false;
        } else {
          // Push out in local space, then rotate back to world
          const dist = Math.sqrt(distSq) || 0.001;
          const pushDist = r - dist;
          const pushLX = (distX / dist) * pushDist;
          const pushLZ = (distZ / dist) * pushDist;
          // Rotate push vector back to world space (trig pre-computed)
          const pushWX = pushLX * box.cosB - pushLZ * box.sinB;
          const pushWZ = pushLX * box.sinB + pushLZ * box.cosB;
          nx += pushWX;
          nz += pushWZ;
          // Kill velocity along push direction
          const pushLen = Math.sqrt(pushWX * pushWX + pushWZ * pushWZ) || 1;
          const nPX = pushWX / pushLen, nPZ = pushWZ / pushLen;
          const velDot = _velX * nPX + _velZ * nPZ;
          if (velDot < 0) { _velX -= velDot * nPX; _velZ -= velDot * nPZ; }
        }
      }
      continue; // skip AABB path
    }

    // ── Standard AABB collision ───────────────────────────────────
    const xOverlap = nx + r > box.xMin && nx - r < box.xMax;
    const zOverlap = nz + r > box.zMin && nz - r < box.zMax;
    if (xOverlap && zOverlap) {
      const prevFeet = fpPos.y - EYE_H;
      const newFeet = newY - EYE_H;
      const newHeadTop = newY + HEAD_EXTRA;

      const onTopPrev = prevFeet >= box.yTop - 0.25;
      // Swept-landing: a fast descent from above can drop feet more than 0.5
      // below box.yTop in a single frame. Without this, the player skips the
      // landing branch, gets pushed sideways, and ends up on the floor.
      const descendingOntoTop = onTopPrev && (fpVy <= 0 || newFeet <= prevFeet);
      if (descendingOntoTop || (onTopPrev && newFeet >= box.yTop - 0.5)) {
        groundY = Math.max(groundY, box.yTop + EYE_H);
      } else if (box.yBottom !== undefined && newHeadTop <= box.yBottom - 0.2) {
        // Fully beneath — pass through
      } else if (box.yBottom !== undefined && newFeet < box.yBottom - 0.2 && fpVy > 0.05) {
        // Head bonk on ceiling
        bonkedThisFrame = true;
        bonkIntensity = Math.max(bonkIntensity, fpVy * 1.2);
        newY = box.yBottom - 0.2 - HEAD_EXTRA;
        fpVy = -0.05;
        _spaceHeld = 0;
        _isJumping = false;
      } else {
        // XZ push-out
        const pushXL = box.xMax + r - nx;
        const pushXR = nx + r - box.xMin;
        const pushZF = box.zMax + r - nz;
        const pushZB = nz + r - box.zMin;
        const minPush = Math.min(pushXL, pushXR, pushZF, pushZB);
        if (minPush === pushXL) { nx = box.xMax + r; _velX = Math.max(_velX, 0); }
        else if (minPush === pushXR) { nx = box.xMin - r; _velX = Math.min(_velX, 0); }
        else if (minPush === pushZF) { nz = box.zMax + r; _velZ = Math.max(_velZ, 0); }
        else { nz = box.zMin - r; _velZ = Math.min(_velZ, 0); }
      }
    }
  }

  fpPos.x = nx;
  fpPos.z = nz;
  fpPos.y = newY;
  const impactVy = fpVy;
  if (fpPos.y < groundY) { fpPos.y = groundY; fpVy = 0; }

  // Ceiling — push down immediately to avoid oscillation jitter
  const floorY = getFloorY();
  const ceilMax = (floorY + 80) - 0.5;
  if (fpPos.y > ceilMax) {
    const hitVy = fpVy;
    fpPos.y = ceilMax;
    fpVy = -0.05;
    _spaceHeld = 0;
    _isJumping = false;
    if (hitVy > 0.05) {
      bonkedThisFrame = true;
      bonkIntensity = Math.max(bonkIntensity, hitVy * 1.2);
    }
  }

  // Bonk SFX
  if (bonkedThisFrame && !_wasBonking) _playBonk(bonkIntensity);
  _wasBonking = bonkedThisFrame;

  // ── Headbob ───────────────────────────────────────────────────────
  const grounded = Math.abs(fpPos.y - groundY) < 0.05;
  if (grounded && !_wasGroundedLast && impactVy < -0.06) {
    _playLandCue(Math.min(1, (-impactVy) / 0.8));
  }
  _wasGroundedLast = grounded;
  const horizSpd = Math.hypot(_velX, _velZ);
  const movingOnGround = grounded && horizSpd > 0.03;
  if (movingOnGround) {
    const sprintingStep = fpKeys.shift && horizSpd > 0.08;
    const speedNorm = Math.min(1, horizSpd / (sprintingStep ? 0.65 : 0.35));
    const intervalMs = sprintingStep ? 185 : 255;
    if (!_wasFootstepMoving) _lastFootstepTs = ts - intervalMs * 0.55;
    if (ts - _lastFootstepTs >= intervalMs) {
      _playFootstepCue(speedNorm, sprintingStep);
      _lastFootstepTs = ts;
    }
  } else {
    _lastFootstepTs = ts;
  }
  _wasFootstepMoving = movingOnGround;
  if (grounded && horizSpd > 0.02) {
    _bobPhase += horizSpd * 0.6 * frameScale;
  }
  // More pronounced bob that scales with speed — sprinting bobs more
  const bobAmp = Math.min(horizSpd, 0.5) * 0.12;
  const bobY = grounded ? Math.sin(_bobPhase) * bobAmp : 0;

  // ── Camera ────────────────────────────────────────────────────────
  const lookDir = _viewDir.set(
    -Math.sin(fpYaw) * Math.cos(fpPitch),
    Math.sin(fpPitch),
    -Math.cos(fpYaw) * Math.cos(fpPitch)
  );

  if (fpCamMode === 'first') {
    _camera.position.set(fpPos.x, fpPos.y + bobY, fpPos.z);
    const eyeTarget = _lookTarget.copy(_camera.position).addScaledVector(lookDir, 10);
    _camera.lookAt(eyeTarget);
    if (_catGroup) _catGroup.visible = false;
  } else {
    // Third-person
    const focal = _lookTarget.set(fpPos.x + fwd.x * 0.6, fpPos.y + 0.7, fpPos.z + fwd.z * 0.6);
    const camShoulder = 0.9;
    // pitchN: 0 = looking fully down, 1 = looking fully up
    const pitchN = (fpPitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN);
    const camDist = 9.0;
    const camLift = 2.2;
    let dxC = -lookDir.x * camDist + right.x * camShoulder;
    let dyC = -lookDir.y * camDist + camLift;
    let dzC = -lookDir.z * camDist + right.z * camShoulder;

    // Camera wall clamp — include closet area so player can walk in
    const inHallway = focal.z > 49 - 1;
    const camWallXMin = inHallway ? (-51 + 1) : (-(SIDE_WALL_X + CLOSET_DEPTH) + 1); // hallway -X wall vs. closet back wall
    const camWallXMax = inHallway ? (-11 - 1) : (-LEFT_WALL_X - 1);                  // hallway +X wall vs. window wall
    // Z bounds must include closet interior (extends to cZ - cIW/2 = -89)
    const camWallZMin = CLOSET_Z - CLOSET_INTERIOR_W / 2 + 1; // closet -Z side wall
    // Default Z clamp stops at the back-wall inner face. When the player is in
    // the hallway extension (focal X inside the hallway opening and past the
    // back wall), extend Z so the camera can follow.
    const inHallwayX = (focal.x >= -51 + 1 && focal.x <= -11 - 1);
    const camWallZMax = (inHallwayX && focal.z > 49 - 6) ? (289 - 1) : (49 - 1);
    // Camera Y min tracks the player's current ground, not the room floor,
    // so on elevated surfaces (bed, nightstand) it doesn't clip below them.
    const cyMin = Math.max(floorY + 0.5, fpPos.y - EYE_H + 1.5);
    const cyMax = (floorY + 80) - 2;
    const maxDX = dxC > 0 ? (camWallXMax - focal.x) : (focal.x - camWallXMin);
    const maxDY = dyC > 0 ? (cyMax - focal.y) : (focal.y - cyMin);
    const maxDZ = dzC > 0 ? (camWallZMax - focal.z) : (focal.z - camWallZMin);
    const absDX = Math.abs(dxC), absDY = Math.abs(dyC), absDZ = Math.abs(dzC);
    let scale = 1;
    if (absDX > maxDX && absDX > 1e-4) scale = Math.min(scale, Math.max(0, maxDX) / absDX);
    if (absDY > maxDY && absDY > 1e-4) scale = Math.min(scale, Math.max(0, maxDY) / absDY);
    if (absDZ > maxDZ && absDZ > 1e-4) scale = Math.min(scale, Math.max(0, maxDZ) / absDZ);
    scale = Math.max(scale, 0.18);

    let cxC = focal.x + dxC * scale;
    let cyC = focal.y + dyC * scale;
    let czC = focal.z + dzC * scale;
    // Hard clamp — camera must never leave the room.
    // Track how much the Y clamp shifts the camera so we can shift
    // the lookAt target by the same amount, preserving the viewing
    // angle and preventing the crosshair from jumping at the ceiling.
    const idealCyC = cyC;
    cxC = Math.max(camWallXMin, Math.min(camWallXMax, cxC));
    cyC = Math.max(cyMin, Math.min(cyMax, cyC));
    czC = Math.max(camWallZMin, Math.min(camWallZMax, czC));
    const camYShift = cyC - idealCyC;

    _camera.position.set(cxC, cyC, czC);
    // Blend lookAt: when looking down (pitchN < 0.5), look at the cat
    // so you can see its face. When looking up (pitchN > 0.5), look
    // forward so ceiling/lights are visible and the cat doesn't block.
    // pitchN=0.45 is the crossover (slightly below center).
    const lookAtCatBlend = Math.max(0, Math.min(1, (0.55 - pitchN) * 3));
    const fwdLookX = cxC + lookDir.x * 10;
    const fwdLookY = cyC + lookDir.y * 10 + camYShift;
    const fwdLookZ = czC + lookDir.z * 10;
    const catLookX = focal.x;
    const catLookY = focal.y + camYShift;
    const catLookZ = focal.z;
    _camera.lookAt(
      fwdLookX + (catLookX - fwdLookX) * lookAtCatBlend,
      fwdLookY + (catLookY - fwdLookY) * lookAtCatBlend,
      fwdLookZ + (catLookZ - fwdLookZ) * lookAtCatBlend
    );

    if (_catGroup) {
      if (_catGroup.parent !== _scene) _scene.add(_catGroup);
      _catGroup.visible = true;
      _catGroup.position.set(fpPos.x, fpPos.y - 4.0, fpPos.z);

      // Face movement direction
      const moveLenSq = _velX * _velX + _velZ * _velZ;
      if (moveLenSq > 0.0009) lastCatFacingYaw = Math.atan2(_velX, _velZ);
      let dYaw = lastCatFacingYaw - _catGroup.rotation.y;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      _catGroup.rotation.y += dYaw * easeAlpha(19.74, dtSec);
      _catGroup.rotation.x = 0;
      _catGroup.rotation.z = 0;
    }
  }

  // ── Crosshair interaction indicator ───────────────────────────────
  // Highlight crosshair when aiming at something clickable
  _cacheDom();
  if (_cachedCrosshair) {
    if (ts - _lastCrosshairRaycastTs >= RAYCAST_INTERVAL_MS) {
      _lastCrosshairRaycastTs = ts;
      _ray.setFromCamera(_rayCenter, _camera);
      // Raycast only against known interactive objects (not entire scene)
      let aimingAt = false;
      for (let i = 0; i < _interactiveObjects.length; i++) {
        const obj = _interactiveObjects[i];
        if (!obj.parent) continue; // removed from scene
        const hits = _ray.intersectObject(obj, true);
        if (hits.length > 0 && hits[0].distance <= 220) {
          aimingAt = true;
          break;
        }
      }
      if (aimingAt && !_wasAimingAtInteractable && ts - _lastAimToneTs > 220) {
        _playAimCue();
        _lastAimToneTs = ts;
      }
      _wasAimingAtInteractable = aimingAt;
      _crosshairAimingAtInteractable = aimingAt;
      window._fpLookTarget = aimingAt;
    }

    const aiming = _crosshairAimingAtInteractable;
    const crosshair = _cachedCrosshair;
    if (crosshair._aiming !== aiming) {
      crosshair._aiming = aiming;
      crosshair.classList.toggle('aiming', aiming);
    }
  }

  // ── Coin counter HUD ──────────────────────────────────────────────
  const coinCountEl = document.getElementById('coinCount');
  if (coinCountEl) coinCountEl.textContent = coins.coinScore + '/' + coins.coinTotal;
  // Secret coin counter — show only when at least one secret has been found
  const secretHud = document.getElementById('secretCoinHud');
  const secretCountEl = document.getElementById('secretCoinCount');
  if (secretHud && secretCountEl) {
    if (coins.coinSecretScore > 0) {
      secretHud.style.display = '';
      secretCountEl.textContent = coins.coinSecretScore;
    } else {
      secretHud.style.display = 'none';
    }
  }
}

// ── Input binding ───────────────────────────────────────────────────

function _bindInputs() {
  // Mouse look (pointer lock)
  document.addEventListener('mousemove', e => {
    if (!fpMode || !document.pointerLockElement) return;
    const rawX = e.movementX || 0;
    const rawY = e.movementY || 0;
    const maxDelta = 120;
    fpLookDX += Math.max(-maxDelta, Math.min(maxDelta, rawX));
    fpLookDY += Math.max(-maxDelta, Math.min(maxDelta, rawY));
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (!fpMode) return;
    if (fpPaused && e.code !== 'Escape' && e.code !== 'Tab') return;

    switch (e.code) {
      case 'KeyW': fpKeys.w = true; break;
      case 'KeyA': fpKeys.a = true; break;
      case 'KeyS': fpKeys.s = true; break;
      case 'KeyD': fpKeys.d = true; break;
      case 'Space': e.preventDefault(); fpKeys.space = true; break;
      case 'ShiftLeft': case 'ShiftRight': fpKeys.shift = true; break;
      case 'Escape': case 'Tab':
        e.preventDefault();
        setPaused(!fpPaused);
        break;
      case 'KeyV':
        setCamMode();
        break;
      case 'KeyR':
        _resetRun();
        if (_showToast) _showToast('Reset!');
        break;
      case 'KeyG':
        toggleFirstPerson();
        break;
      case 'KeyH':
        _toggleHelp();
        break;
        break;
    }
  });

  document.addEventListener('keyup', e => {
    if (!fpMode) return;
    switch (e.code) {
      case 'KeyW': fpKeys.w = false; break;
      case 'KeyA': fpKeys.a = false; break;
      case 'KeyS': fpKeys.s = false; break;
      case 'KeyD': fpKeys.d = false; break;
      case 'Space': fpKeys.space = false; break;
      case 'ShiftLeft': case 'ShiftRight': fpKeys.shift = false; break;
    }
  });

  // Re-lock pointer on canvas click
  if (_canvas) {
    _canvas.addEventListener('click', () => {
      if (fpMode && !fpPaused && !document.pointerLockElement) {
        _requestPointerLockWithRetry(2, 0);
      }
    });
  }

  // Pointer lock change → auto-pause
  document.addEventListener('pointerlockchange', () => {
    if (_fpIgnorePointerUnlock) return;
    if (fpMode && !fpPaused && !document.pointerLockElement) {
      setTimeout(() => {
        if (fpMode && !document.pointerLockElement && !fpPaused) setPaused(true);
      }, 100);
    }
  });

  // G key to open character select from orbit mode
  document.addEventListener('keydown', e => {
    if (fpMode) return;
    if (e.code === 'KeyG' && window._openCharSelect) window._openCharSelect();
  });

  // ── Mobile joystick ─────────────────────────────────────────────
  const joystick = document.getElementById('mobileJoystick');
  const knob = document.getElementById('mobileJoyKnob');
  if (joystick && knob) {
    let joyActive = false;
    let joyOriginX = 0, joyOriginY = 0, joyR = 0;

    const updateJoy = (cx, cy) => {
      const dx = cx - joyOriginX, dy = cy - joyOriginY;
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), joyR);
      const angle = Math.atan2(dx, -dy); // angle from top
      const nx = dist > 8 ? Math.sin(angle) * (dist / joyR) : 0;
      const ny = dist > 8 ? -Math.cos(angle) * (dist / joyR) : 0;

      // Map to keys
      fpKeys.w = ny < -0.3;
      fpKeys.s = ny > 0.3;
      fpKeys.a = nx < -0.3;
      fpKeys.d = nx > 0.3;

      // Move knob visual
      const visualDist = Math.min(dist, joyR);
      const vx = dist > 0 ? (dx / Math.sqrt(dx * dx + dy * dy)) * visualDist : 0;
      const vy = dist > 0 ? (dy / Math.sqrt(dx * dx + dy * dy)) * visualDist : 0;
      knob.style.transform = `translate(calc(-50% + ${vx}px), calc(-50% + ${vy}px))`;
    };

    const resetJoy = () => {
      joyActive = false;
      fpKeys.w = false; fpKeys.s = false; fpKeys.a = false; fpKeys.d = false;
      knob.style.transform = 'translate(-50%, -50%)';
    };

    joystick.addEventListener('pointerdown', e => {
      e.preventDefault();
      joyActive = true;
      const rect = joystick.getBoundingClientRect();
      joyOriginX = rect.left + rect.width / 2;
      joyOriginY = rect.top + rect.height / 2;
      joyR = rect.width / 2 - 20;
      joystick.setPointerCapture(e.pointerId);
      updateJoy(e.clientX, e.clientY);
    });
    joystick.addEventListener('pointermove', e => {
      if (!joyActive) return;
      e.preventDefault();
      updateJoy(e.clientX, e.clientY);
    });
    joystick.addEventListener('pointerup', resetJoy);
    joystick.addEventListener('pointercancel', resetJoy);

    // Mobile look — touch on the right half of screen
    let lookTouchId = null;
    let lookLastX = 0, lookLastY = 0;
    _canvas.addEventListener('touchstart', e => {
      if (!fpMode) return;
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.4) {
          lookTouchId = t.identifier;
          lookLastX = t.clientX;
          lookLastY = t.clientY;
          break;
        }
      }
    }, { passive: true });
    _canvas.addEventListener('touchmove', e => {
      if (!fpMode || lookTouchId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === lookTouchId) {
          const dx = t.clientX - lookLastX;
          const dy = t.clientY - lookLastY;
          fpLookDX += dx * 1.5;
          fpLookDY += dy * 1.5;
          lookLastX = t.clientX;
          lookLastY = t.clientY;
          break;
        }
      }
    }, { passive: true });
    const clearLook = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookTouchId) { lookTouchId = null; break; }
      }
    };
    _canvas.addEventListener('touchend', clearLook, { passive: true });
    _canvas.addEventListener('touchcancel', clearLook, { passive: true });
  }
}
