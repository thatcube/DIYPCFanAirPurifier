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
import { getBounds, acquireBox, resetBoxPool, easeAlpha, BODY_R, EYE_H, HEAD_EXTRA } from './game-collision.js';
import * as coins from './coins.js';
import * as leaderboard from './leaderboard.js';

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
let _purifierGroup = null;

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
  _purifierGroup = refs.purifierGroup || null;
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
    _staticBoxes.push({
      xMin: -(shelfCx + 7), xMax: -(shelfCx - 7),
      zMin: cZ - (cIW - 1) / 2, zMax: cZ + (cIW - 1) / 2,
      yTop: fy + cIH - 24 + 0.4, yBottom: fy + cIH - 24 - 0.4, room: true
    });
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
  const tvCenterY = fy + 48;
  const tvW = 56.7, tvH = 31.9, tvD = 1.0, bezel = 0.3;
  const tvZ = OPP_WALL_Z + 0.5 + tvD / 2 + 0.1;
  _staticBoxes.push({
    xMin: -(tvCenterX + (tvW + bezel * 2) / 2), xMax: -(tvCenterX - (tvW + bezel * 2) / 2),
    zMin: OPP_WALL_Z, zMax: tvZ + tvD / 2 + 1,
    yTop: tvCenterY + tvH / 2 + bezel, yBottom: tvCenterY - tvH / 2 - bezel, room: true
  });

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

  // Door extrusion — solid wall block behind the door recess
  // extRight=51, extLeft=11, recessZ=19
  _staticBoxes.push({
    xMin: -51, xMax: -11,
    zMin: 18.75, zMax: 49,
    yTop: fy + WALL_HEIGHT, room: true
  });
}

// ── Get collision boxes (per-frame) ─────────────────────────────────

function _getBoxes() {
  resetBoxPool();
  const result = [];

  // Room collision boxes (static, no offset needed)
  for (const box of _staticBoxes) {
    const b = acquireBox();
    b.xMin = box.xMin; b.xMax = box.xMax;
    b.zMin = box.zMin; b.zMax = box.zMax;
    b.yTop = box.yTop; b.yBottom = box.yBottom;
    result.push(b);
  }

  // ── Purifier collision (dynamic — follows placementOffset + rotation) ──
  const px = _placementOffset ? _placementOffset.x : 0;
  const py = _placementOffset ? _placementOffset.y : 0;
  const pz = _placementOffset ? _placementOffset.z : 0;
  const { W, H, D, ply, ft, bunFootH } = state;
  const panelW = W + 2 * ft;

  // Cabinet dimensions in local space
  const hwOuter = panelW / 2;    // half-width (filter side)
  const hdOuter = D / 2 + ply;   // half-depth (front/back)
  const yTopPanel = py + H / 2 + ply;
  const yBotPanel = py - H / 2 - ply;
  const yBotFeet = yBotPanel - bunFootH;

  // Detect rotation from the actual purifierGroup rotation
  const rotated = _purifierGroup ? Math.abs(_purifierGroup.rotation.y) > 0.1 : false;

  // Build 4 wall AABBs (top, bottom, front, back) + 2 filter sides
  const localBoxes = [
    // Top panel — standable
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: -hdOuter, lzMax: hdOuter, yTop: yTopPanel, yBottom: yTopPanel - ply },
    // Bottom panel — solid floor, extends through feet
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: -hdOuter, lzMax: hdOuter, yTop: yBotPanel + ply, yBottom: yBotFeet },
    // Front wall (-Z face)
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: -hdOuter, lzMax: -D / 2, yTop: yTopPanel, yBottom: yBotFeet },
    // Back wall (+Z face)
    { lxMin: -hwOuter, lxMax: hwOuter, lzMin: D / 2, lzMax: hdOuter, yTop: yTopPanel, yBottom: yBotFeet },
    // Left filter side
    { lxMin: -hwOuter, lxMax: -hwOuter + ft, lzMin: -D / 2, lzMax: D / 2, yTop: yTopPanel, yBottom: yBotFeet },
    // Right filter side
    { lxMin: hwOuter - ft, lxMax: hwOuter, lzMin: -D / 2, lzMax: D / 2, yTop: yTopPanel, yBottom: yBotFeet },
  ];

  for (const lb of localBoxes) {
    const b = acquireBox();
    if (rotated) {
      // 90° rotation: local X → world Z, local Z → world -X
      b.xMin = px - lb.lzMax; b.xMax = px - lb.lzMin;
      b.zMin = pz + lb.lxMin; b.zMax = pz + lb.lxMax;
    } else {
      b.xMin = px + lb.lxMin; b.xMax = px + lb.lxMax;
      b.zMin = pz + lb.lzMin; b.zMax = pz + lb.lzMax;
    }
    b.yTop = lb.yTop; b.yBottom = lb.yBottom;
    result.push(b);
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

    // Reset coins + timer
    coins.resetScores();
    coins.setCoinsVisible(true);
    leaderboard.startTimer();

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

  // Wall bounds — room stays at origin, no placement offset needed
  const bounds = getBounds(new THREE.Vector3());
  if (nx < bounds.xMin + r) { nx = bounds.xMin + r; _velX = Math.max(_velX, 0); }
  else if (nx > bounds.xMax - r) { nx = bounds.xMax - r; _velX = Math.min(_velX, 0); }
  if (nz < bounds.zMin + r) { nz = bounds.zMin + r; _velZ = Math.max(_velZ, 0); }
  else if (nz > bounds.zMax - r) { nz = bounds.zMax - r; _velZ = Math.min(_velZ, 0); }

  // Furniture AABBs
  let bonkedThisFrame = false;
  let bonkIntensity = 0;
  let groundY = getPlayerFloorY(); // eye-height floor (floorY + EYE_H)
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
  const ceilMax = (floorY + 80) - 0.5;
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

    // Camera wall clamp — include closet area so player can walk in
    const camWallXMin = -(SIDE_WALL_X + CLOSET_DEPTH) + 1; // closet back wall + buffer
    const camWallXMax = -LEFT_WALL_X - 1;   // window wall inner face - buffer
    // Z bounds must include closet interior (extends to cZ - cIW/2 = -89)
    const camWallZMin = CLOSET_Z - CLOSET_INTERIOR_W / 2 + 1; // closet -Z side wall
    const camWallZMax = 49 - 1;             // back wall inner face - buffer
    const cyMin = floorY + 2, cyMax = (floorY + 80) - 2;
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
    // Hard clamp — camera must never leave the room
    cxC = Math.max(camWallXMin, Math.min(camWallXMax, cxC));
    cyC = Math.max(cyMin, Math.min(cyMax, cyC));
    czC = Math.max(camWallZMin, Math.min(camWallZMax, czC));

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
