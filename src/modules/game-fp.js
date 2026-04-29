// ─── First-person game mode ─────────────────────────────────────────
// FP physics, camera, input, collision, and mode transitions.
// Ported from the monolith (index.html ~L8224-8530, L10595-10830).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
import * as catAppearance from './cat-appearance.js';
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
const SKATE_MODE_KEY = 'diy_air_purifier_skate_mode_v1';
const SKATEBOARD_FOUND_KEY = 'diy_air_purifier_skateboard_found_v1';
const MPH_VIS_KEY = 'diy_air_purifier_mph_visible_v1';

try { sfxMuted = localStorage.getItem(SFX_MUTE_KEY) === '1'; } catch (e) { }
try { musicMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1'; } catch (e) { }

// ── Skateboard unlock (must find the hidden skateboard first) ──────
export let skateboardFound = false;
try { skateboardFound = localStorage.getItem(SKATEBOARD_FOUND_KEY) === '1'; } catch (e) { }
export function isSkateboardFound() { return skateboardFound; }
export function markSkateboardFound() {
  if (skateboardFound) return;
  skateboardFound = true;
  try { localStorage.setItem(SKATEBOARD_FOUND_KEY, '1'); } catch (e) { }
  _syncSkateToggleUi();
}

// ── Speed mode (3x top speed, slower acceleration) ──────────────────
// Gated behind finding every secret coin at least once (see coins.hasFoundAllSecrets).
export let speedMode = false;
try { speedMode = localStorage.getItem(SPEED_MODE_KEY) === '1'; } catch (e) { }
// Force-off at boot if the unlock hasn't happened on this device yet.
if (speedMode && !coins.hasFoundAllSecrets()) {
  speedMode = false;
  try { localStorage.setItem(SPEED_MODE_KEY, '0'); } catch (e) { }
}
export function isSpeedMode() { return speedMode && coins.hasFoundAllSecrets(); }
export function setSpeedMode(enabled) {
  speedMode = !!enabled && coins.hasFoundAllSecrets();
  try { localStorage.setItem(SPEED_MODE_KEY, speedMode ? '1' : '0'); } catch (e) { }
}

// ── Skate mode (sideways stance + board visual) ────────────────────
export let skateMode = false;
try { skateMode = localStorage.getItem(SKATE_MODE_KEY) === '1'; } catch (e) { }
// Force-off at boot if the skateboard hasn't been found on this device yet.
if (skateMode && !skateboardFound) {
  skateMode = false;
  try { localStorage.setItem(SKATE_MODE_KEY, '0'); } catch (e) { }
}
export function isSkateMode() { return skateMode && skateboardFound; }
export function getSkateModelLift() { return (skateMode && skateboardFound) ? _skateModelLift : 0; }
export function setSkateMode(enabled, opts = {}) {
  const next = !!enabled && skateboardFound;
  const force = !!opts.force;
  const silent = !!opts.silent;
  if (!force && skateMode === next) {
    _syncSkateToggleUi();
    _syncSkateboardVisualState();
    return;
  }
  skateMode = next;
  try { localStorage.setItem(SKATE_MODE_KEY, skateMode ? '1' : '0'); } catch (e) { }
  _syncSkateToggleUi();
  _syncSkateboardVisualState();
  if (skateMode) _initSkateboard();
  else {
    _skateModelLift = 0;
    _silenceSkateRoll(false);
  }
  // On entering skate mode, seed the lift to the model's baseline trim so
  // legs don't start the eased lerp at y=0 (which causes a few frames of
  // visible clipping through the board). The per-frame foot-anchor sampler
  // takes over from here and eases naturally to the correct target.
  if (skateMode) _skateModelLift = _getSkateLiftTrimForModel();
  // Reset trick state
  _trickManual = 0; _trickManualHeld = false;
  _trickKickflip = 0; _trickKickflipActive = false;
  _trickSpinAngle = 0; _trickSpinSpeed = 0; _trickSpinBoost = false;
  if (!silent && _showToast) _showToast(skateMode ? 'Skate mode on' : 'Skate mode off');
}

// ── Mouse sensitivity (1.0 = default) ───────────────────────────────
export let mouseSens = 1.0;
try {
  const raw = localStorage.getItem(MOUSE_SENS_KEY);
  if (raw != null) {
    const v = parseFloat(raw);
    if (isFinite(v)) mouseSens = Math.max(0.25, Math.min(2.5, v));
  }
} catch (e) { }

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
  try { localStorage.setItem(MOUSE_SENS_KEY, String(mouseSens)); } catch (e) { }
  _syncMouseSensUi();
}

export function syncMouseSensUi() {
  _syncMouseSensUi();
}

// ── MPH HUD visibility ─────────────────────────────────────────────
export let mphVisible = true;
try { mphVisible = localStorage.getItem(MPH_VIS_KEY) !== '0'; } catch (e) { }

export function isMphVisible() { return mphVisible; }
export function setMphVisible(v) {
  mphVisible = !!v;
  try { localStorage.setItem(MPH_VIS_KEY, mphVisible ? '1' : '0'); } catch (e) { }
  _syncMphHud();
}

function _syncMphHud() {
  const show = mphVisible && skateboardFound && fpMode;
  const el = document.getElementById('mphHud');
  const div = document.getElementById('mphDivider');
  if (el) el.style.display = show ? '' : 'none';
  if (div) div.style.display = show ? '' : 'none';
  // Pause menu toggle
  const row = document.getElementById('fpPauseShowMphRow');
  if (row) row.style.display = skateboardFound ? '' : 'none';
  const sw = document.getElementById('fpPauseShowMph');
  const st = document.getElementById('fpPauseShowMphState');
  if (sw) { sw.classList.toggle('on', mphVisible); sw.setAttribute('aria-checked', String(mphVisible)); }
  if (st) { st.textContent = mphVisible ? 'On' : 'Off'; st.classList.toggle('off', !mphVisible); }
}

export function syncMphHud() { _syncMphHud(); }

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

function _syncSkateToggleUi() {
  const skateTog = document.getElementById('fpPauseSkateMode');
  const skateState = document.getElementById('fpPauseSkateModeState');
  const locked = !skateboardFound;
  if (skateTog) {
    if (locked) {
      skateTog.classList.remove('on');
      skateTog.classList.add('locked');
      skateTog.setAttribute('aria-checked', 'false');
      skateTog.setAttribute('aria-label', 'Skate mode locked — find the skateboard!');
      skateTog.style.pointerEvents = 'none';
      skateTog.style.opacity = '0.45';
    } else {
      skateTog.classList.remove('locked');
      skateTog.classList.toggle('on', skateMode);
      skateTog.setAttribute('aria-checked', String(skateMode));
      skateTog.setAttribute('aria-label', skateMode ? 'Skate mode enabled' : 'Skate mode disabled');
      skateTog.style.pointerEvents = '';
      skateTog.style.opacity = '';
    }
  }
  if (skateState) {
    if (locked) {
      skateState.textContent = 'Find the skateboard!';
      skateState.classList.add('off');
    } else {
      skateState.textContent = skateMode ? 'On' : 'Off';
      skateState.classList.toggle('off', !skateMode);
    }
  }
  // Show/hide skate hint + trick hints in the charge bar
  const skateHint = document.getElementById('skateUnlockHint');
  const trickHints = document.getElementById('skateTrickHints');
  if (!locked && fpMode) {
    if (skateHint) {
      skateHint.classList.add('visible');
      skateHint.classList.toggle('active', skateMode);
    }
    if (trickHints) {
      if (skateMode) {
        trickHints.classList.remove('fade-out');
        trickHints.classList.add('visible');
      } else {
        trickHints.classList.add('fade-out');
        trickHints.classList.remove('visible');
      }
    }
  } else {
    if (skateHint) skateHint.classList.remove('visible');
    if (trickHints) { trickHints.classList.remove('visible'); trickHints.classList.remove('fade-out'); }
  }
  _syncMphHud();
}

export function syncSkateToggleUi() {
  _syncSkateToggleUi();
}

export function setSfxMuted(muted) {
  sfxMuted = !!muted;
  try { localStorage.setItem(SFX_MUTE_KEY, sfxMuted ? '1' : '0'); } catch (e) { }
  if (sfxMuted) { _silenceSkateRoll(true); _silenceSsAudio(true); }
  _syncAudioToggleUi();
}

export function setMusicMuted(muted) {
  musicMuted = !!muted;
  try { localStorage.setItem(MUSIC_MUTE_KEY, musicMuted ? '1' : '0'); } catch (e) { }
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
let _tierGateHeld = 0;         // frames held at the current tier gate (stepped charge)
let _jumpHoldFrames = 0;       // frames of variable-height boost applied this jump
let _isJumping = false;        // true between liftoff and apex of current jump
let _coyoteFrames = 0;         // frames remaining where a late jump is still allowed
let _jumpBufferFrames = 0;     // frames remaining where a pre-press will trigger on land
let _spaceWasDown = false;     // edge-detect for space press
let _wasBonking = false;
let _wasGroundedLast = true;
let _wallContactNx = 0;       // wall-push normal X from last frame (0 = no wall)
let _wallContactNz = 0;       // wall-push normal Z from last frame
let _skateBoostAccum = 0;     // progressive speed boost — grows while skating, resets on wall hit
let _wallJumpCooldown = 0;     // frames remaining before next wall jump allowed
let _consecutiveWallJumps = 0; // wall jumps since last grounded — increases gravity
let _preCollisionSpd = 0;     // horizontal speed snapshot before collision kills it
let _wasAimingAtInteractable = false;
let _lastAimToneTs = 0;
let _lastCrosshairRaycastTs = 0;
let _crosshairAimingAtInteractable = false;
let _lastFootstepTs = 0;
let _wasFootstepMoving = false;
let _skateLean = 0;
let _catGroupYaw = 0;

// ── Skate trick state ─────────────────────────────────────────────
let _trickManual = 0;      // smoothed 0..1 pitch amount
let _trickManualHeld = false;  // E key currently down
let _trickKickflip = 0;      // 0..1 animation progress
let _trickKickflipActive = false;
let _trickSpinAngle = 0;      // cumulative spin angle (radians)
let _trickSpinSpeed = 0;      // current spin speed (radians/sec)
let _trickSpinBoost = false;  // flag: apply upward kick next frame

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

// ── Super Saiyan mode ──────────────────────────────────────────────
// Activates after holding the jump bar at 100% charge for 5 seconds.
// While active (20s): cat gets 2x speed and keeps the gold aura on.
// Yellow emissive boost on every cat material + a flickering additive
// sphere/halo around the cat.
let _ssAura = null;          // additive yellow sphere child of _catGroup
let _ssHalo = null;          // additive yellow ring/sprite child of _catGroup
let _ssSparkles = null;      // array of orbiting gold diamond meshes during SS
let _ssMatCache = null;      // Map<material, {emissive:Color, intensity:number}>
let _ssAuraStrength = 0;     // smoothed 0..1 drive value
let _ssEnvLight = null;      // moving point light that affects room surfaces
let _ssEnvLightIntensity = 0;
const _ssGold = new THREE.Color(0xffe070);
const _ssGoldHot = new THREE.Color(0xfff8b0);
const _ssEnvAnchor = new THREE.Vector3();

// Activation gate + active-window timers.
const SS_HOLD_MS = 5000;  // how long full charge must be held to activate
const SS_ACTIVE_MS = 20000; // duration of super saiyan mode once activated
const SS_HUD_ENTER_FLASH_MS = 1200;
let _ssFullChargeSinceTs = 0; // ts when chargePct first hit 100% (0 = not holding)
let _ssActiveUntilTs = 0;     // ts at which the active window ends (0 = not active)
let _ssBurstStartTs = 0;      // ts when SS activated (drives ~3s burst flash at start of active window)
let _ssHudFlashUntilTs = 0;   // one-shot HUD pulse window when SS activates
const SS_BURST_MS = 3000;     // duration of the post-activation burst
const SS_CHARGE_HINT_MS = 1500; // ms into a full-charge hold before subtle aura starts hinting
let _ssChargeShake = 0;       // smoothed 0..1 shake strength while holding full charge
const _ssShakeOffset = new THREE.Vector3();

export function isSuperSaiyanActive() {
  return _ssActiveUntilTs > 0 && performance.now() < _ssActiveUntilTs;
}

function _ensureSuperSaiyanAura() {
  if (_ssAura || !_catGroup) return;
  // Soft additive sphere roughly hugging the cat silhouette — looks like a
  // body halo. Kept smaller than the first pass so it reads as a glow, not a
  // giant bubble around the player.
  const geom = new THREE.SphereGeometry(4.5, 24, 16);
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
  _ssAura.userData.clickPassthrough = true;
  _catGroup.add(_ssAura);

  // Outer flickery halo — slightly bigger, front side, lower opacity.
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff2a0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _ssHalo = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 12), haloMat);
  _ssHalo.position.set(0, 4, 0);
  _ssHalo.renderOrder = 999;
  _ssHalo.frustumCulled = false;
  _ssHalo.userData.clickPassthrough = true;
  _catGroup.add(_ssHalo);

  // Flame body shell — soft inner glow that fills the gaps between spike
  // valleys so the silhouette reads as one continuous flame, not a star
  // floating in space.
  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0xffe070,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _ssFlameBody = new THREE.Mesh(new THREE.SphereGeometry(3.6, 20, 14), bodyMat);
  _ssFlameBody.position.set(0, 2.5, 0);
  _ssFlameBody.renderOrder = 999;
  _ssFlameBody.frustumCulled = false;
  _ssFlameBody.userData.clickPassthrough = true;
  _ssFlameBody.scale.set(0.9, 1.25, 0.9);
  _catGroup.add(_ssFlameBody);

  // Single connected 3D flame silhouette. We start with a subdivided
  // icosphere (one continuous closed mesh) and displace each vertex outward
  // by a function that is high near a small set of "spike directions" and
  // low between them. The result is one volumetric star — looks spiky from
  // any angle, with all spikes joined through a shared inner shell.
  _ssSpikesMat = new THREE.MeshBasicMaterial({
    color: 0xfff080,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  // Pick spike directions: golden-angle distribution, biased to the upper
  // hemisphere so flames go up; one tall spike straight up.
  const SPIKE_COUNT = 16;
  const SPIKES = [];
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const t = (i + 0.5) / SPIKE_COUNT;
    const phi = Math.acos(1 - 1.4 * t); // 0..~120deg from +Y
    const theta = i * 2.399963;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    ).normalize();
    const upBias = Math.max(0, dir.y);
    const len = 5.0 + upBias * 6.5 + Math.random() * 1.5;
    SPIKES.push({ dir, len });
  }
  // Force the tallest spike straight up so the silhouette has a clear peak.
  SPIKES[0].dir.set(0, 1, 0);
  SPIKES[0].len = 13.0;

  const flameGeo = new THREE.IcosahedronGeometry(1, 4); // ~640 verts, smooth
  const posAttrInit = flameGeo.getAttribute('position');
  const vertCount = posAttrInit.count;
  const baseDirs = new Float32Array(vertCount * 3);     // unit direction per vertex
  const baseR = new Float32Array(vertCount);          // per-vertex target radius
  const tipMask = new Float32Array(vertCount);          // 0..1, 1 = at a spike tip
  const phases = new Float32Array(vertCount);
  const VALLEY_R = 3.0;
  const SPIKE_SHARPNESS = 7.0; // higher = pointier spikes
  const tmp = new THREE.Vector3();
  for (let i = 0; i < vertCount; i++) {
    tmp.fromBufferAttribute(posAttrInit, i).normalize();
    baseDirs[i * 3] = tmp.x;
    baseDirs[i * 3 + 1] = tmp.y;
    baseDirs[i * 3 + 2] = tmp.z;
    // Find the spike whose direction this vertex is most aligned with.
    let bestDot = -Infinity;
    let bestLen = 0;
    for (const s of SPIKES) {
      const d = tmp.x * s.dir.x + tmp.y * s.dir.y + tmp.z * s.dir.z;
      if (d > bestDot) { bestDot = d; bestLen = s.len; }
    }
    // Sharp falloff so only verts very close to the spike axis reach the tip;
    // the rest blend smoothly back to the valley shell, joining all spikes.
    const sharp = Math.pow(Math.max(0, bestDot), SPIKE_SHARPNESS);
    tipMask[i] = sharp;
    baseR[i] = VALLEY_R + sharp * (bestLen - VALLEY_R);
    phases[i] = Math.random() * Math.PI * 2;
    posAttrInit.setXYZ(i, tmp.x * baseR[i], tmp.y * baseR[i], tmp.z * baseR[i]);
  }
  posAttrInit.needsUpdate = true;
  flameGeo.computeVertexNormals();
  _ssSpikes = new THREE.Mesh(flameGeo, _ssSpikesMat);
  _ssSpikes.position.set(0, 2.5, 0);
  _ssSpikes.renderOrder = 998;
  _ssSpikes.frustumCulled = false;
  _ssSpikes.userData.clickPassthrough = true;
  _ssSpikes.userData.baseDirs = baseDirs;
  _ssSpikes.userData.baseR = baseR;
  _ssSpikes.userData.tipMask = tipMask;
  _ssSpikes.userData.phases = phases;
  _ssSpikes.userData.vertCount = vertCount;
  _catGroup.add(_ssSpikes);

  // Gold diamond sparkles — small OctahedronGeometry, distinct from the round
  // blue Sprites used on the skateboard pickup. Orbit the cat during SS.
  const diamondGeo = new THREE.OctahedronGeometry(0.28, 0);
  const diamondMat = new THREE.MeshBasicMaterial({
    color: 0xffd54f,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _ssSparkles = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(diamondGeo, diamondMat.clone());
    m.renderOrder = 1000;
    m.frustumCulled = false;
    m.userData.clickPassthrough = true;
    m._phase = (i / 12) * Math.PI * 2;
    m._radius = 3.5 + Math.random() * 3.5;
    m._yBase = 1.5 + Math.random() * 6;
    m._speed = 1.2 + Math.random() * 1.0;
    m._rotSpeed = 3 + Math.random() * 4;
    m._baseScale = 0.6 + Math.random() * 0.6;
    m.visible = false;
    _catGroup.add(m);
    _ssSparkles.push(m);
  }
}

function _ensureSuperSaiyanEnvLight() {
  if (_ssEnvLight || !_scene) return;
  // Created visible=true with intensity=0 and kept that way forever. Toggling
  // light.visible changes the active light count, which forces Three.js to
  // recompile every PBR material's shader on first SS activation — a very
  // visible stutter. Keeping visible permanently true (and modulating only
  // intensity) means the shader light count is fixed at scene init.
  _ssEnvLight = new THREE.PointLight(0xffe484, 0, 110, 1.25);
  _ssEnvLight.castShadow = false;
  _ssEnvLight.visible = true;
  _scene.add(_ssEnvLight);
}

function _setSuperSaiyanEnvLightOff() {
  _ssEnvLightIntensity = 0;
  if (!_ssEnvLight) return;
  _ssEnvLight.intensity = 0;
  // Do NOT set visible=false — see _ensureSuperSaiyanEnvLight for why.
}

function _applySuperSaiyan(strength /* 0..1 sustained */, burst /* 0..1 transient */, ts) {
  _ensureSuperSaiyanAura();
  if (!_ssAura) return;
  // Smooth strength so leaving tier-3 fades out instead of popping.
  const lerpK = 0.18;
  _ssAuraStrength += (strength - _ssAuraStrength) * lerpK;
  const s = _ssAuraStrength;
  const b = Math.max(0, Math.min(1, burst || 0));
  const total = s + b;

  // Aura visibility + flicker
  const flicker = 0.85 + 0.15 * Math.sin(ts * 0.06) + 0.05 * Math.sin(ts * 0.013);
  // Burst additively boosts opacity back to the original "full-blown" look
  // for the first few seconds of activation, then decays back to the dim
  // sustained glow.
  const auraOpacity = Math.min(1, s * 0.14 + b * 0.36) * flicker;
  _ssAura.material.opacity = auraOpacity;
  _ssAura.visible = auraOpacity > 0.005;
  const pulse = 1 + 0.08 * Math.sin(ts * 0.02);
  // Burst also briefly inflates the halo scale so it reads as a flash.
  const baseScale = (0.85 + s * 0.55) * 0.6 + b * 0.7;
  _ssAura.scale.setScalar(baseScale * pulse);

  if (_ssHalo) {
    const haloOpacity = Math.min(1, s * 0.08 + b * 0.26) * flicker;
    _ssHalo.material.opacity = haloOpacity;
    _ssHalo.visible = haloOpacity > 0.005;
    _ssHalo.scale.setScalar(baseScale * (1.05 + 0.06 * Math.sin(ts * 0.018)));
  }

  // Flame spikes — drive shared opacity, then per-spike length flicker so
  // tips dance like the show's aura instead of sitting static.
  // Gate body+spikes on active SS only — no pre-activation flame hint.
  const ssActive = isSuperSaiyanActive();
  if (_ssFlameBody) {
    // Body matches spike opacity so the rim reads as one continuous flame.
    const bodyOpacity = ssActive
      ? Math.min(1, b * 0.36) * flicker
      : 0;
    _ssFlameBody.material.opacity = bodyOpacity;
    _ssFlameBody.visible = bodyOpacity > 0.005;
    // During sustain, shrink overall and squash to be wider/shorter; the
    // burst flash temporarily restores the taller original silhouette.
    const sustain = 1 - b;
    const bodyOverall = baseScale * (1 - sustain * 0.35);
    const bodyWide = 1 + sustain * 0.45;
    const bodyShort = 1 - sustain * 0.40;
    _ssFlameBody.scale.set(
      bodyOverall * 0.85 * bodyWide,
      bodyOverall * (1.15 + 0.05 * Math.sin(ts * 0.014)) * bodyShort,
      bodyOverall * 0.85 * bodyWide,
    );
  }
  if (_ssSpikes && _ssSpikesMat) {
    const spikeOpacity = ssActive
      ? Math.min(1, b * 0.55) * flicker
      : 0;
    _ssSpikesMat.opacity = spikeOpacity;
    _ssSpikes.visible = spikeOpacity > 0.005;
    const breathe = 0.92 + 0.12 * Math.sin(ts * 0.012);
    const sustain = 1 - b;
    const spikeOverall = baseScale * (1 - sustain * 0.35);
    const spikeWide = 1 + sustain * 0.45;
    const spikeShort = 1 - sustain * 0.40;
    _ssSpikes.scale.set(
      spikeOverall * breathe * spikeWide,
      spikeOverall * breathe * spikeShort,
      spikeOverall * breathe * spikeWide,
    );

    // Volumetric flicker — wobble each vertex along its own outward direction
    // so spike tips dance while the inner shell stays roughly stable. Tip
    // verts (high tipMask) wobble more than valley verts.
    const u = _ssSpikes.userData;
    const baseDirs = u.baseDirs;
    const baseR = u.baseR;
    const tipMask = u.tipMask;
    const phases = u.phases;
    const vc = u.vertCount;
    const posAttr = _ssSpikes.geometry.getAttribute('position');
    const tt = ts * 0.005;
    const tipBoost = 1 + b * 0.35;
    for (let i = 0; i < vc; i++) {
      const tm = tipMask[i];
      const wob = 1
        + tm * (0.20 * Math.sin(tt * 1.4 + phases[i])
          + 0.10 * Math.sin(tt * 2.7 + phases[i] * 1.7))
        + (1 - tm) * 0.04 * Math.sin(tt * 0.9 + phases[i]);
      const r = baseR[i] * wob * (1 + (tipBoost - 1) * tm);
      const dx = baseDirs[i * 3];
      const dy = baseDirs[i * 3 + 1];
      const dz = baseDirs[i * 3 + 2];
      posAttr.setXYZ(i, dx * r, dy * r, dz * r);
    }
    posAttr.needsUpdate = true;
  }

  // Walk meshes once and patch emissive. Cache originals so we can restore
  // when the strength falls back to ~0.
  if (!_ssMatCache) _ssMatCache = new Map();
  const wantOverride = total > 0.005;
  _catGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (obj === _ssAura || obj === _ssHalo || obj === _ssFlameBody
      || obj === _ssSpikes
      || (_ssSparkles && _ssSparkles.includes(obj))) return;
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
        // Blend original emissive toward gold based on strength + burst.
        const goldMix = Math.min(1, s * 0.5 + b * 0.5);
        m.emissive.copy(entry.emissive).lerp(_ssGoldHot, goldMix);
        m.emissiveIntensity = entry.intensity + (s * 0.32 + b * 0.55) * flicker;
      } else {
        m.emissive.copy(entry.emissive);
        m.emissiveIntensity = entry.intensity;
      }
    }
  });

  // Animate gold diamond sparkles — orbit + tumble + pulse, only when active
  if (_ssSparkles) {
    const tSec = ts * 0.001;
    for (const sp of _ssSparkles) {
      if (total < 0.01) {
        sp.visible = false;
        sp.material.opacity = 0;
        continue;
      }
      sp.visible = true;
      const angle = sp._phase + tSec * sp._speed;
      const r = sp._radius * (0.85 + 0.15 * Math.sin(tSec * 1.7 + sp._phase));
      sp.position.set(
        Math.cos(angle) * r,
        sp._yBase + Math.sin(tSec * 2.3 + sp._phase * 1.4) * 1.8,
        Math.sin(angle) * r
      );
      // Tumble rotation for diamond facets catching light
      sp.rotation.x = tSec * sp._rotSpeed;
      sp.rotation.y = tSec * sp._rotSpeed * 0.7 + sp._phase;
      // Opacity fades in/out with twinkle
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(tSec * 4.5 + sp._phase * 3));
      sp.material.opacity = Math.min(1, (s * 0.45 + b * 0.6)) * twinkle * flicker;
      // Scale pulses slightly
      const sc = sp._baseScale * (0.7 + 0.3 * Math.sin(tSec * 3 + sp._phase * 2));
      sp.scale.setScalar(sc * (1 + b * 0.5));
    }
  }
}

function _applySuperSaiyanEnvLight(anchor, strength /* 0..1 */, burst /* 0..1 */, ts, dtSec) {
  _ensureSuperSaiyanEnvLight();
  if (!_ssEnvLight || !anchor) return;

  const s = Math.max(0, Math.min(1, strength || 0));
  const b = Math.max(0, Math.min(1, burst || 0));
  const total = s + b;

  // Subtle during pre-glow, clearly visible during active + burst.
  let targetI = 0;
  if (total > 0.001) {
    targetI = 6 + s * 28 + b * 44;
    targetI *= 0.9 + 0.1 * Math.sin(ts * 0.041);
  }
  const lerpK = 1 - Math.exp(-Math.max(0, dtSec) * 14);
  _ssEnvLightIntensity += (targetI - _ssEnvLightIntensity) * lerpK;
  if (!Number.isFinite(_ssEnvLightIntensity)) _ssEnvLightIntensity = 0;

  if (_ssEnvLightIntensity <= 0.05) {
    _setSuperSaiyanEnvLightOff();
    return;
  }

  const t = ts * 0.001;
  const orbitR = 0.75 + s * 0.85 + b * 1.15;
  const yWobble = 0.2 + s * 0.35 + b * 0.45;

  _ssEnvLight.visible = true;
  _ssEnvLight.intensity = _ssEnvLightIntensity;
  _ssEnvLight.distance = 90 + s * 32 + b * 38;
  _ssEnvLight.color.copy(_ssGold).lerp(_ssGoldHot, Math.min(1, s * 0.55 + b * 0.75));
  _ssEnvLight.position.set(
    anchor.x + Math.sin(t * 5.1) * orbitR,
    anchor.y + 0.2 + Math.sin(t * 9.3 + 0.8) * yWobble,
    anchor.z + Math.cos(t * 4.6 + 1.2) * orbitR
  );
}

function _sampleSuperSaiyanChargeShake(ts, strength, out = _ssShakeOffset) {
  const k = Math.max(0, Math.min(1, strength));
  if (k <= 0.0001) return out.set(0, 0, 0);
  // Keep early shake subtle and spike noticeably near activation.
  const amp = 0.04 + 0.38 * (k * k);
  const t = ts * 0.001;
  out.set(
    (Math.sin(t * 47.3) + 0.45 * Math.sin(t * 93.1 + 1.7)) * 0.5 * amp,
    (Math.sin(t * 58.9 + 0.4) + 0.35 * Math.sin(t * 117.2 + 2.3)) * 0.34 * amp,
    (Math.sin(t * 52.6 + 2.1) + 0.5 * Math.sin(t * 88.4 + 0.9)) * 0.5 * amp
  );
  return out;
}

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

// Skateboard visual (loaded once, attached under cat feet)
let _skateboardLoadStarted = false;
let _skateboardAnchor = null;
let _skateboardModel = null;
let _skateboardBaseYaw = 0;
let _skateboardNativeLen = 1;
let _skateboardFitCatModel = null;
let _skateModelLift = 0;
const _skateboardBounds = new THREE.Box3();
const _skateboardCenter = new THREE.Vector3();
const _skateboardSize = new THREE.Vector3();
const _skateboardFloorPoint = new THREE.Vector3();
const _skateFootAnchor = new THREE.Vector3();
// Reusable quaternions/vectors for gimbal-free catGroup orientation
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _quatC = new THREE.Quaternion();
const _vecUp = new THREE.Vector3(0, 1, 0);
const _vecRight = new THREE.Vector3(1, 0, 0);
const _vecFwd = new THREE.Vector3(0, 0, 1);
const _skateFootTmp = new THREE.Vector3();
const _skateFootPoints = [];

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

// Walk up to find the nearest ancestor tagged as a clickable interactable.
// Keep this in sync with getInteractiveTarget() in purifier.js.
function _findInteractiveAncestor(obj) {
  for (let p = obj; p; p = p.parent) {
    if (p._isLamp || p._isCeilLight || p._isFan ||
      p._isFilterL || p._isFilterR ||
      p._isDrawer || p._isBifoldLeaf || p._isBypassPanel ||
      p._isCornerDoorHandle || p._isCornerDoor ||
      p._isGuestDoor || p._isGuestDoorHandle ||
      p._isMacbook || p._isWindow || p._isWindowPane || p._isTV || p._isFoodBowl ||
      p._isPickupSkateboard || p._isPokemonBinder || p._isStandingDesk) return p;
  }
  return null;
}

// True if a hit mesh should block the crosshair / click ray. Skips
// invisible hitboxes, fully-transparent particles, and non-mesh nodes.
function _isOccluder(obj) {
  if (!obj || !obj.isMesh) return false;
  if (obj.userData && obj.userData.clickPassthrough) return false;
  const m = obj.material;
  if (!m) return false;
  if (Array.isArray(m)) return true;
  if (m.transparent && (m.opacity == null || m.opacity < 0.05)) return false;
  return true;
}

// Friendly label shown under the crosshair when aiming at an interactable.
// Returns { verb, noun } for the glass-pill tooltip, e.g. { verb:'Open', noun:'Bedroom' }.
function _labelForInteractable(target) {
  for (let p = target; p; p = p.parent) {
    if (p._isCornerDoor || p._isCornerDoorHandle) {
      if (_roomRefs && _roomRefs.isCornerDoorOpen && _roomRefs.isCornerDoorOpen()) return { verb: 'Close', noun: 'Door' };
      return { verb: 'Open', noun: fpPos.z > 49 ? 'Bedroom' : 'Hallway' };
    }
    if (p._isGuestDoor || p._isGuestDoorHandle) {
      if (_roomRefs && _roomRefs.isGuestDoorOpen && _roomRefs.isGuestDoorOpen()) return { verb: 'Close', noun: 'Door' };
      return { verb: 'Open', noun: fpPos.x > -51 ? 'Office' : 'Hallway' };
    }
    if (p._isBifoldLeaf) {
      // Walk up to the leaf pivot group to check its open state.
      let leaf = p;
      while (leaf && !(leaf._isBifoldLeaf && leaf.isGroup && leaf._innerGroup)) leaf = leaf.parent;
      if (leaf && leaf._leafOpen) return { verb: 'Close', noun: 'Closet' };
      return { verb: 'Open', noun: 'Closet' };
    }
    if (p._isBypassPanel) {
      let panel = p;
      while (panel && !(panel._isBypassPanel && panel.isGroup && panel._slideMax !== undefined)) panel = panel.parent;
      if (panel && panel._slideOpen) return { verb: 'Close', noun: 'Closet' };
      return { verb: 'Open', noun: 'Closet' };
    }
    if (p._isDrawer) {
      // Walk up to the drawer group that has _drawerOpen state.
      let grp = p;
      while (grp && !(grp.isGroup && grp._drawerSlideMax !== undefined)) grp = grp.parent;
      if (grp && grp._drawerOpen) return { verb: 'Close', noun: 'Drawer' };
      return { verb: 'Open', noun: 'Drawer' };
    }
    if (p._isLamp) return { verb: 'Toggle', noun: 'Lamp' };
    if (p._isCeilLight) return { verb: 'Toggle', noun: 'Ceiling Light' };
    if (p._isFan) return { verb: 'Toggle', noun: 'Fan' };
    if (p._isFilterL || p._isFilterR) return { verb: 'Slide', noun: 'Filter' };
    if (p._isWindowPane) return { verb: _roomRefs && _roomRefs.isOfficeWindowOpen() ? 'Close' : 'Open', noun: 'Window' };
    if (p._isStandingDesk) {
      const sd = _roomRefs && _roomRefs.standingDesk;
      return { verb: sd && sd.raised ? 'Lower' : 'Raise', noun: 'Desk' };
    }
    if (p._isWindow) return { verb: 'Toggle', noun: 'Day/Night' };
    if (p._isMacbook) return { verb: 'Toggle', noun: 'MacBook' };
    if (p._isTV) return { verb: 'Toggle', noun: 'TV' };
    if (p._isFoodBowl) return { verb: 'Fill', noun: 'Food Bowl' };
    if (p._isPickupSkateboard) return { verb: 'Pick up', noun: 'Skateboard' };
    if (p._isPokemonBinder) {
      const isOpen = !!(p._pokemonBinderState && p._pokemonBinderState.open);
      return { verb: isOpen ? 'Close' : 'Open', noun: 'Pokémon Binder' };
    }
  }
  return null;
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
let _skateRollNoiseBuffer = null;
let _skateRollSrc = null;
let _skateRollFilter = null;
let _skateRollGain = null;
let _skateRollLfo = null;
let _skateRollLfoGain = null;

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

function _ensureSkateRollBuffer(ac) {
  if (_skateRollNoiseBuffer && _skateRollNoiseBuffer.sampleRate === ac.sampleRate) return;
  const sr = ac.sampleRate;
  const dur = 1.25;
  const len = Math.floor(sr * dur);
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.42;
  _skateRollNoiseBuffer = buf;
}

function _ensureSkateRollAudio() {
  if (_skateRollSrc && _skateRollGain && _skateRollFilter) return _bonkAC;
  const ac = _ensureSfxAudioCtx();
  if (!ac) return null;
  _ensureSkateRollBuffer(ac);

  const src = ac.createBufferSource();
  src.buffer = _skateRollNoiseBuffer;
  src.loop = true;

  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 210;
  filter.Q.value = 0.7;

  const gain = ac.createGain();
  gain.gain.value = 0;

  const lfo = ac.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = 2.2;

  const lfoGain = ac.createGain();
  lfoGain.gain.value = 20;

  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);

  src.start();
  lfo.start();

  _skateRollSrc = src;
  _skateRollFilter = filter;
  _skateRollGain = gain;
  _skateRollLfo = lfo;
  _skateRollLfoGain = lfoGain;
  return ac;
}

function _setSkateRollTarget(speedNorm, grounded) {
  const moving = grounded && speedNorm > 0.02;
  const want = !!(fpMode && !fpPaused && skateMode && moving && !sfxMuted);

  if (!want) {
    if (_skateRollGain && _bonkAC) {
      const now = _bonkAC.currentTime;
      _skateRollGain.gain.cancelScheduledValues(now);
      _skateRollGain.gain.setTargetAtTime(0, now, 0.035);
    }
    return;
  }

  const ac = _ensureSkateRollAudio();
  if (!ac || !_skateRollGain || !_skateRollFilter || !_skateRollLfo || !_skateRollLfoGain) return;

  const n = Math.max(0, Math.min(1, speedNorm));
  const now = ac.currentTime;
  const targetGain = 0.003 + n * 0.019;
  const targetFreq = 130 + n * 300;
  const targetQ = 0.45 + n * 1.15;
  const lfoHz = 1.3 + n * 4.4;
  const wobbleDepth = 8 + n * 26;

  _skateRollGain.gain.cancelScheduledValues(now);
  _skateRollGain.gain.setTargetAtTime(targetGain, now, 0.03);

  _skateRollFilter.frequency.cancelScheduledValues(now);
  _skateRollFilter.frequency.setTargetAtTime(targetFreq, now, 0.05);

  _skateRollFilter.Q.cancelScheduledValues(now);
  _skateRollFilter.Q.setTargetAtTime(targetQ, now, 0.07);

  _skateRollLfo.frequency.cancelScheduledValues(now);
  _skateRollLfo.frequency.setTargetAtTime(lfoHz, now, 0.12);

  _skateRollLfoGain.gain.cancelScheduledValues(now);
  _skateRollLfoGain.gain.setTargetAtTime(wobbleDepth, now, 0.12);
}

function _silenceSkateRoll(immediate = false) {
  if (!_skateRollGain || !_bonkAC) return;
  const now = _bonkAC.currentTime;
  _skateRollGain.gain.cancelScheduledValues(now);
  if (immediate) _skateRollGain.gain.setValueAtTime(0, now);
  else _skateRollGain.gain.setTargetAtTime(0, now, 0.03);
}

// ── Super Saiyan audio ────────────────────────────────────────────
// Three layers, all driven from the SS update block in updatePhysics:
//   1. Charge-up hum   — rises in pitch + volume while holding past full
//                        charge, silent otherwise.
//   2. Activation burst — one-shot swoop + boom + sparkle when SS triggers.
//   3. Ambient pulse    — low sustained drone with slow LFO-driven gain
//                        wobble while SS mode is active.
let _ssChargeOsc = null, _ssChargeOsc2 = null, _ssChargeGain = null, _ssChargeFilter = null;
let _ssAmbientOsc = null, _ssAmbientOsc2 = null, _ssAmbientGain = null;
let _ssAmbientLfo = null, _ssAmbientLfoGain = null;

function _ensureSsChargeAudio() {
  if (_ssChargeOsc && _ssChargeGain) return _bonkAC;
  const ac = _ensureSfxAudioCtx();
  if (!ac) return null;
  // Two low oscillators feeding a lowpass filter — the filter cutoff opens
  // up as the charge progresses, which gives the rising "energy" feel
  // without ever getting shrill.
  const o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
  const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 82;
  o2.detune.value = -7;
  const filt = ac.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 220;
  filt.Q.value = 0.6;
  const g = ac.createGain(); g.gain.value = 0;
  o1.connect(filt); o2.connect(filt); filt.connect(g); g.connect(ac.destination);
  o1.start(); o2.start();
  _ssChargeOsc = o1; _ssChargeOsc2 = o2; _ssChargeGain = g;
  _ssChargeFilter = filt;
  return ac;
}

// progress: 0..1 across the entire post-full-charge window (MEGA + SS hold).
function _setSsChargeTarget(progress) {
  const want = !sfxMuted && progress > 0.001;
  if (!want) {
    if (_ssChargeGain && _bonkAC) {
      const now = _bonkAC.currentTime;
      _ssChargeGain.gain.cancelScheduledValues(now);
      _ssChargeGain.gain.setTargetAtTime(0, now, 0.04);
    }
    return;
  }
  const ac = _ensureSsChargeAudio();
  if (!ac || !_ssChargeGain) return;
  const now = ac.currentTime;
  const p = Math.min(1, Math.max(0, progress));
  const targetGain = 0.008 + Math.pow(p, 1.4) * 0.06;
  // Keep the fundamental low — only nudge it up a little so it doesn't
  // get whistly. The body of the rise comes from filter cutoff opening.
  const f1 = 55 + p * 35;     //  55 →  90 Hz
  const f2 = 82 + p * 50;     //  82 → 132 Hz
  const cutoff = 200 + Math.pow(p, 1.2) * 700; // 200 → ~900 Hz
  _ssChargeGain.gain.cancelScheduledValues(now);
  _ssChargeGain.gain.setTargetAtTime(targetGain, now, 0.05);
  _ssChargeOsc.frequency.cancelScheduledValues(now);
  _ssChargeOsc.frequency.setTargetAtTime(f1, now, 0.08);
  _ssChargeOsc2.frequency.cancelScheduledValues(now);
  _ssChargeOsc2.frequency.setTargetAtTime(f2, now, 0.08);
  if (_ssChargeFilter) {
    _ssChargeFilter.frequency.cancelScheduledValues(now);
    _ssChargeFilter.frequency.setTargetAtTime(cutoff, now, 0.08);
  }
}

function _silenceSsCharge(immediate = false) {
  if (!_ssChargeGain || !_bonkAC) return;
  const now = _bonkAC.currentTime;
  _ssChargeGain.gain.cancelScheduledValues(now);
  if (immediate) _ssChargeGain.gain.setValueAtTime(0, now);
  else _ssChargeGain.gain.setTargetAtTime(0, now, 0.04);
}

let _ssBurstBuffer = null;
let _ssBurstLoading = false;
const SS_BURST_URL = 'assets/Super Saiyan Transformation Sound Effect.mp3';
// Lead-time before SS activation when the transformation sample starts
// playing. The sample's climax should align with the visual pop, not lag
// behind it — most "transformation" SFX have a windup before the boom.
const SS_BURST_LEAD_MS = 430;
let _ssBurstFiredForCurrentHold = false;

function _loadSsBurstBuffer() {
  if (_ssBurstBuffer || _ssBurstLoading) return;
  const ac = _ensureSfxAudioCtx();
  if (!ac) return;
  _ssBurstLoading = true;
  fetch(SS_BURST_URL)
    .then((r) => r.ok ? r.arrayBuffer() : Promise.reject(new Error('ss burst fetch failed')))
    .then((buf) => new Promise((res, rej) => ac.decodeAudioData(buf, res, rej)))
    .then((decoded) => { _ssBurstBuffer = decoded; })
    .catch(() => { /* fall back to synth burst */ })
    .finally(() => { _ssBurstLoading = false; });
}

function _playSuperSaiyanBurst() {
  const ac = _ensureSfxAudioCtx();
  if (!ac || sfxMuted) return;

  // Prefer the real transformation sample. Kick off the load lazily on
  // first call so we don't fetch audio before the player ever needs it.
  if (!_ssBurstBuffer && !_ssBurstLoading) _loadSsBurstBuffer();

  if (_ssBurstBuffer) {
    const src = ac.createBufferSource();
    src.buffer = _ssBurstBuffer;
    const g = ac.createGain();
    g.gain.value = 0.1;
    src.connect(g).connect(ac.destination);
    src.start(ac.currentTime);
    return;
  }

  // Fallback synth burst (used until the sample finishes loading).
  const now = ac.currentTime;
  _playTone({ freq: 220, endFreq: 110, dur: 0.5, gain: 0.05, type: 'sine' });
}

function _ensureSsAmbientAudio() {
  if (_ssAmbientOsc && _ssAmbientGain) return _bonkAC;
  const ac = _ensureSfxAudioCtx();
  if (!ac) return null;
  const o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 60;
  const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 90;
  o2.detune.value = 7;
  const g = ac.createGain(); g.gain.value = 0;
  // LFO modulates the master gain for a slow energy pulse.
  const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 1.6;
  const lfoGain = ac.createGain(); lfoGain.gain.value = 0;
  o1.connect(g); o2.connect(g);
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);
  g.connect(ac.destination);
  o1.start(); o2.start(); lfo.start();
  _ssAmbientOsc = o1; _ssAmbientOsc2 = o2; _ssAmbientGain = g;
  _ssAmbientLfo = lfo; _ssAmbientLfoGain = lfoGain;
  return ac;
}

function _setSsAmbientTarget(active) {
  const want = !!active && !sfxMuted;
  if (!want) {
    if (_ssAmbientGain && _bonkAC) {
      const now = _bonkAC.currentTime;
      _ssAmbientGain.gain.cancelScheduledValues(now);
      _ssAmbientGain.gain.setTargetAtTime(0, now, 0.25);
    }
    if (_ssAmbientLfoGain && _bonkAC) {
      const now = _bonkAC.currentTime;
      _ssAmbientLfoGain.gain.cancelScheduledValues(now);
      _ssAmbientLfoGain.gain.setTargetAtTime(0, now, 0.25);
    }
    return;
  }
  const ac = _ensureSsAmbientAudio();
  if (!ac || !_ssAmbientGain) return;
  const now = ac.currentTime;
  _ssAmbientGain.gain.cancelScheduledValues(now);
  _ssAmbientGain.gain.setTargetAtTime(0.022, now, 0.4);
  _ssAmbientLfoGain.gain.cancelScheduledValues(now);
  _ssAmbientLfoGain.gain.setTargetAtTime(0.014, now, 0.5);
}

function _silenceSsAudio(immediate = false) {
  _silenceSsCharge(immediate);
  if (_ssAmbientGain && _bonkAC) {
    const now = _bonkAC.currentTime;
    _ssAmbientGain.gain.cancelScheduledValues(now);
    if (immediate) _ssAmbientGain.gain.setValueAtTime(0, now);
    else _ssAmbientGain.gain.setTargetAtTime(0, now, 0.1);
  }
  if (_ssAmbientLfoGain && _bonkAC) {
    const now = _bonkAC.currentTime;
    _ssAmbientLfoGain.gain.cancelScheduledValues(now);
    if (immediate) _ssAmbientLfoGain.gain.setValueAtTime(0, now);
    else _ssAmbientLfoGain.gain.setTargetAtTime(0, now, 0.1);
  }
}

function _ensureSkateboardAnchor() {
  if (_skateboardAnchor || !_catGroup) return;
  _skateboardAnchor = new THREE.Group();
  // ZXY order means rotations are applied to vertices Y → X → Z. So
  // the anchor's yaw (.y, which orients the board's long axis to +Z)
  // happens first, then any pitch (.x = nose up/down), then roll (.z =
  // rotation about the post-yaw forward axis = a real kickflip).
  _skateboardAnchor.rotation.order = 'ZXY';
  _skateboardAnchor.visible = false;
  _catGroup.add(_skateboardAnchor);
}

function _syncSkateboardVisualState() {
  if (!_skateboardAnchor) return;
  _skateboardAnchor.visible = !!(fpMode && fpCamMode === 'third' && skateMode && _skateboardModel);
}

function _useForwardSkatePoseForModel() {
  const key = String(catAppearance.catModelKey || '').toLowerCase();
  return key === 'classic' || key === 'toon' || key === 'korra';
}

// How high each model is lifted above the skateboard (Y-axis).
function _getSkateLiftTrimForModel() {
  const key = String(catAppearance.catModelKey || '').toLowerCase();
  switch (key) {
    case 'classic': return 0.95;
    case 'toon': return 0;
    case 'totodile': return 0.44;
    case 'bababooey': return 0.9;
    default: return 1.0;
  }
}

// How far forward/back the board is shifted under the model (Z-axis).
function _getSkateBoardZTrimForModel() {
  const key = String(catAppearance.catModelKey || '').toLowerCase();
  if (key === 'bababooey') return 1.08;
  if (key === 'totodile') return -0.5;
  return 0;
}

function _sampleSkateFootAnchor(out = _skateFootAnchor) {
  if (!_catGroup || !catAnimation.catModel) return false;
  const primary = [];
  const secondary = [];
  _skateFootPoints.length = 0;

  catAnimation.catModel.updateMatrixWorld(true);
  catAnimation.catModel.traverse((o) => {
    if (!o || !o.isBone) return;
    const name = String(o.name || '');
    const isPrimary = /foot|paw/i.test(name);
    const isSecondary = /toe/i.test(name);
    if (!isPrimary && !isSecondary) return;
    o.getWorldPosition(_skateFootTmp);
    _catGroup.worldToLocal(_skateFootTmp);
    const p = _skateFootTmp.clone();
    if (isPrimary) primary.push(p);
    else secondary.push(p);
  });

  if (primary.length >= 2) _skateFootPoints.push(...primary);
  else _skateFootPoints.push(...primary, ...secondary);

  if (_skateFootPoints.length < 2) return false;

  _skateFootPoints.sort((a, b) => a.y - b.y);
  const midIdx = Math.floor((_skateFootPoints.length - 1) * 0.5);
  const refY = _skateFootPoints[midIdx].y;
  const footY = refY + 0.055;

  const yBand = 0.42;
  let sumX = 0;
  let sumZ = 0;
  let count = 0;

  for (const p of _skateFootPoints) {
    if (Math.abs(p.y - refY) > yBand) continue;
    sumX += p.x;
    sumZ += p.z;
    count++;
  }

  if (count < 1) {
    sumX = 0;
    sumZ = 0;
    count = _skateFootPoints.length;
    for (const p of _skateFootPoints) {
      sumX += p.x;
      sumZ += p.z;
    }
  }

  if (count <= 0) return false;
  out.set(sumX / count, footY, sumZ / count);
  return true;
}

function _fitSkateboardToCat(force = false) {
  if (!_skateboardAnchor || !_skateboardModel || !_catGroup || !catAnimation.catModel) return;
  if (!force && _skateboardFitCatModel === catAnimation.catModel) return;

  catAnimation.catModel.updateMatrixWorld(true);
  _skateboardBounds.setFromObject(catAnimation.catModel);
  if (_skateboardBounds.isEmpty()) return;

  const catLen = Math.max(
    _skateboardBounds.max.x - _skateboardBounds.min.x,
    _skateboardBounds.max.z - _skateboardBounds.min.z
  );
  const targetLen = Math.max(0.1, catLen * 1.24);
  const boardScale = Math.max(0.18, Math.min(6, targetLen / Math.max(0.001, _skateboardNativeLen)));
  _skateboardModel.scale.setScalar(boardScale);
  const boardTopLocalY = Math.max(0.001, _skateboardSize.y * boardScale);

  _skateboardBounds.getCenter(_skateboardCenter);
  _skateboardFloorPoint.set(_skateboardCenter.x, _skateboardBounds.min.y, _skateboardCenter.z);
  _catGroup.worldToLocal(_skateboardCenter);
  _catGroup.worldToLocal(_skateboardFloorPoint);
  const boardVisibleMinY = Math.max(0.008, _skateboardFloorPoint.y + 0.008);
  const skateFootClearance = 0.01;

  let anchorX = _skateboardCenter.x;
  let anchorY = boardVisibleMinY;
  let anchorZ = _skateboardCenter.z;
  let targetModelLift = skateMode ? _getSkateLiftTrimForModel() : 0;

  if (_sampleSkateFootAnchor()) {
    const unclampedAnchorY = _skateFootAnchor.y - boardTopLocalY - skateFootClearance;
    const floorDeficit = Math.max(0, boardVisibleMinY - unclampedAnchorY);
    targetModelLift += floorDeficit;
    anchorX = _skateFootAnchor.x;
    anchorY = unclampedAnchorY;
    anchorZ = _skateFootAnchor.z;
  }

  anchorZ += _getSkateBoardZTrimForModel();
  anchorY = Math.max(boardVisibleMinY, anchorY);

  targetModelLift = Math.max(0, Math.min(2.4, targetModelLift));
  const liftEase = force ? 1 : 0.55;
  _skateModelLift += (targetModelLift - _skateModelLift) * liftEase;

  _skateboardAnchor.position.set(
    anchorX,
    anchorY,
    anchorZ
  );
  _skateboardAnchor.rotation.set(0, _skateboardBaseYaw, 0);
  _skateboardFitCatModel = catAnimation.catModel;
}

// ── Pickup skateboard (collectible in the office) ───────────────────
let _pickupSkateboardMesh = null;
let _pickupSkateboardLoaded = false;
let _pickupBobPhase = 0;

function _spawnPickupSkateboard() {
  if (_pickupSkateboardLoaded || skateboardFound || !_scene) return;
  _pickupSkateboardLoaded = true;

  const loader = new GLTFLoader();
  loader.load('assets/skateboard.glb', (gltf) => {
    if (skateboardFound) return;
    const root = gltf?.scene;
    if (!root) return;

    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o._isPickupSkateboard = true;
      if (o.material && o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    });

    root.scale.setScalar(1.1);

    // Place inside the office closet (bypass sliding door closet).
    // World coords (room is mirrored on X): X≈-87..-51, Z≈-14..32.
    const fy = getFloorY();
    const placeX = -69;    // mid-closet depth (world X)
    const placeY = fy + 5;
    const placeZ = 9;      // office closet center Z

    root.position.set(placeX, placeY, placeZ);
    root.rotation.set(0, Math.PI * 0.3, Math.PI * 0.12);

    root._isPickupSkateboard = true;
    _pickupSkateboardMesh = root;
    _scene.add(root);

    // Sparkle glow — soft point light + orbiting sprite particles
    const glowGroup = new THREE.Group();
    glowGroup.position.copy(root.position);
    glowGroup.position.y += 3;
    _scene.add(glowGroup);
    root._glowGroup = glowGroup;

    // Soft blue point light
    const glow = new THREE.PointLight(0x60aaff, 120, 40, 2);
    glow.position.set(0, 1, 0);
    glowGroup.add(glow);

    // Sparkle sprites
    const sparkleMat = new THREE.SpriteMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkles = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(sparkleMat);
      s.scale.setScalar(0.5 + Math.random() * 0.4);
      s._phase = (i / 8) * Math.PI * 2;
      s._radius = 3 + Math.random() * 2;
      s._yOff = Math.random() * 3 - 0.5;
      s._speed = 0.8 + Math.random() * 0.6;
      glowGroup.add(s);
      sparkles.push(s);
    }
    root._sparkles = sparkles;

    // Add to interactive objects so crosshair highlights it
    root.traverse((o) => {
      if (o.isMesh) _interactiveObjects.push(o);
    });
  }, undefined, (err) => {
    console.warn('[game-fp] Pickup skateboard failed to load', err);
  });
}

export function collectPickupSkateboard() {
  _collectPickupSkateboard();
}
window._collectPickupSkateboard = collectPickupSkateboard;

function _collectPickupSkateboard() {
  if (skateboardFound || !_pickupSkateboardMesh) return;

  // Remove sparkle glow
  if (_pickupSkateboardMesh._glowGroup) {
    _scene.remove(_pickupSkateboardMesh._glowGroup);
  }

  // Remove from interactive objects
  _pickupSkateboardMesh.traverse((o) => {
    if (o.isMesh) {
      const idx = _interactiveObjects.indexOf(o);
      if (idx >= 0) _interactiveObjects.splice(idx, 1);
    }
  });
  _scene.remove(_pickupSkateboardMesh);
  _pickupSkateboardMesh = null;

  markSkateboardFound();
  _playPickupSfx();

  // First-time pickup gets the full onboarding modal; subsequent loads
  // (e.g., from a localStorage-cleared dev session) just toast.
  let seenOnboarding = false;
  try { seenOnboarding = localStorage.getItem(SKATE_ONBOARDING_KEY) === '1'; } catch (e) { }
  if (seenOnboarding) {
    if (_showToast) _showToast('Skateboard found! Skate mode unlocked! Press K or toggle in pause menu.');
  } else {
    _showSkateOnboarding();
  }
}

// ── Skateboard onboarding overlay (one-time) ──────────────────────────
const SKATE_ONBOARDING_KEY = 'diy_skate_onboarding_seen';
let _skateOnboardingOpen = false;
let _skateOnboardingFocusTrap = null;
let _skateOnboardingSavedFocus = null;

function _showSkateOnboarding(force = false) {
  try {
    if (!force && localStorage.getItem(SKATE_ONBOARDING_KEY) === '1') return;
  } catch (e) { /* ignore */ }
  const overlay = document.getElementById('fpSkateOnboarding');
  if (!overlay) return;
  _skateOnboardingOpen = true;
  overlay.style.display = 'flex';
  // Pause the game while the onboarding is up so input doesn't leak through.
  setPaused(true);
  // Hide the regular pause overlay — onboarding takes precedence.
  const pause = document.getElementById('fpPauseOverlay');
  if (pause) pause.style.display = 'none';
  _skateOnboardingSavedFocus = saveFocus();
  _skateOnboardingFocusTrap = trapFocus(overlay);
  const closeBtn = overlay.querySelector('#fpSkateOnboardingClose');
  if (closeBtn) requestAnimationFrame(() => closeBtn.focus());
}

function _closeSkateOnboarding() {
  if (!_skateOnboardingOpen) return;
  _skateOnboardingOpen = false;
  const overlay = document.getElementById('fpSkateOnboarding');
  if (overlay) overlay.style.display = 'none';
  if (_skateOnboardingFocusTrap) { _skateOnboardingFocusTrap.release(); _skateOnboardingFocusTrap = null; }
  if (_skateOnboardingSavedFocus) { _skateOnboardingSavedFocus.restore(); _skateOnboardingSavedFocus = null; }
  try { localStorage.setItem(SKATE_ONBOARDING_KEY, '1'); } catch (e) { /* ignore */ }
  // Resume back into the game.
  setPaused(false);
}
window._closeSkateOnboarding = _closeSkateOnboarding;
export function isSkateOnboardingOpen() { return _skateOnboardingOpen; }

function _playPickupSfx() {
  const ac = _ensureSfxAudioCtx();
  if (!ac || sfxMuted) return;
  const notes = [523, 659, 784]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const delay = i * 0.1;
    const now = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.04, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(g).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  });
}

function _updatePickupSkateboardBob(dtSec) {
  if (!_pickupSkateboardMesh || skateboardFound) return;
  _pickupBobPhase += dtSec * 2.5;
  const fy = getFloorY();
  _pickupSkateboardMesh.position.y = fy + 5 + Math.sin(_pickupBobPhase) * 0.5;

  // Glow stays at ground level
  const g = _pickupSkateboardMesh._glowGroup;
  if (g) {
    g.position.x = _pickupSkateboardMesh.position.x;
    g.position.y = fy + 5;
    g.position.z = _pickupSkateboardMesh.position.z;
  }
  const sparkles = _pickupSkateboardMesh._sparkles;
  if (sparkles) {
    const t = _pickupBobPhase;
    for (const s of sparkles) {
      const angle = s._phase + t * s._speed;
      s.position.set(
        Math.cos(angle) * s._radius,
        s._yOff + Math.sin(t * 1.5 + s._phase) * 1.2,
        Math.sin(angle) * s._radius
      );
      s.material.opacity = 0.45 + 0.4 * Math.sin(t * 3 + s._phase);
      s.scale.setScalar(0.3 + 0.35 * Math.sin(t * 2.5 + s._phase * 2));
    }
  }
}

function _initSkateboard() {
  if (_skateboardLoadStarted) return;
  _skateboardLoadStarted = true;
  _ensureSkateboardAnchor();

  const loader = new GLTFLoader();
  loader.load('assets/skateboard.glb', (gltf) => {
    if (!_skateboardAnchor) return;
    const boardRoot = gltf?.scene;
    if (!boardRoot) return;

    // Normalize local pivot: center X/Z and pin bottom to local Y=0.
    _skateboardBounds.setFromObject(boardRoot);
    _skateboardBounds.getCenter(_skateboardCenter);
    boardRoot.position.x -= _skateboardCenter.x;
    boardRoot.position.z -= _skateboardCenter.z;
    boardRoot.position.y -= _skateboardBounds.min.y;

    boardRoot.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      if (o.material && o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    });

    _skateboardBounds.setFromObject(boardRoot);
    _skateboardBounds.getSize(_skateboardSize);
    const lenX = _skateboardSize.x;
    const lenZ = _skateboardSize.z;
    _skateboardNativeLen = Math.max(0.001, Math.max(lenX, lenZ));
    _skateboardBaseYaw = lenX >= lenZ ? (Math.PI * 0.5) : 0;

    _skateboardModel = boardRoot;
    _skateboardAnchor.add(_skateboardModel);
    _skateboardFitCatModel = null;
    _fitSkateboardToCat(true);
    _syncSkateboardVisualState();
  }, undefined, (err) => {
    console.warn('[game-fp] Skateboard model failed to load', err);
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
  _markShadowsDirty = refs.markShadowsDirty || (() => { });
  _showToast = refs.showToast || (() => { });
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
      obj._isDrawer || obj._isBifoldLeaf || obj._isBypassPanel || obj._isCornerDoorHandle || obj._isCornerDoor || obj._isWindow || obj._isWindowPane ||
      obj._isMacbook || obj._isTV || obj._isFoodBowl ||
      obj._isGuestDoor || obj._isGuestDoorHandle || obj._isPickupSkateboard || obj._isPokemonBinder) {
      _interactiveObjects.push(obj);
    }
  });

  // Bind input
  _bindInputs();
  _syncAudioToggleUi();
  _syncSkateToggleUi();
  _initSkateboard();
  _spawnPickupSkateboard();
  _syncSkateboardVisualState();
}

/**
 * Pre-warm the Super Saiyan effect chain so first activation in a run
 * doesn't cause a shader-recompile stutter.
 *
 * What causes the stutter: lazy-creating the SS PointLight adds an active
 * light to the scene, which changes the WebGL shader light count and
 * forces Three.js to recompile every PBR material's program. Same for the
 * 12+ additive sparkle materials — each fresh material is a new shader
 * key. Doing this work up-front while the scene is already idle avoids
 * a 100–300ms hitch during gameplay.
 *
 * Call once after gameFp.init() and before the first frame.
 */
export function prewarmSuperSaiyan() {
  _ensureSuperSaiyanAura();
  _ensureSuperSaiyanEnvLight();
  _loadSsBurstBuffer();
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

  // Right wall solid portions (flanking closet opening and guest door)
  // Guest door opening spans Z=34..66 (pre-mirror). The wall segment after
  // the closet must stop at the guest door, with only a header above it.
  const _guestDoorZmin = 34, _guestDoorZmax = 66, _guestDoorH = 68;
  _staticBoxes.push(
    // Before closet opening
    { xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: OPP_WALL_Z, zMax: CLOSET_Z - CLOSET_W / 2, yTop: fy + WALL_HEIGHT, room: true },
    // After closet opening, before guest door
    { xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: CLOSET_Z + CLOSET_W / 2, zMax: _guestDoorZmin, yTop: fy + WALL_HEIGHT, room: true },
    // Header above guest door (bedroom side, Z=34..49)
    {
      xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: _guestDoorZmin, zMax: 49,
      yBottom: fy + _guestDoorH, yTop: fy + WALL_HEIGHT, room: true
    }
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

  // Office closet +Z side wall (Z=32 pre-mirror, separates closet from guest door area)
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + CLOSET_DEPTH), xMax: -(SIDE_WALL_X + 0.5),
    zMin: 32 - 0.25, zMax: 32 + 0.25,
    yTop: fy + WALL_HEIGHT, room: true
  });

  // Office closet front wall header (above bypass door opening, X=87)
  // extHeader: 0.5 thick, headerH=14 tall, _bypassOpenW=46 wide
  // Position: X=87, Y=floorY+66+7, Z=9
  {
    const bpZmin = -14, bpZmax = 32, bpCenterZ = 9;
    const bpH = 66; // bypass door height
    _staticBoxes.push({
      xMin: -(SIDE_WALL_X + CLOSET_DEPTH + 0.25), xMax: -(SIDE_WALL_X + CLOSET_DEPTH - 0.25),
      zMin: bpZmin, zMax: bpZmax,
      yTop: fy + WALL_HEIGHT, yBottom: fy + bpH, room: true
    });

    // Office closet shelf (against back wall at X≈58.6)
    const bpShelfDepth = 14;
    const bpShelfCX = SIDE_WALL_X + 0.5 + 0.1 + bpShelfDepth / 2; // 58.6
    const bpShelfLen = (bpZmax - bpZmin) - 1; // 45
    const bpShelfY = fy + WALL_HEIGHT - 24; // fy + 56
    _staticBoxes.push({
      xMin: -(bpShelfCX + bpShelfDepth / 2), xMax: -(bpShelfCX - bpShelfDepth / 2),
      zMin: bpCenterZ - bpShelfLen / 2, zMax: bpCenterZ + bpShelfLen / 2,
      yTop: bpShelfY + 0.4, yBottom: bpShelfY - 0.4, room: true
    });

    // Office closet shelf dividers (3 dividers)
    const divThick = 0.6;
    const divBotY = bpShelfY + 0.4;
    const divTopY = fy + WALL_HEIGHT - 0.5;
    const shelfZmin = bpCenterZ - bpShelfLen / 2;
    for (let i = 1; i <= 3; i++) {
      const zC = shelfZmin + (bpShelfLen * i / 4);
      _staticBoxes.push({
        xMin: -(bpShelfCX + bpShelfDepth / 2), xMax: -(bpShelfCX - bpShelfDepth / 2),
        zMin: zC - divThick / 2, zMax: zC + divThick / 2,
        yTop: divTopY, yBottom: divBotY, room: true
      });
    }

    // Office closet clothes rod (at innerCx=69.5, Y=fy+50)
    const rodCx = SIDE_WALL_X + 0.5 + CLOSET_DEPTH / 2; // 69.5 (approx)
    _staticBoxes.push({
      xMin: -(rodCx + 0.4), xMax: -(rodCx - 0.4),
      zMin: bpCenterZ - (bpShelfLen - 1) / 2, zMax: bpCenterZ + (bpShelfLen - 1) / 2,
      yTop: fy + WALL_HEIGHT - 30 + 0.4, yBottom: fy + WALL_HEIGHT - 30 - 0.4, room: true
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
      xMin: -(bCX + bxW / 2), xMax: -(bCX - bxW / 2),
      zMin: fZ - bxD / 2, zMax: fZ + bxD / 2,
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
    {
      xMin: -47, xMax: -15, zMin: 28.75, zMax: 29.25,
      yBottom: fy + 68, yTop: fy + WALL_HEIGHT, room: true
    }
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
    // -X side wall of hallway (continuous — no office door split)
    { xMin: -11, xMax: -10.5, zMin: hzStart, zMax: hzEnd, yTop: fy + WALL_HEIGHT, room: true },
    // +X side wall of hallway — split around guest doorway (Z=34..66)
    // Guest door opening starts before hallway (Z=34), hallway starts at Z=49,
    // so the gap in the hallway wall is Z=49..66. No "before" segment needed.
    // Segment after doorway (Z=66..289)
    { xMin: -51.5, xMax: -51, zMin: 66, zMax: hzEnd, yTop: fy + WALL_HEIGHT, room: true },
    // Header above guest doorway (Y=68..ceiling, Z=49..66)
    {
      xMin: -51.5, xMax: -51, zMin: hzStart, zMax: 66,
      yBottom: fy + 68, yTop: fy + WALL_HEIGHT, room: true
    },
    // End wall at Z=_hallZEnd
    { xMin: -51.5, xMax: -10.5, zMin: hzEnd, zMax: hzEnd + 0.5, yTop: fy + WALL_HEIGHT, room: true }
  );

  // ── Guest room furniture collision ──
  // Desk against the +X far wall (pre-mirror X≈164, Z≈27)
  // 84"W × 30"D × 30"H, flush against LEFT (+Z) wall
  {
    const deskW = 84, deskD = 30;
    const deskX = 183 - 4 - deskD / 2; // 164 pre-mirror
    const deskZ = 69 - deskW / 2;       // 27, flush against LEFT wall
    const deskSurface = fy + 30;         // leg height (28) + top slab (1.5) ≈ 30
    // Desk body — standable surface
    _staticBoxes.push({
      xMin: -(deskX + deskD / 2), xMax: -(deskX - deskD / 2),
      zMin: deskZ - deskW / 2, zMax: deskZ + deskW / 2,
      yTop: deskSurface, yBottom: fy, room: true
    });
    // ── Monitor collision — 3 OLED monitors with angled side hitboxes ──
    // Dimensions match room.js: 24"W × 14"H × 0.5"D each, on 6" arms
    const monW = 24, monD = 0.5, monH = 14, monStandH = 6;
    const monBaseX = deskX + deskD / 2 - 5; // 174 pre-mirror (near wall)
    const monYBot = deskSurface + monStandH; // bottom of screen
    const monYTop = monYBot + monH;          // top of screen
    const monPad = 1; // collision padding

    // Center monitor — axis-aligned, tight AABB
    _staticBoxes.push({
      xMin: -(monBaseX + monD / 2 + monPad), xMax: -(monBaseX - monD / 2 - monPad),
      zMin: deskZ - monW / 2, zMax: deskZ + monW / 2,
      yTop: monYTop, yBottom: monYBot, room: true
    });

    // Angled side monitors — 3 AABB strips each to approximate rotation
    const monAngle = 0.6; // radians (~34°), matches room.js monSideAngle
    const cosA = Math.cos(monAngle), sinA = Math.sin(monAngle);
    const stripW = monW / 3; // 8" per strip
    const stripHalfD = (monD * cosA + stripW * sinA) / 2 + monPad;
    const stripHalfW = (monD * sinA + stripW * cosA) / 2;

    // Left monitor: pre-mirror center (monBaseX-8, _, deskZ - monW + 2)
    const lMonX = monBaseX - 8, lMonZ = deskZ - monW + 2;
    // Right monitor: pre-mirror center (monBaseX-8, _, deskZ + monW - 2)
    const rMonX = monBaseX - 8, rMonZ = deskZ + monW - 2;

    for (const localZ of [-stripW, 0, stripW]) {
      // Left monitor strips (rotY = +0.4)
      const lx = lMonX + localZ * sinA;
      const lz = lMonZ + localZ * cosA;
      _staticBoxes.push({
        xMin: -(lx + stripHalfD), xMax: -(lx - stripHalfD),
        zMin: lz - stripHalfW, zMax: lz + stripHalfW,
        yTop: monYTop, yBottom: monYBot, room: true
      });
      // Right monitor strips (rotY = -0.4, sinA negated)
      const rx = rMonX - localZ * sinA;
      const rz = rMonZ + localZ * cosA;
      _staticBoxes.push({
        xMin: -(rx + stripHalfD), xMax: -(rx - stripHalfD),
        zMin: rz - stripHalfW, zMax: rz + stripHalfW,
        yTop: monYTop, yBottom: monYBot, room: true
      });
    }

    // Monitor arm posts (thin 1.5" collision pillars between desk and screens)
    for (const mz of [deskZ, lMonZ, rMonZ]) {
      _staticBoxes.push({
        xMin: -(monBaseX + 1), xMax: -(monBaseX - 1),
        zMin: mz - 1, zMax: mz + 1,
        yTop: monYBot, yBottom: deskSurface, room: true
      });
    }
  }
  // Thorzone Nanoq R PC case on desk (left side, pre-mirror Z≈57, on desk surface)
  {
    const pcD = 13.4, pcW = 6.7, pcH = 9.8;
    const pcX = 164 + 30 / 2 - 13.4 / 2 - 1; // pushed near wall edge (deskD=30)
    const pcZ = 27 + 24 + 6;
    const pcBot = fy + 30;
    _staticBoxes.push({
      xMin: -(pcX + pcD / 2), xMax: -(pcX - pcD / 2),
      zMin: pcZ - pcW / 2, zMax: pcZ + pcW / 2,
      yTop: pcBot + pcH, yBottom: pcBot, room: true
    });
  }

  // ── Guest room walls (behind the hallway's +X door) ──
  // Pre-mirror footprint X=51..183, Z=-78..69. Shares the bedroom's TV wall
  // (oppWallZ=-78) as its -Z boundary and the hallway right wall as its -X
  // wall (already in _staticBoxes). We only collide the three new walls here.
  // World X = -183..-51 after mirror.
  {
    const gXmin = 51, gXmax = 183, gZmin = -78, gZmax = 69;
    const wh = WALL_HEIGHT;

    // Far wall — split into 4 pieces around the window opening so the player
    // can jump through when the office window is open.
    const gwB = _roomRefs ? _roomRefs.grWinBottom : fy + 23;
    const gwT = _roomRefs ? _roomRefs.grWinTop : fy + 73;
    const gwL = _roomRefs ? _roomRefs.grWinLeft : -22;   // -Z edge of window
    const gwR = _roomRefs ? _roomRefs.grWinRight : 14;    // +Z edge of window

    _staticBoxes.push(
      // Below window: full Z, yard level → window bottom (extended below
      // floor so the player can't crawl underneath from the outdoor lawn).
      { xMin: -gXmax - 0.5, xMax: -gXmax, zMin: gZmin - 0.5, zMax: gZmax + 0.5, yTop: gwB, yBottom: fy - 60, room: true },
      // Above window: full Z, window top → ceiling
      { xMin: -gXmax - 0.5, xMax: -gXmax, zMin: gZmin - 0.5, zMax: gZmax + 0.5, yTop: fy + wh, yBottom: gwT, room: true },
      // Left of window (toward -Z / TV wall side)
      { xMin: -gXmax - 0.5, xMax: -gXmax, zMin: gZmin - 0.5, zMax: gwL, yTop: gwT, yBottom: gwB, room: true },
      // Right of window (toward +Z / left wall side)
      { xMin: -gXmax - 0.5, xMax: -gXmax, zMin: gwR, zMax: gZmax + 0.5, yTop: gwT, yBottom: gwB, room: true },
      // -Z wall (TV wall extension, pre-mirror Z=-78)
      { xMin: -gXmax, xMax: -gXmin, zMin: gZmin - 0.5, zMax: gZmin, yTop: fy + wh, room: true },
      // +Z wall (LEFT wall, pre-mirror Z=69)
      { xMin: -gXmax, xMax: -gXmin, zMin: gZmax, zMax: gZmax + 0.5, yTop: fy + wh, room: true }
    );

    // ── Outdoor terrain (around the entire house) ──
    // Lawn sits ~3' below the office window sill. There is no outer fence;
    // the player can roam to the bounds defined by boundsBase. Slopes are
    // sampled by _sampleOutdoorGroundY(), not stair-stepped here.
    const sillY = gwB - 36;
    const dropDY = -18;
    const flatY = sillY + dropDY;
    const yardBottom = flatY - 50;

    // Bedroom window-wall (post-mirror world X = +81). Splits around the
    // bedroom window so the player can see through but not walk through.
    // Extended below floorY so it blocks at the lower lawn level too.
    const bedWinB = fy + 23;
    const bedWinT = fy + 73;
    const bedWinCZ = 7.35;          // BED_Z from spatial.js
    const bedWinHalfW = 18;         // WIN_W=36 / 2
    const bedWinFront = bedWinCZ - bedWinHalfW;
    const bedWinBack = bedWinCZ + bedWinHalfW;
    const bedZmin = -78, bedZmax = 49;
    const bedWallX = 81;
    _staticBoxes.push(
      {
        xMin: bedWallX, xMax: bedWallX + 0.5, zMin: bedZmin - 0.5, zMax: bedZmax + 0.5,
        yTop: bedWinB, yBottom: yardBottom, room: true
      },
      {
        xMin: bedWallX, xMax: bedWallX + 0.5, zMin: bedZmin - 0.5, zMax: bedZmax + 0.5,
        yTop: fy + wh, yBottom: bedWinT, room: true
      },
      {
        xMin: bedWallX, xMax: bedWallX + 0.5, zMin: bedZmin - 0.5, zMax: bedWinFront,
        yTop: bedWinT, yBottom: bedWinB, room: true
      },
      {
        xMin: bedWallX, xMax: bedWallX + 0.5, zMin: bedWinBack, zMax: bedZmax + 0.5,
        yTop: bedWinT, yBottom: bedWinB, room: true
      },
      // Bedroom window opening — the bedroom window is not openable, so
      // close off the gap between the four surrounding wall pieces.
      {
        xMin: bedWallX, xMax: bedWallX + 0.5, zMin: bedWinFront, zMax: bedWinBack,
        yTop: bedWinT, yBottom: bedWinB, room: true
      }
    );

    // Exterior sill ledge — small standable box outside the office window
    // for re-entry from the lawn.
    _staticBoxes.push({
      xMin: -(gXmax + 2), xMax: -(gXmax), zMin: gwL, zMax: gwR,
      yTop: gwB, yBottom: gwB - 1, room: true
    });
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

// ── Smooth outdoor terrain ground sampling ─────────────────────────
// Returns the world-space Y of the lawn/road surface at the given world X/Z.
// The slope/incline/road shaping only exists in front of the office window
// (negative world X, within the front-yard Z extent). Everywhere else
// around the house the lawn is flat at flatY so the player can walk freely
// in any direction.
function _sampleOutdoorGroundY(worldX, worldZ) {
  const px = -worldX; // pre-mirror X (positive)
  const fy = getFloorY();
  const gwB = (_roomRefs && typeof _roomRefs.grWinBottom === 'number') ? _roomRefs.grWinBottom : (fy + 23);
  const gwL = (_roomRefs && typeof _roomRefs.grWinLeft === 'number') ? _roomRefs.grWinLeft : -22;
  const gwR = (_roomRefs && typeof _roomRefs.grWinRight === 'number') ? _roomRefs.grWinRight : 14;
  const sillY = gwB - 36;
  const dropStartX = 183.5, dropEndX = 255, flatEndX = 375, incEndX = 411;
  const dropDY = -18, incDY = 12;
  const flatY = sillY + dropDY;
  const roadY = flatY + incDY;
  // If we're not in front of the office window (negative world X past the
  // front wall) OR not within the front-yard Z extent, the ground is just
  // the flat lawn at flatY.
  const frontYardZmin = (gwL + gwR) / 2 - 300;
  const frontYardZmax = (gwL + gwR) / 2 + 300;
  const inFrontYardZ = (worldZ === undefined) ? true : (worldZ >= frontYardZmin && worldZ <= frontYardZmax);
  if (px <= dropStartX || !inFrontYardZ) return flatY;
  if (px <= dropEndX) {
    const t = (px - dropStartX) / (dropEndX - dropStartX);
    return sillY + t * dropDY;
  }
  if (px <= flatEndX) return flatY;
  if (px <= incEndX) {
    const t = (px - flatEndX) / (incEndX - flatEndX);
    return flatY + t * incDY;
  }
  return roadY;
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

  // Bypass sliding closet doors — dynamic AABB collision (translation only).
  if (window._bypassDoorsRef) {
    const fy = getFloorY();
    for (const panel of window._bypassDoorsRef) {
      if (!panel) continue;
      panel.updateWorldMatrix(true, false);
      const wx = panel.matrixWorld.elements[12];
      const wz = panel.matrixWorld.elements[14];
      const pH = 65.5;
      const pW = 25;   // _bypassPanelW
      const pT = 1.0;  // _bypassPanelThick
      result.push({
        xMin: wx - pT / 2 - 0.3, xMax: wx + pT / 2 + 0.3,
        zMin: wz - pW / 2, zMax: wz + pW / 2,
        yTop: fy + pH, yBottom: fy, room: true
      });
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

  // Office window — when closed, block the window opening so the player can't pass through.
  if (_roomRefs && !_roomRefs.isOfficeWindowOpen()) {
    const gwB = _roomRefs.grWinBottom;
    const gwT = _roomRefs.grWinTop;
    const gwL = _roomRefs.grWinLeft;
    const gwR = _roomRefs.grWinRight;
    result.push({
      xMin: -183.5, xMax: -183,
      zMin: gwL, zMax: gwR,
      yTop: gwT, yBottom: gwB,
      room: true
    });
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

  // ── Standing desk (rises with sd.rise) ──
  // Desktop, monitors, monitor arm posts, and PC case all lift together.
  // The two leg posts telescope (top tracks desktop, bottom anchored on
  // floor). Geometry mirrors the static block we previously had — every
  // yTop / yBottom above the floor gets offset by sd.rise.
  if (_roomRefs && _roomRefs.standingDesk) {
    const sd = _roomRefs.standingDesk;
    const rise = sd.rise || 0;
    const fy = getFloorY();
    const deskW = sd.deskW != null ? sd.deskW : 84;
    const deskD = sd.deskD != null ? sd.deskD : 30;
    const deskX = sd.deskX != null ? sd.deskX : 164;     // pre-mirror
    const deskZ = sd.deskZ != null ? sd.deskZ : 27;
    const deskLegH = sd.deskLegH != null ? sd.deskLegH : 28;
    const deskTopH = sd.deskTopH != null ? sd.deskTopH : 1.5;
    const deskSurface = fy + deskLegH + deskTopH + rise;
    // Desktop slab — standable; walk-under clearance below.
    result.push({
      xMin: -(deskX + deskD / 2), xMax: -(deskX - deskD / 2),
      zMin: deskZ - deskW / 2, zMax: deskZ + deskW / 2,
      yTop: deskSurface, yBottom: fy + deskLegH + rise
    });
    // Two telescoping leg posts (3" thick) — top rises with desk, bottom
    // stays on floor.
    for (const legSide of [-1, 1]) {
      const legZ = deskZ + legSide * (deskW / 2 - 4);
      result.push({
        xMin: -(deskX + 1.5), xMax: -(deskX - 1.5),
        zMin: legZ - 1.5, zMax: legZ + 1.5,
        yTop: fy + deskLegH + rise, yBottom: fy
      });
    }
    // Monitor hitboxes — 3 OLED monitors on 6" arms.
    const monW = 24, monD = 0.5, monH = 14, monStandH = 6;
    const monBaseX = deskX + deskD / 2 - 5;
    const monYBot = deskSurface + monStandH;
    const monYTop = monYBot + monH;
    const monPad = 1;
    // Center monitor (axis-aligned)
    result.push({
      xMin: -(monBaseX + monD / 2 + monPad), xMax: -(monBaseX - monD / 2 - monPad),
      zMin: deskZ - monW / 2, zMax: deskZ + monW / 2,
      yTop: monYTop, yBottom: monYBot
    });
    // Angled side monitors approximated as 3 AABB strips each
    const monAngle = 0.6;
    const cosA = Math.cos(monAngle), sinA = Math.sin(monAngle);
    const stripW = monW / 3;
    const stripHalfD = (monD * cosA + stripW * sinA) / 2 + monPad;
    const stripHalfW = (monD * sinA + stripW * cosA) / 2;
    const lMonX = monBaseX - 8, lMonZ = deskZ - monW + 2;
    const rMonX = monBaseX - 8, rMonZ = deskZ + monW - 2;
    for (const localZ of [-stripW, 0, stripW]) {
      const lx = lMonX + localZ * sinA;
      const lz = lMonZ + localZ * cosA;
      result.push({
        xMin: -(lx + stripHalfD), xMax: -(lx - stripHalfD),
        zMin: lz - stripHalfW, zMax: lz + stripHalfW,
        yTop: monYTop, yBottom: monYBot
      });
      const rx = rMonX - localZ * sinA;
      const rz = rMonZ + localZ * cosA;
      result.push({
        xMin: -(rx + stripHalfD), xMax: -(rx - stripHalfD),
        zMin: rz - stripHalfW, zMax: rz + stripHalfW,
        yTop: monYTop, yBottom: monYBot
      });
    }
    // Monitor arm posts (thin pillars between desktop and screens)
    for (const mz of [deskZ, lMonZ, rMonZ]) {
      result.push({
        xMin: -(monBaseX + 1), xMax: -(monBaseX - 1),
        zMin: mz - 1, zMax: mz + 1,
        yTop: monYBot, yBottom: deskSurface
      });
    }
    // Thorzone Nanoq R PC case on desktop (rises with desk).
    {
      const pcD = 13.4, pcW = 6.7, pcH = 9.8;
      const pcX = 164 + 30 / 2 - 13.4 / 2 - 1;
      const pcZ = 27 + 24 + 6;
      const pcBot = deskSurface;
      result.push({
        xMin: -(pcX + pcD / 2), xMax: -(pcX - pcD / 2),
        zMin: pcZ - pcW / 2, zMax: pcZ + pcW / 2,
        yTop: pcBot + pcH, yBottom: pcBot
      });
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
    _wasAimingAtInteractable = false;
    _wasGroundedLast = true;
    _lastFootstepTs = 0;
    _wasFootstepMoving = false;
    _skateLean = 0;
    _trickManual = 0; _trickManualHeld = false;
    _trickKickflip = 0; _trickKickflipActive = false;
    _trickSpinAngle = 0; _trickSpinSpeed = 0; _trickSpinBoost = false;
    _silenceSkateRoll(true);

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
    void leaderboard.startSharedRun(isSpeedMode() ? 'speed' : 'normal');

    // Show cat in third-person
    if (_catGroup) {
      _catGroup.visible = fpCamMode === 'third';
      if (_catGroup.parent !== _scene) _scene.add(_catGroup);
    }
    _fitSkateboardToCat(true);
    _syncSkateboardVisualState();
    // Disable cat shadow casting — shadow map refreshes at ~8 Hz so the
    // cat's shadow visually trails behind during movement at high FPS.
    catAnimation.setCatShadows(false);

    if (_markShadowsDirty) _markShadowsDirty();
    document.body.classList.add('play-mode');
    _syncSkateToggleUi();
    _playModeCue(true);
    if (_showToast) _showToast('Game mode! WASD to move, Space to jump (wall jump too!)');
  } else {
    _toggleHelp(false);
    _wasAimingAtInteractable = false;
    _wasGroundedLast = true;
    _lastFootstepTs = 0;
    _wasFootstepMoving = false;
    _skateLean = 0;
    _trickManual = 0; _trickManualHeld = false;
    _trickKickflip = 0; _trickKickflipActive = false;
    _trickSpinAngle = 0; _trickSpinSpeed = 0; _trickSpinBoost = false;
    _silenceSkateRoll(true);

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
    _syncSkateboardVisualState();
    _setSuperSaiyanEnvLightOff();

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
    _syncSkateToggleUi();
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
  _spaceHeld = 0; _tierGateHeld = 0;
  _jumpHoldFrames = 0;
  _isJumping = false;
  _coyoteFrames = 0;
  _jumpBufferFrames = 0;
  _spaceWasDown = false; _lastPhysicsTs = 0;
  _wallContactNx = 0; _wallContactNz = 0; _wallJumpCooldown = 0; _preCollisionSpd = 0; _consecutiveWallJumps = 0; _skateBoostAccum = 0;
  fpPaused = false;
  _ssFullChargeSinceTs = 0;
  _ssActiveUntilTs = 0;
  _ssBurstStartTs = 0;
  _ssHudFlashUntilTs = 0;
  _ssChargeShake = 0;
  _ssBurstFiredForCurrentHold = false;
  _skateLean = 0;
  _trickManual = 0; _trickManualHeld = false;
  _trickKickflip = 0; _trickKickflipActive = false;
  _trickSpinAngle = 0; _trickSpinSpeed = 0; _trickSpinBoost = false;
  _silenceSkateRoll(true);
  _silenceSsAudio(true);
  _ssShakeOffset.set(0, 0, 0);
  _setSuperSaiyanEnvLightOff();
}

// Reset all run-affecting world state (drawers, doors, purifier filters,
// closet bifold leaves) so each run starts from the same canonical pose.
function _resetWorldState() {
  if (_purifierRefs && typeof _purifierRefs.resetWorld === 'function') {
    _purifierRefs.resetWorld(_roomRefs);
  }
  if (_roomRefs) {
    if (typeof _roomRefs.toggleCornerDoor === 'function') _roomRefs.toggleCornerDoor(false);
    if (typeof _roomRefs.toggleGuestDoor === 'function') _roomRefs.toggleGuestDoor(false);
    if (typeof _roomRefs.toggleGuestDoor === 'function') _roomRefs.toggleGuestDoor(false);
  }
  if (typeof window._resetPokemonBinder === 'function') window._resetPokemonBinder();
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
  void leaderboard.startSharedRun(isSpeedMode() ? 'speed' : 'normal');
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
  _silenceSkateRoll(true);
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
    _silenceSkateRoll(true);
    _silenceSsAudio();

    // Show pause overlay (unless finish is showing)
    if (overlay && !finishOpen) {
      overlay.style.display = 'flex';
      leaderboard.renderLeaderboardPanel();
      void leaderboard.refreshSharedLeaderboard();
      // Focus trap
      _pauseSavedFocus = saveFocus();
      _pauseFocusTrap = trapFocus(overlay);
      const resumeBtn = overlay.querySelector('#fpPauseResume');
      if (resumeBtn) resumeBtn.focus();
    }
    if (crosshair) crosshair.style.opacity = '0.25';

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
}
// Expose for HTML onclick
window._toggleHelp = _toggleHelp;

// ── Set cam mode ────────────────────────────────────────────────────

export function setCamMode(mode) {
  fpCamMode = mode || (fpCamMode === 'first' ? 'third' : 'first');
  if (_catGroup) _catGroup.visible = fpMode && fpCamMode === 'third';
  _syncSkateboardVisualState();
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
  const speedMul = (speedMode ? 3.0 : 1.0) * (isSuperSaiyanActive() ? 2.0 : 1.0);
  const fwd = _fwd.set(-Math.sin(fpYaw), 0, -Math.cos(fpYaw));
  const right = _right.set(fwd.z, 0, -fwd.x);
  const inputActive = fpKeys.w || fpKeys.a || fpKeys.s || fpKeys.d;

  if (skateMode) {
    // Reset progressive boost on wall collision
    if (_wallContactNx !== 0 || _wallContactNz !== 0) _skateBoostAccum = 0;

    const skateBase = (fpKeys.shift ? 0.95 : 0.60) * speedMul;
    // Progressive boost: grows while holding input, uncapped
    if (inputActive) {
      const boostRate = (fpKeys.shift ? 0.012 : 0.007) * speedMul;
      _skateBoostAccum += boostRate * frameScale;
    }
    const skateSpd = skateBase + _skateBoostAccum;

    let tgtX = 0, tgtZ = 0;
    if (fpKeys.w) { tgtX += fwd.x * skateSpd; tgtZ += fwd.z * skateSpd; }
    if (fpKeys.s) { tgtX -= fwd.x * skateSpd; tgtZ -= fwd.z * skateSpd; }
    if (fpKeys.a) { tgtX += right.x * skateSpd; tgtZ += right.z * skateSpd; }
    if (fpKeys.d) { tgtX -= right.x * skateSpd; tgtZ -= right.z * skateSpd; }

    const tgtLen = Math.hypot(tgtX, tgtZ);
    const accelScale = Math.max(0.001, frameScale);

    if (inputActive && tgtLen > 1e-6) {
      const dirX = tgtX / tgtLen;
      const dirZ = tgtZ / tgtLen;

      let along = _velX * dirX + _velZ * dirZ;
      let latX = _velX - dirX * along;
      let latZ = _velZ - dirZ * along;

      const baseAccel = speedMode ? 0.052 : 0.078;
      const brakeBoost = along < 0 ? 1.9 : 1.0;
      const alongLerp = 1 - Math.pow(1 - Math.min(0.24, baseAccel * brakeBoost), accelScale);
      along += (skateSpd - along) * alongLerp;

      const sideSpeed = Math.hypot(latX, latZ);
      const sideN = Math.max(0, Math.min(1, sideSpeed / Math.max(0.001, skateSpd)));
      const sideGripBase = (fpKeys.shift ? 0.085 : 0.11) + sideN * 0.05;
      const sideGrip = 1 - Math.pow(1 - Math.min(0.22, sideGripBase), accelScale);
      const sideKeep = Math.max(0, 1 - sideGrip);
      latX *= sideKeep;
      latZ *= sideKeep;

      _velX = dirX * along + latX;
      _velZ = dirZ * along + latZ;
    } else {
      const glideDrag = Math.pow(0.994, accelScale);
      _velX *= glideDrag;
      _velZ *= glideDrag;
    }

    // No hard velocity clamp — progressive boost is the cap
    const maxVel = skateSpd * 1.18;
    const velMag = Math.hypot(_velX, _velZ);
    if (velMag > maxVel && velMag > 1e-6) {
      const clamp = maxVel / velMag;
      _velX *= clamp;
      _velZ *= clamp;
    }

    if (!inputActive && Math.hypot(_velX, _velZ) < 0.0018) {
      _velX = 0;
      _velZ = 0;
    }
  } else {
    const spd = (fpKeys.shift ? 0.65 : 0.30) * speedMul;
    let tgtX = 0, tgtZ = 0;
    if (fpKeys.w) { tgtX += fwd.x * spd; tgtZ += fwd.z * spd; }
    if (fpKeys.s) { tgtX -= fwd.x * spd; tgtZ -= fwd.z * spd; }
    if (fpKeys.a) { tgtX += right.x * spd; tgtZ += right.z * spd; }
    if (fpKeys.d) { tgtX -= right.x * spd; tgtZ -= right.z * spd; }

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
  }


  const moveX = _velX * frameScale;
  const moveZ = _velZ * frameScale;

  // ── Jump (charged on ground, with coyote & buffer) ───────────────
  // Hold space while on the ground to charge; release to fire. Coyote frames
  // let you still jump for a moment after stepping off; the jump buffer
  // remembers a press right before landing so you don't lose presses.
  // Asymmetric gravity (snappier fall) is below in the gravity section.
  const JUMP_BASE_VY = 0.40;  // power on a near-zero-charge release
  const JUMP_MAX_BONUS = 0.80;  // extra power at full charge (100%)
  const JUMP_MEGA_BONUS = 0.40;  // extra on top when holding past full (~150%)
  const JUMP_CHARGE_FRAMES = 36;    // frames to reach full charge (~0.6s)
  const MEGA_HOLD_FRAMES = 30;    // ~0.5s hold at full before MEGA bonus kicks in
  const SS_JUMP_MUL = isSuperSaiyanActive() ? 1.5 : 1.0; // SS mode: 1.5x jump height
  const COYOTE_FRAMES = 6;     // grace frames after walking off a ledge
  const JUMP_BUFFER_FRAMES = 8;     // grace frames for a press just before landing
  const GRAVITY_RISE = 0.018; // gravity while ascending
  const GRAVITY_FALL = 0.028; // stronger gravity while falling — snappier feel
  const WALL_JUMP_VY_MIN = 0.85;  // vertical boost at zero speed
  const WALL_JUMP_VY_MAX = 1.35;  // vertical boost at full sprint into wall
  const WALL_JUMP_PUSH_MIN = 0.30;  // horizontal push at zero speed
  const WALL_JUMP_PUSH_MAX = 0.75;  // horizontal push at full sprint
  const WALL_JUMP_COOLDOWN = 18;    // frames between wall jumps (anti-spam)
  const WALL_JUMP_GRAV_EXTRA = 0.55;  // extra gravity multiplier per consecutive wall jump

  // Grounded gate matches the old vy≈0 check; _wasGroundedLast is set at the
  // end of the previous frame and is the most reliable "on something" signal.
  const onGround = _wasGroundedLast && Math.abs(fpVy) < 0.01;

  // Coyote: full window while grounded, decays once we leave.
  if (onGround) { _coyoteFrames = COYOTE_FRAMES; _consecutiveWallJumps = 0; }
  else _coyoteFrames = Math.max(0, _coyoteFrames - frameScale);

  // Edge-detect space press; refresh the buffer on the press only.
  const spacePressed = fpKeys.space && !_spaceWasDown;
  const releasedThisFrame = !fpKeys.space && _spaceWasDown;
  if (spacePressed) _jumpBufferFrames = JUMP_BUFFER_FRAMES;
  else _jumpBufferFrames = Math.max(0, _jumpBufferFrames - frameScale);

  // Snapshot charge BEFORE we mutate it below — release-fire reads this.
  const chargeAtFrameStart = _spaceHeld;
  const tierGateAtFrameStart = _tierGateHeld;

  // Charge while space is held AND we're on the ground (or in coyote window).
  // Off-ground holds don't accumulate (no air-charge cheese).
  // Once at full charge, _tierGateHeld counts how long you've been holding
  // past full — used for the MEGA bonus and super saiyan activation.
  if (fpKeys.space && (onGround || _coyoteFrames > 0)) {
    if (_spaceHeld >= JUMP_CHARGE_FRAMES) {
      // Already at full — count hold-past-full frames
      _tierGateHeld += frameScale;
    } else {
      _spaceHeld = Math.min(JUMP_CHARGE_FRAMES, _spaceHeld + frameScale);
    }
  } else if (!fpKeys.space) {
    _spaceHeld = 0; _tierGateHeld = 0;
  }

  // Fire on release while still groundable, OR if a buffered press lands while
  // we're standing still (you tapped just before landing — fires now).
  const canJump = _coyoteFrames > 0 && fpVy <= 0.01;
  let firedThisFrame = false;

  if (canJump && releasedThisFrame) {
    // Released — fire with whatever charge had built up (min = base jump).
    const chargeN = Math.min(1, chargeAtFrameStart / JUMP_CHARGE_FRAMES);
    // MEGA bonus: if held past full, ramp up to 150% jump height
    const megaN = Math.min(1, tierGateAtFrameStart / MEGA_HOLD_FRAMES);
    fpVy = (JUMP_BASE_VY + JUMP_MAX_BONUS * chargeN + JUMP_MEGA_BONUS * megaN) * SS_JUMP_MUL;
    _playJumpCue(chargeN + megaN * 0.5);
    firedThisFrame = true;
  } else if (canJump && _jumpBufferFrames > 0 && !fpKeys.space) {
    // Buffered press from before landing — fire a base jump on touchdown.
    fpVy = JUMP_BASE_VY * SS_JUMP_MUL;
    _playJumpCue(0);
    firedThisFrame = true;
  }

  if (firedThisFrame) {
    _spaceHeld = 0; _tierGateHeld = 0;
    _jumpBufferFrames = 0;
    _coyoteFrames = 0;
    _isJumping = true;
  }

  // ── Wall jump ─────────────────────────────────────────────────────
  // If airborne, touching a wall, and space is pressed — bounce off the wall.
  // Momentum matters: faster approach = bigger bounce.
  _wallJumpCooldown = Math.max(0, _wallJumpCooldown - frameScale);
  const touchingWall = (_wallContactNx !== 0 || _wallContactNz !== 0);
  if (!firedThisFrame && !onGround && touchingWall && spacePressed && _wallJumpCooldown <= 0) {
    // Use pre-collision speed so wall-killed velocity doesn't read as zero
    const spdNorm = Math.min(1, _preCollisionSpd / 0.35);
    const wallVy = WALL_JUMP_VY_MIN + (WALL_JUMP_VY_MAX - WALL_JUMP_VY_MIN) * spdNorm;
    const wallPush = WALL_JUMP_PUSH_MIN + (WALL_JUMP_PUSH_MAX - WALL_JUMP_PUSH_MIN) * spdNorm;
    fpVy = wallVy;
    // Push away from wall
    const nLen = Math.hypot(_wallContactNx, _wallContactNz) || 1;
    _velX = (_wallContactNx / nLen) * wallPush;
    _velZ = (_wallContactNz / nLen) * wallPush;
    _wallJumpCooldown = WALL_JUMP_COOLDOWN;
    _consecutiveWallJumps++;
    _isJumping = true;
    _spaceHeld = 0; _tierGateHeld = 0;
    _jumpBufferFrames = 0;
    _playJumpCue(0.2 + spdNorm * 0.5);
    firedThisFrame = true;
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
  // MEGA hold: how far past full charge we've been holding (0–1)
  const megaPct = (onGround && _tierGateHeld > 0)
    ? Math.min(_tierGateHeld / MEGA_HOLD_FRAMES, 1)
    : 0;
  const isMega = megaPct >= 1;

  // Bar phases differ based on whether Super Saiyan is already active:
  //   Normal:  0–75% normal jump → 75–90% MEGA → 90–100% Super Saiyan
  //   SS active: 0–80% normal jump → 80–100% MEGA (SS phase is gone — you're
  //              already in it, and you can't re-trigger while active)
  const ssActive = isSuperSaiyanActive();
  const ssHoldMs = (_ssFullChargeSinceTs > 0 && onGround) ? Math.max(0, ts - _ssFullChargeSinceTs) : 0;
  const megaCompleteMs = (MEGA_HOLD_FRAMES / 60) * 1000;
  const ssBarProgress = (isMega && !ssActive)
    ? Math.min(1, Math.max(0, (ssHoldMs - megaCompleteMs) / Math.max(1, SS_HOLD_MS - megaCompleteMs)))
    : 0;
  let displayPct;
  if (ssActive) {
    if (isMega) displayPct = 80 + megaPct * 20;
    else displayPct = chargePct * 80;
  } else if (isMega) {
    displayPct = 90 + ssBarProgress * 10;
  } else if (chargePct >= 1) {
    displayPct = 75 + megaPct * 15;
  } else {
    displayPct = chargePct * 75;
  }

  if (_cachedCbFill) {
    _cachedCbFill.style.width = `${displayPct}%`;
  }
  if (_cachedCbBar) {
    const charging = chargePct > 0 || isMega;
    _cachedCbBar.classList.toggle('charging', charging);
    _cachedCbBar.classList.toggle('charged', chargePct >= 0.95);
    _cachedCbBar.classList.toggle('tier-1', chargePct > 0 && chargePct < 1 && !isMega);
    _cachedCbBar.classList.toggle('tier-2', chargePct >= 1 && !isMega);
    _cachedCbBar.classList.toggle('tier-3', isMega);
    // 'at-gate' label pulse only makes sense when there's a next tier to
    // unlock by holding longer. While SS is active, MEGA is the top tier
    // and there's no further hold benefit — so don't pulse there.
    _cachedCbBar.classList.toggle('at-gate', chargePct >= 1 && !isMega && !ssActive);
  }
  if (_cachedCbLabel) {
    if (ssActive) {
      // SS already active — only the two normal tiers remain.
      if (isMega) _cachedCbLabel.textContent = 'MEGA JUMP!';
      else _cachedCbLabel.textContent = 'Jump charge';
    } else if (isMega) {
      _cachedCbLabel.textContent = 'HOLD for SUPER SAIYAN!';
    } else if (chargePct >= 1) {
      _cachedCbLabel.textContent = 'HOLD for MEGA!';
    } else {
      _cachedCbLabel.textContent = 'Jump charge';
    }
  }
  if (_cachedCbValue) {
    const isCharging = chargePct > 0 || isMega;
    _cachedCbValue.textContent = onGround
      ? (isCharging ? `${Math.round(displayPct)}%` : 'Ready')
      : 'Air';
  }

  // Cat charge glow — ramps with charge, shifts gold when MEGA.
  if (_chargeLight) {
    let targetI = 0;
    if (isMega) {
      targetI = 28 + megaPct * 16;
      targetI *= 0.85 + 0.15 * Math.sin(ts * 0.05); // MEGA flicker
    } else if (chargePct > 0) {
      targetI = 4 + chargePct * 20;
    }
    _chargeLightTarget = targetI;
    const lerpK = 1 - Math.exp(-Math.max(0, dtSec) * 18);
    _chargeLight.intensity += (_chargeLightTarget - _chargeLight.intensity) * lerpK;
    if (isMega) _chargeLight.color.setHex(0xffc870);
    else if (chargePct >= 0.99) _chargeLight.color.setHex(0x88ffe0);
    else _chargeLight.color.setHex(0x88ddff);
  }

  // Super Saiyan mode — activates after holding full charge for 5s, then
  // runs for 20s (gold aura + 2x speed). Charging hint kicks in after
  // ~1.5s of held full charge so the player sees the build-up; on
  // activation a ~3s burst flashes the original full-blown look before
  // settling into the dim sustained glow.
  {
    const atFullCharge = onGround && chargePct >= 0.999;
    let chargingStrength = 0;
    let preActivationShake = 0;
    if (atFullCharge) {
      if (_ssFullChargeSinceTs === 0) _ssFullChargeSinceTs = ts;
      const heldMs = ts - _ssFullChargeSinceTs;
      preActivationShake = Math.min(1, heldMs / SS_HOLD_MS);
      // After 1.5s of full-charge hold, ramp a subtle aura 0 → ~0.4 over
      // the remaining hold window so the player sees something building.
      if (!isSuperSaiyanActive() && heldMs > SS_CHARGE_HINT_MS) {
        const k = Math.min(1, (heldMs - SS_CHARGE_HINT_MS) / Math.max(1, SS_HOLD_MS - SS_CHARGE_HINT_MS));
        chargingStrength = k * 0.4;
      }
      // Pre-fire the transformation sample so its climax aligns with the
      // visual pop instead of trailing it. Guarded by a per-hold flag so
      // we only play it once per activation attempt.
      if (!isSuperSaiyanActive() && !_ssBurstFiredForCurrentHold
        && heldMs >= (SS_HOLD_MS - SS_BURST_LEAD_MS)) {
        _silenceSsCharge();
        _playSuperSaiyanBurst();
        _ssBurstFiredForCurrentHold = true;
      }
      // Promote to active once the 5s hold completes (only if not already
      // active — don't restart during the 20s window).
      if (!isSuperSaiyanActive() && heldMs >= SS_HOLD_MS) {
        _ssActiveUntilTs = ts + SS_ACTIVE_MS;
        _ssBurstStartTs = ts;
        _ssHudFlashUntilTs = ts + SS_HUD_ENTER_FLASH_MS;
        _ssFullChargeSinceTs = 0;
        // Fire a fully-charged MEGA jump with the SS multiplier baked in.
        // SS_JUMP_MUL was sampled at frame start when SS wasn't active yet,
        // so apply 1.5x explicitly here.
        if (canJump) {
          fpVy = (JUMP_BASE_VY + JUMP_MAX_BONUS + JUMP_MEGA_BONUS) * 1.5;
          _playJumpCue(1.5);
          _isJumping = true;
          _coyoteFrames = 0;
          firedThisFrame = true;
        }
        // Consume the hold so we don't immediately fire a second MEGA jump on release.
        _spaceHeld = 0; _tierGateHeld = 0;
        _jumpBufferFrames = 0;
        // Burst sample was pre-fired SS_BURST_LEAD_MS ago so its climax
        // lands here. Just make sure the charge hum is silenced.
        _silenceSsCharge();
        // Going Super Saiyan unlocks Bababooey. Fire a second toast the
        // first time it happens so the player knows there's a new cat
        // waiting in Choose Your Cat.
        if (catAppearance.tryUnlockBababooey() && _showToast) {
          _showToast('🐸 Bababooey unlocked! Pick him in Choose Your Cat.');
        }
        if (_showToast) _showToast('⚡ SUPER SAIYAN ⚡');
      }
    } else {
      _ssFullChargeSinceTs = 0;
      _ssBurstFiredForCurrentHold = false;
    }

    const active = isSuperSaiyanActive();
    if (_cachedCbBar) {
      const entering = active && ts < _ssHudFlashUntilTs;
      _cachedCbBar.classList.toggle('ss-active', active);
      _cachedCbBar.classList.toggle('ss-enter', entering);
    }
    const baseStrength = active ? 1 : chargingStrength;
    // Burst: ease-out quad over SS_BURST_MS at the start of the active window.
    let burst = 0;
    if (active && _ssBurstStartTs > 0) {
      const t = ts - _ssBurstStartTs;
      if (t >= 0 && t < SS_BURST_MS) {
        const k = 1 - t / SS_BURST_MS;
        burst = k * k;
      }
    }
    const shakeTarget = (!active && atFullCharge) ? preActivationShake : 0;
    const shakeLerp = 1 - Math.exp(-Math.max(0, dtSec) * 18);
    _ssChargeShake += (shakeTarget - _ssChargeShake) * shakeLerp;
    _applySuperSaiyan(baseStrength, burst, ts);
    _ssEnvAnchor.set(fpPos.x, fpPos.y - EYE_H + 4.0, fpPos.z);
    _applySuperSaiyanEnvLight(_ssEnvAnchor, baseStrength, burst, ts, dtSec);

    // Audio targets: charge hum tracks the post-full hold (silent once SS
    // activates — the burst takes over); ambient pulse runs the whole SS
    // window then fades out.
    const chargeAudioP = (!active && atFullCharge)
      ? Math.min(1, (ts - (_ssFullChargeSinceTs || ts)) / SS_HOLD_MS)
      : 0;
    _setSsChargeTarget(chargeAudioP);
    _setSsAmbientTarget(active);
  }

  // ── Gravity (asymmetric: fall faster than rise) ───────────────────
  // Consecutive wall jumps make gravity heavier to prevent infinite climbing
  const SS_GRAV_MUL = isSuperSaiyanActive() ? 0.55 : 1.0; // SS mode: floatier jumps
  const gravScale = 1 + _consecutiveWallJumps * WALL_JUMP_GRAV_EXTRA;
  const g = (fpVy > 0 ? GRAVITY_RISE : GRAVITY_FALL) * gravScale * SS_GRAV_MUL;
  fpVy -= g * frameScale;
  let newY = fpPos.y + fpVy * frameScale;

  // ── Collision ─────────────────────────────────────────────────────
  let nx = fpPos.x + moveX;
  let nz = fpPos.z + moveZ;
  const r = BODY_R;
  // Snapshot speed before collision kills it — wall jump needs this.
  _preCollisionSpd = Math.hypot(_velX, _velZ);
  _wallContactNx = 0;
  _wallContactNz = 0;

  // Wall bounds — room stays at origin, use pre-computed base bounds
  const bounds = boundsBase;
  if (nx < bounds.xMin + r) { nx = bounds.xMin + r; _velX = Math.max(_velX, 0); _wallContactNx = 1; }
  else if (nx > bounds.xMax - r) { nx = bounds.xMax - r; _velX = Math.min(_velX, 0); _wallContactNx = -1; }
  if (nz < bounds.zMin + r) { nz = bounds.zMin + r; _velZ = Math.max(_velZ, 0); _wallContactNz = 1; }
  else if (nz > bounds.zMax - r) { nz = bounds.zMax - r; _velZ = Math.min(_velZ, 0); _wallContactNz = -1; }

  // Furniture AABBs (+ OBBs)
  let bonkedThisFrame = false;
  let bonkIntensity = 0;
  let groundY = getPlayerFloorY(); // eye-height floor (floorY + EYE_H)
  // Outdoor when player is outside all three house volumes (bedroom,
  // office, hallway). World coords; bounding boxes are slightly inflated
  // so doorway transitions don't flicker between in/out.
  const inBedroom = (nx >= -51 && nx <= 81 && nz >= -78 && nz <= 49);
  const inOffice = (nx >= -183 && nx <= -51 && nz >= -78 && nz <= 69);
  const inHallway = (nx >= -51 && nx <= -11 && nz >= 49 && nz <= 289);
  const outdoorZone = !(inBedroom || inOffice || inHallway);
  // When outdoors, sample the smooth terrain height at the player's X/Z so
  // the ground curves with the visible grass slopes instead of stepping.
  if (outdoorZone) {
    groundY = Math.max(groundY, _sampleOutdoorGroundY(nx, nz) + EYE_H);
  }
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
          _spaceHeld = 0; _tierGateHeld = 0;
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
          _wallContactNx = nPX;
          _wallContactNz = nPZ;
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
        _spaceHeld = 0; _tierGateHeld = 0;
        _isJumping = false;
      } else {
        // XZ push-out
        const pushXL = box.xMax + r - nx;
        const pushXR = nx + r - box.xMin;
        const pushZF = box.zMax + r - nz;
        const pushZB = nz + r - box.zMin;
        const minPush = Math.min(pushXL, pushXR, pushZF, pushZB);
        if (minPush === pushXL) { nx = box.xMax + r; _velX = Math.max(_velX, 0); _wallContactNx = 1; }
        else if (minPush === pushXR) { nx = box.xMin - r; _velX = Math.min(_velX, 0); _wallContactNx = -1; }
        else if (minPush === pushZF) { nz = box.zMax + r; _velZ = Math.max(_velZ, 0); _wallContactNz = 1; }
        else { nz = box.zMin - r; _velZ = Math.min(_velZ, 0); _wallContactNz = -1; }
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
  const ceilMax = outdoorZone ? (floorY + 200) : (floorY + 80) - 0.5;
  if (fpPos.y > ceilMax) {
    const hitVy = fpVy;
    fpPos.y = ceilMax;
    fpVy = -0.05;
    _spaceHeld = 0; _tierGateHeld = 0;
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
  const footstepMoving = movingOnGround && !skateMode;
  if (footstepMoving) {
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
  _wasFootstepMoving = footstepMoving;
  const skateSpeedNorm = Math.max(0, Math.min(1, (horizSpd - 0.02) / 0.58));
  _setSkateRollTarget(skateSpeedNorm, grounded);
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
    // Guest doorway transition zone: when the focal point is near the
    // right wall (X≈-51) and within the guest door Z range (34..66),
    // allow the camera to follow into the office room smoothly.
    const inGuestDoorway = focal.x < -51 + 4 && focal.x > -51 - 8
      && focal.z > 34 - 2 && focal.z < 66 + 2;
    const inGuestRoom = focal.x < -51 - 1 && focal.z > -78 && focal.z < 69;
    // Match physics outdoorZone — true whenever the focal point is outside
    // all three house volumes (bedroom, office, hallway).
    const fInBedroom = (focal.x >= -51 && focal.x <= 81 && focal.z >= -78 && focal.z <= 49);
    const fInOffice = (focal.x >= -183 && focal.x <= -51 && focal.z >= -78 && focal.z <= 69);
    const fInHallwayVol = (focal.x >= -51 && focal.x <= -11 && focal.z >= 49 && focal.z <= 289);
    const inOutdoor = !(fInBedroom || fInOffice || fInHallwayVol);
    const inHallway = focal.z > 49 - 1 && !inGuestDoorway && !inGuestRoom && !inOutdoor;
    let camWallXMin, camWallXMax;
    if (inOutdoor) {
      camWallXMin = -3000;
      camWallXMax = 3000;
    } else if (inGuestRoom || inGuestDoorway) {
      camWallXMin = -183 + 1;
      camWallXMax = -LEFT_WALL_X - 1;
    } else if (inHallway) {
      camWallXMin = -51 + 1;
      camWallXMax = -11 - 1;
    } else {
      camWallXMin = -(SIDE_WALL_X + CLOSET_DEPTH) + 1;
      camWallXMax = -LEFT_WALL_X - 1;
    }
    // Z bounds must include closet interior (extends to cZ - cIW/2 = -89)
    let camWallZMin = CLOSET_Z - CLOSET_INTERIOR_W / 2 + 1; // closet -Z side wall
    // Default Z clamp stops at the back-wall inner face. When the player is in
    // the hallway extension (focal X inside the hallway opening and past the
    // back wall), extend Z so the camera can follow. Also extend for office
    // and the guest doorway transition.
    const inHallwayX = (focal.x >= -51 + 1 && focal.x <= -11 - 1);
    let camWallZMax;
    if ((inHallwayX && focal.z > 49 - 6) || inGuestRoom || inGuestDoorway) {
      camWallZMax = 289 - 1;
    } else {
      camWallZMax = 49 - 1;
    }
    // Outdoors: the lawn extends far in every direction with no walls, so
    // open up the Z clamp to match and let the camera follow the cat freely.
    if (inOutdoor) {
      camWallZMin = -3000;
      camWallZMax = 3000;
    }
    // Camera Y min tracks the player's current ground, not the room floor,
    // so on elevated surfaces (bed, nightstand) it doesn't clip below them.
    // Outdoors the lawn drops well below floorY, so we drop the indoor floor
    // term and let the camera sit just above the player's feet.
    const cyMinFloor = inOutdoor ? (fpPos.y - EYE_H - 20) : (floorY + 0.5);
    const cyMin = Math.max(cyMinFloor, fpPos.y - EYE_H + 1.5);
    // Outdoors uses the same expanded ceiling as physics (floorY + 200).
    const cyMax = inOutdoor ? (floorY + 200) - 2 : (floorY + 80) - 2;
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
      _fitSkateboardToCat();
      _updatePickupSkateboardBob(dtSec);
      _catGroup.position.set(fpPos.x, fpPos.y - 4.0, fpPos.z);
      if (_ssChargeShake > 0.0001) {
        const shake = _sampleSuperSaiyanChargeShake(ts, _ssChargeShake);
        _catGroup.position.x += shake.x;
        _catGroup.position.y += shake.y;
        _catGroup.position.z += shake.z;
      }

      // Face movement direction
      const moveLenSq = _velX * _velX + _velZ * _velZ;
      if (moveLenSq > 0.0009) lastCatFacingYaw = Math.atan2(_velX, _velZ);
      const sidewaysSkatePose = skateMode && !_useForwardSkatePoseForModel();
      const skateYawOffset = sidewaysSkatePose ? (Math.PI * 0.5) : 0;
      const targetYaw = lastCatFacingYaw + skateYawOffset;
      let dYaw = targetYaw - _catGroupYaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      _catGroupYaw += dYaw * easeAlpha(19.74, dtSec);

      // ── Board spin trick (F) — air spin or grounded pivot ─────────
      // Press F to start spinning. In the air, each tap also gives an
      // upward kick so you can keep yourself off the ground. Grounded,
      // spin still accumulates but decays over time and eases the
      // residual angle back to a clean forward-facing rotation.
      let spinExtra = 0;
      if (_trickSpinSpeed !== 0 || _trickSpinAngle !== 0) {
        _trickSpinAngle += _trickSpinSpeed * dtSec;
        if (grounded) {
          // Friction on the ground — slows the pivot then settles.
          const SPIN_GROUND_DECAY = Math.PI * 5;
          const sgn = Math.sign(_trickSpinSpeed) || 1;
          _trickSpinSpeed = sgn * Math.max(0, Math.abs(_trickSpinSpeed) - SPIN_GROUND_DECAY * dtSec);
          if (Math.abs(_trickSpinSpeed) < 0.05) {
            _trickSpinSpeed = 0;
            // Ease residual angle back toward the nearest full revolution
            // so the cat finishes facing forward and folds back into the
            // movement yaw cleanly.
            const TAU = Math.PI * 2;
            const target = Math.round(_trickSpinAngle / TAU) * TAU;
            _trickSpinAngle += (target - _trickSpinAngle) * easeAlpha(11, dtSec);
            if (Math.abs(target - _trickSpinAngle) < 0.005) _trickSpinAngle = 0;
          }
        }
        spinExtra = _trickSpinAngle;
      }
      // Apply per-press upward impulse (deferred from keydown).
      // Only kicks in the air — on the ground F is a flat pivot.
      // Dampened near ceiling so you can't get stuck up there.
      if (_trickSpinBoost) {
        if (!grounded) {
          const _flY = getFloorY();
          const _ceilY = outdoorZone ? (_flY + 200) : (_flY + 80) - 0.5;
          const headroom = _ceilY - fpPos.y;
          const HOVER_MARGIN = 10;
          const ceilDamp = headroom < HOVER_MARGIN ? Math.max(0, headroom / HOVER_MARGIN) : 1;
          const kick = 0.22 * ceilDamp;
          fpVy = Math.max(fpVy, kick);
        }
        _trickSpinBoost = false;
      }

      const lateralInput = (fpKeys.d ? 1 : 0) - (fpKeys.a ? 1 : 0);
      const speedN = Math.max(0, Math.min(1, horizSpd / 0.5));
      const leanTarget = skateMode ? (-lateralInput * 0.26 * speedN) : 0;
      _skateLean += (leanTarget - _skateLean) * easeAlpha(12.5, dtSec);
      // ── Manual trick (hold E) — tilt nose up, lean cat back ─────
      const manualTarget = (skateMode && _trickManualHeld) ? 1 : 0;
      _trickManual += (manualTarget - _trickManual) * easeAlpha(10, dtSec);
      if (_trickManual < 0.001) _trickManual = 0;
      const manualAngle = _trickManual * 0.6;

      // Compose catGroup orientation via quaternion to avoid Euler gimbal
      // issues when combining yaw + lean + manual pitch.
      // Lean & manual are relative to movement direction, not the visual
      // pose yaw — so we apply them around the movement yaw, then add the
      // pose offset on top. This keeps them correct for sideways-stance
      // models (totodile, bababooey) without affecting forward-stance ones.
      {
        const moveYaw = _catGroupYaw - skateYawOffset + spinExtra;
        const qMoveYaw = _quatA.setFromAxisAngle(_vecUp, moveYaw);
        const qLean = _quatB.setFromAxisAngle(_vecFwd, _skateLean);
        const qManual = _quatC.setFromAxisAngle(_vecRight, -manualAngle);
        // Movement yaw → lean → manual → then pose offset on top
        _catGroup.quaternion.copy(qMoveYaw).multiply(qLean).multiply(qManual);
        if (skateYawOffset !== 0) {
          _catGroup.quaternion.multiply(_quatA.setFromAxisAngle(_vecUp, skateYawOffset));
        }
      }

      if (_skateboardAnchor) {
        _skateboardAnchor.rotation.y = _skateboardBaseYaw + (sidewaysSkatePose ? -(Math.PI * 0.5) : 0);
        // Don't add extra manual pitch here — the anchor inherits it from catGroup
        _skateboardAnchor.rotation.x = 0;

        // ── Kickflip trick (Q) — board rolls 360° ──────────────────
        if (_trickKickflipActive) {
          _trickKickflip += dtSec / 0.55;
          if (_trickKickflip >= 1) { _trickKickflip = 0; _trickKickflipActive = false; }
        }
        if (_trickKickflipActive) {
          const t = _trickKickflip;
          _skateboardAnchor.rotation.z = t * t * (3 - 2 * t) * Math.PI * 2;
        } else {
          _skateboardAnchor.rotation.z = 0;
        }
      }

      // Lift catGroup during manual so the board tail doesn't clip ground
      if (manualAngle > 0) {
        _catGroup.position.y += Math.sin(manualAngle) * 1.5;
      }

      // Hop arc during kickflip — lifts cat (and board, since the anchor is
      // parented under catGroup) so the spinning board doesn't clip through
      // the model and doesn't dip into the floor mid-rotation.
      if (_trickKickflipActive) {
        _catGroup.position.y += Math.sin(_trickKickflip * Math.PI) * 7.2;
      }
      _syncSkateboardVisualState();
    }
  }

  // ── Crosshair interaction indicator ───────────────────────────────
  // Highlight crosshair when aiming at something clickable
  _cacheDom();
  if (_cachedCrosshair) {
    if (ts - _lastCrosshairRaycastTs >= RAYCAST_INTERVAL_MS) {
      _lastCrosshairRaycastTs = ts;
      _ray.setFromCamera(_rayCenter, _camera);
      // Scene-wide raycast so opaque geometry (walls/furniture) occludes
      // interactables behind them — no clicking through walls.
      const hits = _ray.intersectObjects(_scene.children, true);
      let aimingAt = false;
      let aimTarget = null;
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.distance > 220) break;
        if (!_isObjectVisibleInWorld(h.object)) continue;
        const t = _findInteractiveAncestor(h.object);
        if (t) { aimingAt = true; aimTarget = t; break; }
        if (_isOccluder(h.object)) break; // blocked by opaque geometry
      }
      if (aimingAt && !_wasAimingAtInteractable && ts - _lastAimToneTs > 220) {
        _playAimCue();
        _lastAimToneTs = ts;
      }
      _wasAimingAtInteractable = aimingAt;
      _crosshairAimingAtInteractable = aimingAt;
      window._fpLookTarget = aimingAt;

      // Tooltip — show a friendly label for the targeted interactable.
      // Door labels flip based on which side of the door the player is on.
      const tooltip = document.getElementById('fpCrosshairTooltip');
      if (tooltip) {
        const label = aimTarget ? _labelForInteractable(aimTarget) : null;
        if (label) {
          const html = '<span class="tt-verb">' + label.verb + '</span><span class="tt-sep">\u00b7</span>' + label.noun;
          if (tooltip._lastHtml !== html) {
            tooltip.innerHTML = html;
            tooltip._lastHtml = html;
          }
          tooltip.classList.add('visible');
        } else {
          tooltip.classList.remove('visible');
          tooltip._lastHtml = '';
        }
      }
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
        if (_skateOnboardingOpen) { _closeSkateOnboarding(); break; }
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
      case 'KeyK':
        if (skateboardFound) setSkateMode(!skateMode);
        else if (_showToast) _showToast('Find the hidden skateboard first!');
        break;
      case 'KeyQ':
        if (skateMode && !_trickKickflipActive) { _trickKickflipActive = true; _trickKickflip = 0; }
        break;
      case 'KeyE':
        _trickManualHeld = skateMode;
        break;
      case 'KeyF':
        // F dispatches based on Super Saiyan state — main.js routes to
        // either fireball spam (normal) or kamehameha charge (SS).
        // We forward the autorepeat flag so SS charges only START on the
        // initial press while normal fireballs can still be spammed.
        if (typeof window._fireballKeyDown === 'function') {
          window._fireballKeyDown(!!e.repeat);
        } else if (typeof window._shootFireball === 'function') {
          window._shootFireball();
        }
        break;
      case 'KeyX':
        // X = skateboard spin (Tony-Hawk-style). Tap to stack aerial
        // 360s with diminishing returns + small upward kick; on the
        // ground it acts as a flat pivot. Cap ~30 rev/s. Skate-only.
        if (e.repeat) break;
        if (skateMode) {
          const SPIN_BASE = Math.PI * 2.66; // ~1.33 rev/s base add
          const SPIN_CAP = Math.PI * 15;    // ~30 rev/s
          const ratio = Math.min(1, _trickSpinSpeed / SPIN_CAP);
          const falloff = (1 - ratio) * (1 - ratio) * 0.8 + 0.2;
          _trickSpinSpeed = Math.min(_trickSpinSpeed + SPIN_BASE * falloff, SPIN_CAP);
          if (!_wasGroundedLast) _trickSpinBoost = true;
        }
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
      case 'KeyE': _trickManualHeld = false; break;
      case 'KeyF':
        if (typeof window._fireballKeyUp === 'function') {
          window._fireballKeyUp();
        }
        break;
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
