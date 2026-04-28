// ─── Kamehameha (charged energy beam) ──────────────────────────────
// Replaces the old spammable fireball. Hold F to charge a glowing orb
// in front of you; release to fire a thick blue/white beam that
// stretches forward, holds for a beat, then fades out.
//
// Performance: a single beam slot + a single charge orb. No pooling
// needed since only one beam exists at a time. All meshes are pre-built
// once; charging/firing just toggles visibility and updates transforms.

import * as THREE from 'three';
import * as coins from './coins.js';
import { sfxMuted } from './game-fp.js';

// ── Config ──────────────────────────────────────────────────────────

const CHARGE_MIN_SEC = 0.28;       // minimum hold before release fires
const CHARGE_FULL_SEC = 1.10;      // hold this long for max-power beam
const ORB_BASE_RADIUS = 1.6;       // orb size at start of charge
const ORB_MAX_RADIUS = 7.5;        // orb size at full charge
const ORB_FORWARD = 14;            // inches in front of muzzle
const ORB_DOWN = 1.5;              // drop slightly so it reads as "in hands"

const BEAM_BASE_LEN = 240;         // inches at min-power release
const BEAM_MAX_LEN = 620;          // inches at full charge
const BEAM_BASE_RADIUS = 3.2;      // outer radius at min charge
const BEAM_MAX_RADIUS = 9.0;       // outer radius at full charge
const BEAM_EXTEND_SEC = 0.10;      // time for beam to reach full length
const BEAM_HOLD_BASE_SEC = 0.18;   // hold time at min charge
const BEAM_HOLD_FULL_SEC = 0.55;   // hold time at full charge
const BEAM_FADE_SEC = 0.22;

// ── State ───────────────────────────────────────────────────────────

let _scene = null;
let _camera = null;
let _catGroup = null;
let _isFpMode = () => false;

let _unlocked = false;
let _initBuilt = false;

// Charge state
let _charging = false;
let _chargeStartTs = 0;            // performance.now() when charge started
let _chargeRatio = 0;              // 0..1, updated each frame while charging

// Beam state
let _beamActive = false;
let _beamPhase = 'idle';           // 'extend' | 'hold' | 'fade'
let _beamPhaseStartTs = 0;
let _beamHoldDur = 0;              // depends on charge
let _beamMaxLen = 0;
let _beamMaxRad = 0;
const _beamOrigin = new THREE.Vector3();
const _beamDir = new THREE.Vector3();

// Visual nodes (built once)
let _orbGroup = null;              // charge orb
let _orbCore = null;
let _orbInner = null;
let _orbHaze = null;
let _orbLight = null;

let _beamGroup = null;             // fired beam
let _beamCore = null;              // bright white center cylinder
let _beamMid = null;               // cyan mid layer
let _beamOuter = null;             // soft glow outer
let _beamCap = null;               // bright sphere at the muzzle end
let _beamLight = null;

// Scratch
const _tmpDir = new THREE.Vector3();
const _tmpOrigin = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpUp = new THREE.Vector3(0, 1, 0);

// SFX state
let _chargeOsc = null;
let _chargeGain = null;
let _chargeFilter = null;

// Persisted unlock — once you've earned it, you keep it.
const _UNLOCK_KEY = 'fireballUnlocked';
try { _unlocked = localStorage.getItem(_UNLOCK_KEY) === '1'; } catch (e) { }

// ── Public API ──────────────────────────────────────────────────────

export function init(refs) {
  _scene = refs.scene;
  _camera = refs.camera;
  _catGroup = refs.catGroup || null;
  _isFpMode = refs.isFpMode || (() => false);
}

export function isUnlocked() { return _unlocked; }

export function setUnlocked(v) {
  const next = !!v;
  if (next === _unlocked) return;
  _unlocked = next;
  try { localStorage.setItem(_UNLOCK_KEY, _unlocked ? '1' : '0'); } catch (e) { }
}

export function isCharging() { return _charging; }
export function getChargeRatio() { return _chargeRatio; }
export function isBeamActive() { return _beamActive; }

// Begin a charge. Idempotent: repeated calls (autorepeat) do nothing.
export function startCharge() {
  if (!_unlocked || !_scene || !_camera) return false;
  if (_charging || _beamActive) return false;
  _ensureBuilt();
  _charging = true;
  _chargeStartTs = _now();
  _chargeRatio = 0;
  _orbGroup.visible = true;
  _startChargeSfx();
  return true;
}

// Release the charge: fires the beam if held long enough, otherwise
// quietly cancels. Returns true if a beam was fired.
export function releaseCharge() {
  if (!_charging) return false;
  const heldSec = (_now() - _chargeStartTs) / 1000;
  _charging = false;
  _stopChargeSfx();
  // Hide the orb either way; the beam takes over the visual.
  _orbGroup.visible = false;
  if (heldSec < CHARGE_MIN_SEC) {
    _chargeRatio = 0;
    return false;
  }
  const ratio = Math.min(1, (heldSec - CHARGE_MIN_SEC) / (CHARGE_FULL_SEC - CHARGE_MIN_SEC));
  _fireBeam(ratio);
  return true;
}

// Backwards-compat: instant full-power shot (e.g. programmatic callers).
export function shoot() {
  if (!_unlocked || !_scene || !_camera) return false;
  _ensureBuilt();
  if (_charging) { _stopChargeSfx(); _charging = false; _orbGroup.visible = false; }
  _fireBeam(0.6);
  return true;
}

export function update(dtSec) {
  if (!_initBuilt) return;
  const t = _now();

  // ── Charge orb update ────────────────────────────────────────────
  if (_charging) {
    const heldSec = (t - _chargeStartTs) / 1000;
    _chargeRatio = Math.min(1, heldSec / CHARGE_FULL_SEC);
    _updateOrbTransform(t);
  }

  // ── Beam update ──────────────────────────────────────────────────
  if (_beamActive) {
    const phaseElapsed = (t - _beamPhaseStartTs) / 1000;
    if (_beamPhase === 'extend') {
      const k = Math.min(1, phaseElapsed / BEAM_EXTEND_SEC);
      const eased = 1 - Math.pow(1 - k, 3);
      _setBeamScale(eased * _beamMaxLen, _beamMaxRad, 1);
      if (k >= 1) { _beamPhase = 'hold'; _beamPhaseStartTs = t; }
    } else if (_beamPhase === 'hold') {
      // Subtle wobble in width to feel alive.
      const wob = 1 + 0.06 * Math.sin(phaseElapsed * 28);
      _setBeamScale(_beamMaxLen, _beamMaxRad * wob, 1);
      if (phaseElapsed >= _beamHoldDur) { _beamPhase = 'fade'; _beamPhaseStartTs = t; }
    } else if (_beamPhase === 'fade') {
      const k = Math.min(1, phaseElapsed / BEAM_FADE_SEC);
      const alpha = 1 - k;
      _setBeamScale(_beamMaxLen, _beamMaxRad * (1 - 0.4 * k), alpha);
      if (k >= 1) {
        _beamActive = false;
        _beamPhase = 'idle';
        _beamGroup.visible = false;
        if (_beamLight) _beamLight.intensity = 0;
      }
    }
  }
}

// ── Beam firing ─────────────────────────────────────────────────────

function _fireBeam(ratio) {
  // Snapshot aim now — beam is "fire and forget" relative to this pose.
  _getMuzzlePosition(_beamOrigin);
  _getAimDirection(_beamDir);

  _beamMaxLen = BEAM_BASE_LEN + (BEAM_MAX_LEN - BEAM_BASE_LEN) * ratio;
  _beamMaxRad = BEAM_BASE_RADIUS + (BEAM_MAX_RADIUS - BEAM_BASE_RADIUS) * ratio;
  _beamHoldDur = BEAM_HOLD_BASE_SEC + (BEAM_HOLD_FULL_SEC - BEAM_HOLD_BASE_SEC) * ratio;

  // Position beam group at origin, rotate to face aim direction.
  _beamGroup.position.copy(_beamOrigin);
  _tmpQuat.setFromUnitVectors(_tmpUp, _beamDir);
  _beamGroup.quaternion.copy(_tmpQuat);
  _beamGroup.visible = true;
  _setBeamScale(0.001, _beamMaxRad, 1);

  if (_beamLight) {
    _beamLight.position.copy(_beamOrigin);
    _beamLight.intensity = 4 + 6 * ratio;
  }

  _beamActive = true;
  _beamPhase = 'extend';
  _beamPhaseStartTs = _now();

  _playReleaseSfx(ratio);
}

// Cylinders are built along their local Y axis. After we rotate the
// group so Y points along aim direction, scaling Y stretches the beam.
// We also translate each cylinder so its NEAR end sits at the group
// origin (the cylinder geometry is centered, so we shift up by 0.5).
function _setBeamScale(lengthInches, radiusInches, alpha) {
  if (!_beamGroup) return;
  // Each cylinder mesh has its base geometry of length 1 (centered),
  // and we keep its position.y = 0.5 so its far end is the one that
  // extends. Scale Y by `lengthInches`, scale XZ by radius factor.
  const lenY = Math.max(0.001, lengthInches);
  const setMesh = (mesh, radiusMul, baseAlpha) => {
    if (!mesh) return;
    mesh.scale.set(radiusInches * radiusMul, lenY, radiusInches * radiusMul);
    mesh.position.y = lenY * 0.5;
    if (mesh.material && mesh.material.opacity !== undefined) {
      mesh.material.opacity = baseAlpha * alpha;
    }
  };
  setMesh(_beamCore, 0.35, 1.0);
  setMesh(_beamMid, 0.7, 0.75);
  setMesh(_beamOuter, 1.15, 0.35);

  if (_beamCap) {
    _beamCap.scale.setScalar(radiusInches * 1.5);
    _beamCap.position.set(0, 0, 0);
    if (_beamCap.material) _beamCap.material.opacity = 0.9 * alpha;
  }
}

// ── Charge orb visuals ──────────────────────────────────────────────

function _updateOrbTransform(t) {
  if (!_orbGroup) return;
  _getMuzzlePosition(_tmpOrigin);
  _getAimDirection(_tmpDir);
  // Place orb a bit in front of the muzzle, dropped slightly so it
  // reads as held in the hands rather than floating at eye level.
  _tmpOrigin.addScaledVector(_tmpDir, ORB_FORWARD);
  _tmpOrigin.y -= ORB_DOWN;
  _orbGroup.position.copy(_tmpOrigin);

  // Size grows with charge, with a quick pulse so it feels energetic.
  const pulse = 1 + 0.08 * Math.sin(t * 0.018);
  const r = (ORB_BASE_RADIUS + (ORB_MAX_RADIUS - ORB_BASE_RADIUS) * _chargeRatio) * pulse;
  _orbCore.scale.setScalar(r * 0.55);
  _orbInner.scale.setScalar(r * 0.85);
  _orbHaze.scale.setScalar(r * 1.35);

  // Brighten as charge approaches full.
  const brightK = 0.6 + 0.4 * _chargeRatio;
  if (_orbCore.material) _orbCore.material.opacity = brightK;
  if (_orbInner.material) _orbInner.material.opacity = 0.7 * brightK;
  if (_orbHaze.material) _orbHaze.material.opacity = 0.35 * brightK;
  if (_orbLight) _orbLight.intensity = 1.5 + 4 * _chargeRatio;
  if (_orbLight) _orbLight.position.copy(_tmpOrigin);
}

// ── Build (idempotent) ──────────────────────────────────────────────

function _ensureBuilt() {
  if (_initBuilt) return;
  if (!_scene) return;

  // ── Charge orb ──
  _orbGroup = new THREE.Group();
  _orbGroup.visible = false;
  _orbGroup.renderOrder = 999;
  _scene.add(_orbGroup);

  const orbCoreGeo = new THREE.SphereGeometry(1, 16, 12);
  _orbCore = new THREE.Mesh(orbCoreGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  _orbCore.renderOrder = 1001;
  _orbGroup.add(_orbCore);

  _orbInner = new THREE.Mesh(orbCoreGeo, new THREE.MeshBasicMaterial({
    color: 0x9be8ff, transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  _orbInner.renderOrder = 1000;
  _orbGroup.add(_orbInner);

  _orbHaze = new THREE.Mesh(orbCoreGeo, new THREE.MeshBasicMaterial({
    color: 0x4ab8ff, transparent: true, opacity: 0.35, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  _orbHaze.renderOrder = 999;
  _orbGroup.add(_orbHaze);

  _orbLight = new THREE.PointLight(0x66ccff, 0, 220, 1.6);
  _scene.add(_orbLight);

  // ── Beam ──
  _beamGroup = new THREE.Group();
  _beamGroup.visible = false;
  _scene.add(_beamGroup);

  // Open-ended cylinder so the beam looks tubular without flat caps.
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  const mkBeamMesh = (color, opacity, renderOrder) => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    m.renderOrder = renderOrder;
    m.position.y = 0.5;
    return m;
  };
  _beamOuter = mkBeamMesh(0x3aa6ff, 0.35, 998);
  _beamMid = mkBeamMesh(0x9be8ff, 0.75, 999);
  _beamCore = mkBeamMesh(0xffffff, 1.0, 1000);
  _beamGroup.add(_beamOuter);
  _beamGroup.add(_beamMid);
  _beamGroup.add(_beamCore);

  // Bright cap sphere at the muzzle end (the "burst" where the beam emits).
  const capGeo = new THREE.SphereGeometry(1, 16, 12);
  _beamCap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  _beamCap.renderOrder = 1001;
  _beamGroup.add(_beamCap);

  _beamLight = new THREE.PointLight(0x66ccff, 0, 600, 1.5);
  _scene.add(_beamLight);

  _initBuilt = true;
}

// ── Aim helpers ────────────────────────────────────────────────────

function _getMuzzlePosition(out) {
  if (_isFpMode() && _catGroup) {
    _catGroup.getWorldPosition(out);
    out.y += 9;
  } else {
    out.copy(_camera.position);
  }
  const fwd = _tmpDir;
  _getAimDirection(fwd);
  out.addScaledVector(fwd, 6);
  return out;
}

function _getAimDirection(out) {
  _camera.getWorldDirection(out);
  out.normalize();
  return out;
}

function _now() {
  return (typeof performance !== 'undefined') ? performance.now() : Date.now();
}

// ── SFX ────────────────────────────────────────────────────────────

// Charging hum: a low oscillator with a lowpass that sweeps up as the
// charge level rises, plus a slow tremolo for that "energy gathering"
// feel. Stays running until release/cancel.
function _startChargeSfx() {
  if (sfxMuted) return;
  const ac = coins.getAudioCtx();
  if (!ac) return;
  _stopChargeSfx();
  const now = ac.currentTime;
  _chargeOsc = ac.createOscillator();
  _chargeOsc.type = 'sawtooth';
  _chargeOsc.frequency.setValueAtTime(70, now);
  _chargeOsc.frequency.linearRampToValueAtTime(180, now + CHARGE_FULL_SEC);
  _chargeFilter = ac.createBiquadFilter();
  _chargeFilter.type = 'lowpass';
  _chargeFilter.Q.value = 6;
  _chargeFilter.frequency.setValueAtTime(180, now);
  _chargeFilter.frequency.linearRampToValueAtTime(2200, now + CHARGE_FULL_SEC);
  _chargeGain = ac.createGain();
  _chargeGain.gain.setValueAtTime(0.0001, now);
  _chargeGain.gain.linearRampToValueAtTime(0.10, now + 0.12);
  _chargeOsc.connect(_chargeFilter).connect(_chargeGain).connect(ac.destination);
  _chargeOsc.start(now);
}

function _stopChargeSfx() {
  if (!_chargeOsc) return;
  const ac = coins.getAudioCtx();
  if (!ac) { _chargeOsc = null; _chargeGain = null; _chargeFilter = null; return; }
  const now = ac.currentTime;
  try {
    _chargeGain.gain.cancelScheduledValues(now);
    _chargeGain.gain.setValueAtTime(_chargeGain.gain.value, now);
    _chargeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    _chargeOsc.stop(now + 0.1);
  } catch (e) { }
  _chargeOsc = null; _chargeGain = null; _chargeFilter = null;
}

let _noiseBuf = null;

// Big "HAAA!" release thump + airy wash. Scaled by power so weak shots
// don't deafen the player.
function _playReleaseSfx(ratio) {
  if (sfxMuted) return;
  const ac = coins.getAudioCtx();
  if (!ac) return;
  const now = ac.currentTime;

  if (!_noiseBuf) {
    const len = Math.floor(ac.sampleRate * 0.9);
    _noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const data = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  const power = 0.5 + 0.5 * ratio;

  // Bass thump — sub-y "kha!"
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(120, now);
  sub.frequency.exponentialRampToValueAtTime(40, now + 0.45);
  const subG = ac.createGain();
  subG.gain.setValueAtTime(0.0001, now);
  subG.gain.linearRampToValueAtTime(0.32 * power, now + 0.02);
  subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  sub.connect(subG).connect(ac.destination);
  sub.start(now);
  sub.stop(now + 0.6);

  // Airy noise wash — the sustained "beam" sound.
  const body = ac.createBufferSource();
  body.buffer = _noiseBuf;
  const lp = ac.createBiquadFilter();
  lp.type = 'bandpass';
  lp.Q.value = 1.4;
  lp.frequency.setValueAtTime(1800, now);
  lp.frequency.exponentialRampToValueAtTime(900, now + 0.7);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, now);
  bg.gain.linearRampToValueAtTime(0.10 * power, now + 0.05);
  bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
  body.connect(lp).connect(bg).connect(ac.destination);
  body.start(now);
  body.stop(now + 0.9);
}
