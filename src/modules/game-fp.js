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
  CLOSET_DEPTH, CLOSET_INTERIOR_W
} from './spatial.js';
import { getBounds, acquireBox, resetBoxPool, easeAlpha, BODY_R, EYE_H, HEAD_EXTRA } from './game-collision.js';
import * as coins from './coins.js';

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

const SFX_MUTE_KEY = 'diy_air_purifier_muted_v1';
const MUSIC_MUTE_KEY = 'diy_air_purifier_music_muted_v1';

try { sfxMuted = localStorage.getItem(SFX_MUTE_KEY) === '1'; } catch (e) {}
try { musicMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1'; } catch (e) {}

export function setSfxMuted(muted) {
  sfxMuted = !!muted;
  try { localStorage.setItem(SFX_MUTE_KEY, sfxMuted ? '1' : '0'); } catch (e) {}
}

export function setMusicMuted(muted) {
  musicMuted = !!muted;
  try { localStorage.setItem(MUSIC_MUTE_KEY, musicMuted ? '1' : '0'); } catch (e) {}
}

// ── Internal state ──────────────────────────────────────────────────

let _velX = 0, _velZ = 0;
let _bobPhase = 0;
let _lastPhysicsTs = 0;
let _spaceHeld = 0;
let _wasBonking = false;

const PITCH_MIN = -1.2;
const PITCH_MAX = 1.55;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _viewDir = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _rayCenter = new THREE.Vector2(0, 0);

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
let _fpHud = null;

// Collision boxes from room (set during init)
let _staticBoxes = [];

// ── Bonk SFX ────────────────────────────────────────────────────────

let _bonkBuffer = null;
let _bonkAC = null;

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
  const ac = _bonkAC || coins.getAudioCtx();
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

// ── Init ────────────────────────────────────────────────────────────

export function init(refs) {
  _camera = refs.camera;
  _canvas = refs.canvas;
  _controls = refs.controls;
  _catGroup = refs.catGroup;
  _scene = refs.scene;
  _placementOffset = refs.placementOffset || new THREE.Vector3();
  _markShadowsDirty = refs.markShadowsDirty || (() => {});
  _showToast = refs.showToast || (() => {});
  _roomRefs = refs.roomRefs || {};

  // Build static collision boxes from room refs
  _buildStaticBoxes();

  // Bind input
  _bindInputs();
}

// ── Static collision boxes ──────────────────────────────────────────
// Simplified set — just the major furniture. Full monolith had ~40 AABBs.

function _buildStaticBoxes() {
  const r = _roomRefs;
  const fy = r.floorY || getFloorY();
  _staticBoxes = [];

  // Bed
  if (r.bedX !== undefined) {
    const bedTop = fy + (r.bedH || 25) + 2; // approx mattress + duvet
    _staticBoxes.push({
      xMin: -(r.bedX + (r.bedW || 60) / 2), xMax: -(r.bedX - (r.bedW || 60) / 2),
      zMin: r.bedZ - (r.bedL || 80) / 2, zMax: r.bedZ + (r.bedL || 80) / 2,
      yTop: bedTop, yBottom: fy + (r.bedClearance || 8), room: true
    });
  }

  // Nightstand
  if (r.tblX !== undefined) {
    _staticBoxes.push({
      xMin: -(r.tblX + (r.tblW || 22) / 2), xMax: -(r.tblX - (r.tblW || 22) / 2),
      zMin: r.tblZ - (r.tblD || 18) / 2, zMax: r.tblZ + (r.tblD || 18) / 2,
      yTop: fy + (r.tblH || 28), room: true
    });
  }

  // Right wall solid portions (flanking closet)
  _staticBoxes.push(
    { xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: OPP_WALL_Z, zMax: -10, yTop: fy + 80, room: true },
    { xMin: -(SIDE_WALL_X + 0.5), xMax: -SIDE_WALL_X, zMin: 20, zMax: 49, yTop: fy + 80, room: true }
  );

  // Closet back wall
  _staticBoxes.push({
    xMin: -(SIDE_WALL_X + CLOSET_DEPTH + 0.25), xMax: -(SIDE_WALL_X + CLOSET_DEPTH - 0.25),
    zMin: -CLOSET_INTERIOR_W / 2, zMax: CLOSET_INTERIOR_W / 2,
    yTop: fy + 80, room: true
  });

  // Opposite wall (TV wall)
  _staticBoxes.push({
    xMin: -SIDE_WALL_X, xMax: 81, zMin: OPP_WALL_Z - 0.25, zMax: OPP_WALL_Z + 0.25,
    yTop: fy + 80, room: true
  });
}

// ── Get collision boxes (per-frame) ─────────────────────────────────

function _getBoxes() {
  resetBoxPool();
  const result = [];
  const ox = _placementOffset ? _placementOffset.x : 0;
  const oy = _placementOffset ? _placementOffset.y : 0;
  const oz = _placementOffset ? _placementOffset.z : 0;

  for (const box of _staticBoxes) {
    if (box.room) {
      const b = acquireBox();
      b.xMin = box.xMin - ox;
      b.xMax = box.xMax - ox;
      b.zMin = box.zMin - oz;
      b.zMax = box.zMax - oz;
      b.yTop = box.yTop - oy;
      b.yBottom = box.yBottom !== undefined ? box.yBottom - oy : undefined;
      result.push(b);
    } else {
      result.push(box);
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
    // Enter FP
    _savedFov = _camera.fov;
    _camera.fov = 75;
    _camera.updateProjectionMatrix();

    // Request pointer lock
    _fpIgnorePointerUnlock = true;
    setTimeout(() => { _fpIgnorePointerUnlock = false; }, 300);
    if (_canvas) _canvas.requestPointerLock();

    // Disable orbit controls
    if (_controls) _controls.enabled = false;

    // Reset position
    _respawn();

    // Reset coins
    coins.resetScores();
    coins.setCoinsVisible(true);

    // Show cat in third-person
    if (_catGroup) {
      _catGroup.visible = fpCamMode === 'third';
      if (_catGroup.parent !== _scene) _scene.add(_catGroup);
    }

    if (_markShadowsDirty) _markShadowsDirty();
    document.body.classList.add('play-mode');
    if (_showToast) _showToast('Game mode! WASD to move, Space to jump');
  } else {
    // Exit FP
    _camera.fov = _savedFov;
    _camera.updateProjectionMatrix();

    if (_controls) _controls.enabled = true;

    // Clear input
    for (const k in fpKeys) fpKeys[k] = false;
    fpLookDX = 0;
    fpLookDY = 0;

    // Exit pointer lock
    if (document.pointerLockElement) document.exitPointerLock();

    // Hide coins + cat
    coins.setCoinsVisible(false);
    if (_catGroup) _catGroup.visible = false;

    if (_markShadowsDirty) _markShadowsDirty();
    document.body.classList.remove('play-mode');
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
  _lastPhysicsTs = 0;
  fpPaused = false;
}

// ── Set paused ──────────────────────────────────────────────────────

export function setPaused(paused) {
  fpPaused = !!paused;
  const overlay = document.getElementById('fpPauseOverlay');
  if (overlay) overlay.style.display = fpPaused ? 'flex' : 'none';

  if (fpPaused) {
    if (document.pointerLockElement) {
      _fpIgnorePointerUnlock = true;
      document.exitPointerLock();
      setTimeout(() => { _fpIgnorePointerUnlock = false; }, 300);
    }
  } else {
    if (_canvas) {
      _fpIgnorePointerUnlock = true;
      _canvas.requestPointerLock();
      setTimeout(() => { _fpIgnorePointerUnlock = false; }, 300);
    }
  }
}

// ── Set cam mode ────────────────────────────────────────────────────

export function setCamMode(mode) {
  fpCamMode = mode || (fpCamMode === 'first' ? 'third' : 'first');
  if (_catGroup) _catGroup.visible = fpMode && fpCamMode === 'third';
}

// ── Physics tick ────────────────────────────────────────────────────

export function updatePhysics(ts, dtSec, animFrameScale) {
  if (!fpMode || fpPaused) return;

  const fpDtMs = _lastPhysicsTs ? Math.min(80, Math.max(1, ts - _lastPhysicsTs)) : (1000 / 60);
  _lastPhysicsTs = ts;
  const frameScale = fpDtMs / (1000 / 60);

  // ── Look ──────────────────────────────────────────────────────────
  const maxLookStep = 28;
  const stepX = Math.max(-maxLookStep, Math.min(maxLookStep, fpLookDX));
  const stepY = Math.max(-maxLookStep, Math.min(maxLookStep, fpLookDY));
  fpLookDX -= stepX;
  fpLookDY -= stepY;
  if (Math.abs(fpLookDX) > maxLookStep * 4) fpLookDX *= 0.6;
  if (Math.abs(fpLookDY) > maxLookStep * 4) fpLookDY *= 0.6;
  fpYaw -= stepX * 0.002;
  fpPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, fpPitch - stepY * 0.002));

  // ── Movement ──────────────────────────────────────────────────────
  const spd = fpKeys.shift ? 0.45 : 0.22;
  const fwd = _fwd.set(-Math.sin(fpYaw), 0, -Math.cos(fpYaw));
  const right = _right.set(fwd.z, 0, -fwd.x);

  let tgtX = 0, tgtZ = 0;
  if (fpKeys.w) { tgtX += fwd.x * spd; tgtZ += fwd.z * spd; }
  if (fpKeys.s) { tgtX -= fwd.x * spd; tgtZ -= fwd.z * spd; }
  if (fpKeys.a) { tgtX += right.x * spd; tgtZ += right.z * spd; }
  if (fpKeys.d) { tgtX -= right.x * spd; tgtZ -= right.z * spd; }

  const inputActive = fpKeys.w || fpKeys.a || fpKeys.s || fpKeys.d;
  const accelBase = inputActive ? 0.18 : 0.22;
  const accel = 1 - Math.pow(1 - accelBase, frameScale);
  _velX += (tgtX - _velX) * accel;
  _velZ += (tgtZ - _velZ) * accel;
  if (!inputActive && Math.hypot(_velX, _velZ) < 0.005) { _velX = 0; _velZ = 0; }

  const moveX = _velX * frameScale;
  const moveZ = _velZ * frameScale;

  // ── Jump (charged) ────────────────────────────────────────────────
  if (fpKeys.space && Math.abs(fpVy) < 0.01) {
    _spaceHeld += frameScale;
  }
  if (!fpKeys.space && _spaceHeld > 0 && Math.abs(fpVy) < 0.01) {
    const charge = Math.min(_spaceHeld, 60);
    const power = 0.4 + charge * 0.025;
    fpVy = power;
    _spaceHeld = 0;
  }
  if (!fpKeys.space) _spaceHeld = 0;

  // Charge bar UI
  const cbFill = document.getElementById('fpChargeFill');
  if (cbFill) {
    cbFill.style.width = _spaceHeld > 0 ? Math.min(_spaceHeld / 60 * 100, 100) + '%' : '0%';
  }

  // ── Gravity ───────────────────────────────────────────────────────
  fpVy -= 0.018 * frameScale;
  let newY = fpPos.y + fpVy * frameScale;

  // ── Collision ─────────────────────────────────────────────────────
  let nx = fpPos.x + moveX;
  let nz = fpPos.z + moveZ;
  const r = BODY_R;
  const oy = _placementOffset ? _placementOffset.y : 0;

  // Wall bounds
  const bounds = getBounds(_placementOffset || new THREE.Vector3());
  if (nx < bounds.xMin + r) { nx = bounds.xMin + r; _velX = Math.max(_velX, 0); }
  else if (nx > bounds.xMax - r) { nx = bounds.xMax - r; _velX = Math.min(_velX, 0); }
  if (nz < bounds.zMin + r) { nz = bounds.zMin + r; _velZ = Math.max(_velZ, 0); }
  else if (nz > bounds.zMax - r) { nz = bounds.zMax - r; _velZ = Math.min(_velZ, 0); }

  // Furniture AABBs
  let bonkedThisFrame = false;
  let bonkIntensity = 0;
  let groundY = getFloorY() - oy;
  const boxes = _getBoxes();

  for (const box of boxes) {
    const xOverlap = nx + r > box.xMin && nx - r < box.xMax;
    const zOverlap = nz + r > box.zMin && nz - r < box.zMax;
    if (xOverlap && zOverlap) {
      const prevFeet = fpPos.y - EYE_H;
      const newFeet = newY - EYE_H;
      const newHeadTop = newY + HEAD_EXTRA;

      const onTopPrev = prevFeet >= box.yTop - 0.25;
      if (onTopPrev && newFeet >= box.yTop - 0.5) {
        groundY = Math.max(groundY, box.yTop + EYE_H);
      } else if (box.yBottom !== undefined && newHeadTop <= box.yBottom - 0.2) {
        // Fully beneath — pass through
      } else if (box.yBottom !== undefined && newFeet < box.yBottom - 0.2 && fpVy > 0.05) {
        // Head bonk on ceiling
        bonkedThisFrame = true;
        bonkIntensity = Math.max(bonkIntensity, fpVy * 1.2);
        newY = box.yBottom - 0.2 - HEAD_EXTRA;
        if (fpVy > 0) fpVy = 0;
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
  if (fpPos.y < groundY) { fpPos.y = groundY; fpVy = 0; }

  // Ceiling
  const floorY = getFloorY();
  const ceilMax = (floorY + 80 - oy) - 0.5;
  if (fpPos.y > ceilMax) { fpPos.y = ceilMax; fpVy = Math.min(fpVy, 0); }

  // Bonk SFX
  if (bonkedThisFrame && !_wasBonking) _playBonk(bonkIntensity);
  _wasBonking = bonkedThisFrame;

  // ── Headbob ───────────────────────────────────────────────────────
  const grounded = Math.abs(fpPos.y - groundY) < 0.05;
  const horizSpd = Math.hypot(_velX, _velZ);
  if (grounded && horizSpd > 0.02) {
    _bobPhase += horizSpd * 0.55 * frameScale;
  }
  const bobY = grounded ? Math.sin(_bobPhase) * Math.min(horizSpd, 0.5) * 0.07 : 0;

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
    const camDist = 7.3, camLift = 2.2, camShoulder = 0.9;
    let dxC = -lookDir.x * camDist + right.x * camShoulder;
    let dyC = -lookDir.y * camDist + camLift;
    let dzC = -lookDir.z * camDist + right.z * camShoulder;

    // Wall/ceiling/floor clamp
    const bnd = getBounds(_placementOffset || new THREE.Vector3());
    const m = 0.5;
    const cyMin = floorY + 3, cyMax = (floorY + 80) - 3;
    const maxDX = dxC > 0 ? (bnd.xMax - m - focal.x) : (focal.x - (bnd.xMin + m));
    const maxDY = dyC > 0 ? (cyMax - focal.y) : (focal.y - cyMin);
    const maxDZ = dzC > 0 ? (bnd.zMax - m - focal.z) : (focal.z - (bnd.zMin + m));
    const absDX = Math.abs(dxC), absDY = Math.abs(dyC), absDZ = Math.abs(dzC);
    let scale = 1;
    if (absDX > maxDX && absDX > 1e-4) scale = Math.min(scale, Math.max(0, maxDX) / absDX);
    if (absDY > maxDY && absDY > 1e-4) scale = Math.min(scale, Math.max(0, maxDY) / absDY);
    if (absDZ > maxDZ && absDZ > 1e-4) scale = Math.min(scale, Math.max(0, maxDZ) / absDZ);
    scale = Math.max(scale, 0.18);

    let cxC = focal.x + dxC * scale;
    let cyC = focal.y + dyC * scale;
    let czC = focal.z + dzC * scale;
    if (cyC > cyMax) cyC = cyMax;
    else if (cyC < cyMin) cyC = cyMin;

    _camera.position.set(cxC, cyC, czC);
    _camera.lookAt(cxC + lookDir.x * 10, cyC + lookDir.y * 10, czC + lookDir.z * 10);

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

  // ── Coin counter HUD ──────────────────────────────────────────────
  const coinCountEl = document.getElementById('coinCount');
  if (coinCountEl) coinCountEl.textContent = coins.coinScore + '/' + coins.coinTotal;
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
        _respawn();
        coins.resetScores();
        if (_showToast) _showToast('Reset!');
        break;
      case 'KeyG':
        toggleFirstPerson();
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
        _canvas.requestPointerLock();
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

  // G key to enter game from orbit mode
  document.addEventListener('keydown', e => {
    if (fpMode) return;
    if (e.code === 'KeyG') toggleFirstPerson();
  });
}
