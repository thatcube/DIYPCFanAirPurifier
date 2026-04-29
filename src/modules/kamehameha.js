// ─── Kamehameha (charged energy beam) ──────────────────────────────
// Super-Saiyan-only ability. Hold F while SS is active to charge a
// glowing orb; release to fire a thick blue/white beam. Replaces the
// regular fireball spam during SS mode.

import * as THREE from 'three';
import * as coins from './coins.js';
import * as fireball from './fireball.js';
import { sfxMuted } from './game-fp.js';

// ── Config ──────────────────────────────────────────────────────────

const CHARGE_MIN_SEC = 0.28;
const CHARGE_FULL_SEC = 1.10;
const ORB_BASE_RADIUS = 1.3;
const ORB_MAX_RADIUS = 5.5;
const ORB_FORWARD = 4;
const ORB_DOWN = 0;

const BEAM_BASE_LEN = 240;
const BEAM_MAX_LEN = 620;
const BEAM_BASE_RADIUS = 3.2;
const BEAM_MAX_RADIUS = 6.5;
const BEAM_EXTEND_SEC = 0.10;
const BEAM_HOLD_BASE_SEC = 1.20;
const BEAM_HOLD_FULL_SEC = 3.20;
const BEAM_FADE_SEC = 0.40;

// Burn-mark cadence while the beam is sustained against a surface.
const SCORCH_STEP_INCHES = 0.9;   // distance between stamps along the trail
const SCORCH_MAX_STAMPS_PER_FRAME = 18; // safety cap when beam sweeps fast
const SCORCH_SIZE_MUL_BASE = 1.4;  // beam scorches are bigger than fireball ones
const SCORCH_SIZE_MUL_FULL = 2.6;

// ── State ───────────────────────────────────────────────────────────

let _scene = null;
let _camera = null;
let _catGroup = null;
let _isFpMode = () => false;
let _initBuilt = false;

let _charging = false;
let _chargeStartTs = 0;
let _chargeRatio = 0;

let _beamActive = false;
let _beamPhase = 'idle';
let _beamPhaseStartTs = 0;
let _beamHoldDur = 0;
let _beamFullLen = 0;          // full range when nothing's in the way
let _beamMaxLen = 0;            // current visual length (clamped to nearest hit)
let _beamMaxRad = 0;
let _beamSizeMul = 1;
let _beamScorchAccum = 0;
let _beamHasLastScorch = false;
const _beamLastScorchPoint = new THREE.Vector3();
let _beamLastScorchObj = null;
let _beamHit = null;            // last raycast result (or null if hit nothing)
const _beamHitPoint = new THREE.Vector3();
const _beamHitNormal = new THREE.Vector3();
const _beamOrigin = new THREE.Vector3();
const _beamDir = new THREE.Vector3();

const _beamRaycaster = new THREE.Raycaster();
const _beamRcResults = [];
const _tmpScorchPoint = new THREE.Vector3();
const _tmpInvNormal = new THREE.Vector3();
const _tmpScorchHit = { point: new THREE.Vector3(), face: null, object: null };

let _orbGroup = null;
let _orbCore = null;
let _orbInner = null;
let _orbHaze = null;
let _orbLight = null;

let _beamGroup = null;
let _beamCore = null;
let _beamMid = null;
let _beamOuter = null;
let _beamCap = null;
let _beamLight = null;

const _tmpDir = new THREE.Vector3();
const _tmpOrigin = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpUp = new THREE.Vector3(0, 1, 0);

let _chargeOsc = null;
let _chargeGain = null;
let _chargeFilter = null;

// Sustain layer that plays for the duration of the beam (post-release):
// a filtered noise hiss + a low rumble, both fading out with the beam.
let _sustainSrc = null;
let _sustainGain = null;
let _sustainHum = null;
let _sustainHumGain = null;

// ── Public API ──────────────────────────────────────────────────────

export function init(refs) {
  _scene = refs.scene;
  _camera = refs.camera;
  _catGroup = refs.catGroup || null;
  _isFpMode = refs.isFpMode || (() => false);
}

export function isCharging() { return _charging; }
export function getChargeRatio() { return _chargeRatio; }
export function isBeamActive() { return _beamActive; }

export function startCharge() {
  if (!_scene || !_camera) return false;
  if (_charging || _beamActive) return false;
  _ensureBuilt();
  _charging = true;
  _chargeStartTs = _now();
  _chargeRatio = 0;
  _orbGroup.visible = true;
  _startChargeSfx();
  return true;
}

export function releaseCharge() {
  if (!_charging) return false;
  const heldSec = (_now() - _chargeStartTs) / 1000;
  _charging = false;
  _stopChargeSfx();
  _orbGroup.visible = false;
  if (heldSec < CHARGE_MIN_SEC) {
    _chargeRatio = 0;
    return false;
  }
  const ratio = Math.min(1, (heldSec - CHARGE_MIN_SEC) / (CHARGE_FULL_SEC - CHARGE_MIN_SEC));
  _fireBeam(ratio);
  return true;
}

// Force-cancel any in-progress charge (e.g. SS expired mid-charge).
export function cancelCharge() {
  if (!_charging) return false;
  _charging = false;
  _chargeRatio = 0;
  _stopChargeSfx();
  if (_orbGroup) _orbGroup.visible = false;
  return true;
}

export function update(dtSec) {
  if (!_initBuilt) return;
  const t = _now();

  if (_charging) {
    const heldSec = (t - _chargeStartTs) / 1000;
    _chargeRatio = Math.min(1, heldSec / CHARGE_FULL_SEC);
    _updateOrbTransform(t);
    // Cut the charge whir if SFX gets muted mid-charge.
    if (sfxMuted && _chargeOsc) _stopChargeSfx();
  }

  if (_beamActive) {
    // Re-aim every frame so the beam tracks the player (origin) and
    // their current look direction, then re-raycast so the visual
    // length and burn point follow whatever's currently in the way.
    _refreshBeamAim();

    const phaseElapsed = (t - _beamPhaseStartTs) / 1000;
    if (_beamPhase === 'extend') {
      const k = Math.min(1, phaseElapsed / BEAM_EXTEND_SEC);
      const eased = 1 - Math.pow(1 - k, 3);
      // Beam thins from full burst radius down to ~35% during extend,
      // and the cap shrinks from a big flash to a tiny pinpoint.
      const radMul = 1 - 0.65 * eased;
      const capMul = 1.5 - 1.32 * eased;
      _setBeamScale(eased * _beamMaxLen, _beamMaxRad * radMul, 1, capMul);
      if (k >= 1) { _beamPhase = 'hold'; _beamPhaseStartTs = t; }
    } else if (_beamPhase === 'hold') {
      const wob = 1 + 0.06 * Math.sin(phaseElapsed * 28);
      // Sustain phase: thin beam + tiny pulsing muzzle flare so the
      // cat isn't hidden behind a giant orb.
      const radMul = 0.35 * wob;
      const capMul = 0.18 + 0.04 * Math.sin(phaseElapsed * 22);
      _setBeamScale(_beamMaxLen, _beamMaxRad * radMul, 1, capMul);
      // Burn a continuous trail along the surface as the beam sweeps.
      if (_beamHit) {
        _emitBeamScorchTrail();
      } else {
        _beamHasLastScorch = false;
      }
      if (phaseElapsed >= _beamHoldDur) { _beamPhase = 'fade'; _beamPhaseStartTs = t; }
    } else if (_beamPhase === 'fade') {
      const k = Math.min(1, phaseElapsed / BEAM_FADE_SEC);
      const alpha = 1 - k;
      _setBeamScale(_beamMaxLen, _beamMaxRad * 0.35 * (1 - 0.4 * k), alpha, 0.18);
      if (k >= 1) {
        _beamActive = false;
        _beamPhase = 'idle';
        _beamGroup.visible = false;
        if (_beamLight) _beamLight.intensity = 0;
        _stopSustainSfx();
      }
    }
    // SFX mute should kill the sustained whoosh immediately.
    if (sfxMuted && _sustainSrc) _stopSustainSfx();
  }
}

// ── Beam firing ─────────────────────────────────────────────────────

function _fireBeam(ratio) {
  _getMuzzlePosition(_beamOrigin);
  _getAimDirection(_beamDir);

  _beamFullLen = BEAM_BASE_LEN + (BEAM_MAX_LEN - BEAM_BASE_LEN) * ratio;
  _beamMaxRad = BEAM_BASE_RADIUS + (BEAM_MAX_RADIUS - BEAM_BASE_RADIUS) * ratio;
  _beamHoldDur = BEAM_HOLD_BASE_SEC + (BEAM_HOLD_FULL_SEC - BEAM_HOLD_BASE_SEC) * ratio;
  _beamSizeMul = SCORCH_SIZE_MUL_BASE + (SCORCH_SIZE_MUL_FULL - SCORCH_SIZE_MUL_BASE) * ratio;
  _beamScorchAccum = 0;
  _beamHasLastScorch = false;
  _beamLastScorchObj = null;

  // Initial raycast & beam-group placement; the per-frame _refreshBeamAim
  // will keep these updated so the beam follows the player after release.
  _beamHit = _raycastBeam(_beamOrigin, _beamDir, _beamFullLen);
  _beamMaxLen = _beamHit ? Math.max(1, _beamHit.distance) : _beamFullLen;
  if (_beamHit) _emitBeamScorchTrail();

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
  _startSustainSfx(ratio);
}

// Recompute origin/direction from the current player pose, re-orient
// the beam group, re-raycast against the world to update visual length
// and the burn point. Called every frame while the beam is alive.
function _refreshBeamAim() {
  _getMuzzlePosition(_beamOrigin);
  _getAimDirection(_beamDir);
  _beamGroup.position.copy(_beamOrigin);
  _tmpQuat.setFromUnitVectors(_tmpUp, _beamDir);
  _beamGroup.quaternion.copy(_tmpQuat);
  _beamHit = _raycastBeam(_beamOrigin, _beamDir, _beamFullLen);
  _beamMaxLen = _beamHit ? Math.max(1, _beamHit.distance) : _beamFullLen;
  if (_beamLight) _beamLight.position.copy(_beamOrigin);
}

// Raycast forward from origin along dir, up to maxDist. Skips objects
// we own (beam meshes / orb / scorch decals all flag _fireballSkip).
function _raycastBeam(origin, dir, maxDist) {
  if (!_scene) return null;
  _beamRaycaster.set(origin, dir);
  // Push the near plane out a bit so the cat / player collider /
  // anything attached to the camera doesn't count as the first hit
  // and freeze the beam in mid-air.
  _beamRaycaster.near = 4;
  _beamRaycaster.far = maxDist;
  _beamRaycaster.camera = _camera;
  _beamRcResults.length = 0;
  _beamRaycaster.intersectObject(_scene, true, _beamRcResults);
  for (let i = 0; i < _beamRcResults.length; i++) {
    const h = _beamRcResults[i];
    let o = h.object;
    let skip = false;
    while (o) {
      if (o.userData && o.userData._fireballSkip) { skip = true; break; }
      // Never let the player's own cat block the beam.
      if (_catGroup && o === _catGroup) { skip = true; break; }
      o = o.parent;
    }
    if (skip) continue;
    // Cache normal + point so we can reuse them every frame in hold.
    _beamHitPoint.copy(h.point);
    if (h.face && h.object && h.object.matrixWorld) {
      _beamHitNormal.copy(h.face.normal)
        .transformDirection(h.object.matrixWorld)
        .normalize();
    } else {
      _beamHitNormal.copy(dir).multiplyScalar(-1);
    }
    return h;
  }
  return null;
}

// Stamp scorch decals continuously along the path the hit point
// traces over the surface. Produces a drawn-line look instead of
// scattered splatter circles. Skips when the beam jumps surfaces.
function _emitBeamScorchTrail() {
  if (!_beamHit) return;
  const hitObj = _beamHit.object || null;
  // First stamp on this surface — drop one decal and seed the path.
  if (!_beamHasLastScorch || hitObj !== _beamLastScorchObj) {
    _stampScorchAt(_beamHitPoint);
    _beamLastScorchPoint.copy(_beamHitPoint);
    _beamLastScorchObj = hitObj;
    _beamHasLastScorch = true;
    return;
  }
  const dx = _beamHitPoint.x - _beamLastScorchPoint.x;
  const dy = _beamHitPoint.y - _beamLastScorchPoint.y;
  const dz = _beamHitPoint.z - _beamLastScorchPoint.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < SCORCH_STEP_INCHES) return;
  const steps = Math.min(
    SCORCH_MAX_STAMPS_PER_FRAME,
    Math.floor(dist / SCORCH_STEP_INCHES)
  );
  const inv = 1 / dist;
  const ux = dx * inv, uy = dy * inv, uz = dz * inv;
  for (let i = 1; i <= steps; i++) {
    const d = i * SCORCH_STEP_INCHES;
    _tmpScorchPoint.set(
      _beamLastScorchPoint.x + ux * d,
      _beamLastScorchPoint.y + uy * d,
      _beamLastScorchPoint.z + uz * d
    );
    _stampScorchAt(_tmpScorchPoint);
  }
  // Advance the cursor by exactly the number of steps we stamped so
  // remainder distance carries cleanly into the next frame.
  const advance = steps * SCORCH_STEP_INCHES;
  _beamLastScorchPoint.x += ux * advance;
  _beamLastScorchPoint.y += uy * advance;
  _beamLastScorchPoint.z += uz * advance;
}

function _stampScorchAt(point) {
  _tmpScorchHit.point.copy(point);
  // _spawnScorch transforms hit.face.normal by hit.object.matrixWorld.
  // We already store the world-space normal, so feed null/no-face and
  // pass -normal as the travel dir so the fallback (-travelDir) yields
  // exactly our world normal.
  _tmpScorchHit.face = null;
  _tmpScorchHit.object = null;
  _tmpInvNormal.copy(_beamHitNormal).multiplyScalar(-1);
  fireball.spawnLaserScorch(_tmpScorchHit, _tmpInvNormal, _beamSizeMul);
}

function _setBeamScale(lengthInches, radiusInches, alpha, capMul = 1.5) {
  if (!_beamGroup) return;
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
    _beamCap.scale.setScalar(radiusInches * capMul);
    _beamCap.position.set(0, 0, 0);
    if (_beamCap.material) _beamCap.material.opacity = 0.9 * alpha;
  }
}

function _updateOrbTransform(t) {
  if (!_orbGroup) return;
  _getMuzzlePosition(_tmpOrigin);
  _getAimDirection(_tmpDir);
  _tmpOrigin.addScaledVector(_tmpDir, ORB_FORWARD);
  _tmpOrigin.y -= ORB_DOWN;
  _orbGroup.position.copy(_tmpOrigin);

  const pulse = 1 + 0.08 * Math.sin(t * 0.018);
  const r = (ORB_BASE_RADIUS + (ORB_MAX_RADIUS - ORB_BASE_RADIUS) * _chargeRatio) * pulse;
  _orbCore.scale.setScalar(r * 0.55);
  _orbInner.scale.setScalar(r * 0.85);
  _orbHaze.scale.setScalar(r * 1.35);

  const brightK = 0.6 + 0.4 * _chargeRatio;
  if (_orbCore.material) _orbCore.material.opacity = brightK;
  if (_orbInner.material) _orbInner.material.opacity = 0.7 * brightK;
  if (_orbHaze.material) _orbHaze.material.opacity = 0.35 * brightK;
  if (_orbLight) _orbLight.intensity = 1.5 + 4 * _chargeRatio;
  if (_orbLight) _orbLight.position.copy(_tmpOrigin);
}

function _ensureBuilt() {
  if (_initBuilt) return;
  if (!_scene) return;

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

  _beamGroup = new THREE.Group();
  _beamGroup.visible = false;
  _scene.add(_beamGroup);

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
  // Flag every beam mesh so our own raycast (and the fireball's) skips them.
  _beamOuter.userData._fireballSkip = true;
  _beamMid.userData._fireballSkip = true;
  _beamCore.userData._fireballSkip = true;
  _beamGroup.userData._fireballSkip = true;
  _beamGroup.add(_beamOuter);
  _beamGroup.add(_beamMid);
  _beamGroup.add(_beamCore);

  const capGeo = new THREE.SphereGeometry(1, 16, 12);
  _beamCap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  _beamCap.renderOrder = 1001;
  _beamCap.userData._fireballSkip = true;
  _beamGroup.add(_beamCap);

  _beamLight = new THREE.PointLight(0x66ccff, 0, 600, 1.5);
  _scene.add(_beamLight);

  _initBuilt = true;
}

function _getMuzzlePosition(out) {
  if (_isFpMode() && _catGroup) {
    _catGroup.getWorldPosition(out);
    out.y += 1;
  } else {
    out.copy(_camera.position);
    out.y -= 4;
  }
  const fwd = _tmpDir;
  _getAimDirection(fwd);
  out.addScaledVector(fwd, 3);
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

// Sustained "blast" loop while the beam is still being projected after
// the initial release. Filtered white noise hiss + a sub rumble; both
// auto-fade as the beam's hold + fade phases play out.
function _startSustainSfx(ratio) {
  if (sfxMuted) return;
  const ac = coins.getAudioCtx();
  if (!ac) return;
  _stopSustainSfx();

  const now = ac.currentTime;
  const power = 0.55 + 0.45 * ratio;
  const totalSec = BEAM_EXTEND_SEC + _beamHoldDur + BEAM_FADE_SEC;

  if (!_noiseBuf) {
    const len = Math.floor(ac.sampleRate * 0.9);
    _noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const data = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Hiss layer: looping bandpassed noise — the "spraying" beam body.
  _sustainSrc = ac.createBufferSource();
  _sustainSrc.buffer = _noiseBuf;
  _sustainSrc.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(1400, now);
  bp.frequency.linearRampToValueAtTime(2200, now + totalSec);
  _sustainGain = ac.createGain();
  _sustainGain.gain.setValueAtTime(0.0001, now);
  _sustainGain.gain.linearRampToValueAtTime(0.085 * power, now + 0.10);
  // Hold most of the duration, then ramp to silence by the end.
  _sustainGain.gain.setValueAtTime(0.085 * power, now + totalSec - BEAM_FADE_SEC);
  _sustainGain.gain.exponentialRampToValueAtTime(0.0001, now + totalSec);
  _sustainSrc.connect(bp).connect(_sustainGain).connect(ac.destination);
  _sustainSrc.start(now);
  _sustainSrc.stop(now + totalSec + 0.05);

  // Sub rumble layer: low sine, gives the beam weight.
  _sustainHum = ac.createOscillator();
  _sustainHum.type = 'sine';
  _sustainHum.frequency.setValueAtTime(58, now);
  _sustainHum.frequency.linearRampToValueAtTime(46, now + totalSec);
  _sustainHumGain = ac.createGain();
  _sustainHumGain.gain.setValueAtTime(0.0001, now);
  _sustainHumGain.gain.linearRampToValueAtTime(0.11 * power, now + 0.12);
  _sustainHumGain.gain.setValueAtTime(0.11 * power, now + totalSec - BEAM_FADE_SEC);
  _sustainHumGain.gain.exponentialRampToValueAtTime(0.0001, now + totalSec);
  _sustainHum.connect(_sustainHumGain).connect(ac.destination);
  _sustainHum.start(now);
  _sustainHum.stop(now + totalSec + 0.05);
}

function _stopSustainSfx() {
  const ac = coins.getAudioCtx();
  const now = ac ? ac.currentTime : 0;
  if (_sustainGain && ac) {
    try {
      _sustainGain.gain.cancelScheduledValues(now);
      _sustainGain.gain.setValueAtTime(_sustainGain.gain.value, now);
      _sustainGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch (e) { }
  }
  if (_sustainHumGain && ac) {
    try {
      _sustainHumGain.gain.cancelScheduledValues(now);
      _sustainHumGain.gain.setValueAtTime(_sustainHumGain.gain.value, now);
      _sustainHumGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch (e) { }
  }
  try { _sustainSrc && _sustainSrc.stop(now + 0.1); } catch (e) { }
  try { _sustainHum && _sustainHum.stop(now + 0.1); } catch (e) { }
  _sustainSrc = null; _sustainGain = null;
  _sustainHum = null; _sustainHumGain = null;
}
