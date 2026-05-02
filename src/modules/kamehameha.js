// ─── Kamehameha (charged energy beam) ──────────────────────────────
// Super-Saiyan-only ability. Hold F while SS is active to charge a
// glowing orb; release to fire a thick blue/white beam. Replaces the
// regular fireball spam during SS mode.

import * as THREE from 'three';
import * as coins from './coins.js';
import * as fireball from './fireball.js';
import { sfxMuted } from './game-fp.js';

// ── Config ──────────────────────────────────────────────────────────

// Hold time before a release will actually fire anything. Release
// earlier than this and nothing happens (silent fizzle).
const CHARGE_MIN_SEC = 2.0;
// Time at which the orb has reached its "comfortably big" size. The
// orb keeps growing past this, just much more slowly. Also the point
// at which the cannon flips to red mode (bigger + red beam).
const CHARGE_FULL_SEC = 10.0;
const RED_THRESHOLD_SEC = 10.0;
// Hold past this and the cat overcharges and detonates itself. The
// 5-second window between RED and DEATH is the "danger zone" — the
// dread SFX layer ramps in, the orb pulses faster, and releasing F
// any time before this fires the red beam normally with no penalty.
const DEATH_THRESHOLD_SEC = 15.0;
const DANGER_WINDOW_SEC = DEATH_THRESHOLD_SEC - RED_THRESHOLD_SEC;

const ORB_BASE_RADIUS = 1.3;
const ORB_FULL_RADIUS = 12.0;   // size at CHARGE_FULL_SEC
const ORB_SLOW_GROWTH = 0.10;   // additional inches per second past full
const ORB_FORWARD = 14;
const ORB_DOWN = 0;

// Beam dimensions are fixed (do NOT scale with charge time). The only
// charge-driven knob is duration (1:1 with hold time) and a one-step
// red-cannon upgrade once you cross the threshold.
const BEAM_LEN = 620;
const BEAM_RADIUS = 3.6;
const BEAM_RED_RADIUS_MUL = 1.5;
const BEAM_EXTEND_SEC = 0.10;
const BEAM_FADE_SEC = 0.40;

// Burn-mark cadence while the beam is sustained against a surface.
const SCORCH_STEP_INCHES = 0.9;   // distance between stamps along the trail
const SCORCH_MAX_STAMPS_PER_FRAME = 18; // safety cap when beam sweeps fast
const SCORCH_SIZE_BLUE = 1.6;     // size mul fed to spawnLaserScorch
const SCORCH_SIZE_RED = 2.6;

// Orb / beam palettes. Colors are applied to existing materials when
// crossing the red threshold so we never need to rebuild meshes.
const ORB_COLORS_BLUE = { core: 0xffffff, inner: 0x9be8ff, haze: 0x4ab8ff, light: 0x66ccff, shimmer: 0x000000 };
const ORB_COLORS_RED  = { core: 0xfff2c0, inner: 0xff7733, haze: 0xc01a08, light: 0xff5530, shimmer: 0x550400 };
const BEAM_COLORS_BLUE = { outer: 0x3aa6ff, mid: 0x9be8ff, core: 0xffffff, cap: 0xffffff, light: 0x66ccff };
const BEAM_COLORS_RED  = { outer: 0xff2a14, mid: 0xff8a3a, core: 0xfff0c0, cap: 0xfff0c0, light: 0xff5520 };

// ── State ───────────────────────────────────────────────────────────

let _scene = null;
let _camera = null;
let _catGroup = null;
let _isFpMode = () => false;
let _initBuilt = false;
// Optional callback fired exactly once when the player overcharges past
// DEATH_THRESHOLD_SEC. Wired by main.js to drive the death flow
// (skateboard dismount, cat tip-over, "even further beyond" overlay).
let _onOvercharge = null;

let _charging = false;
let _chargeStartTs = 0;
// 0..1 across the first CHARGE_FULL_SEC seconds; clamps at 1 past that.
// Used for visual easing (orb size, color blend) — not for gating.
let _chargeRatio = 0;
// Total seconds the charge button has been held. Drives orb size past
// the comfortable max and is also the beam's hold duration (1:1).
let _chargeHeldSec = 0;
// True once the held charge crosses RED_THRESHOLD_SEC during the
// current charge. Latches so the orb doesn't flicker around the line.
let _chargeRed = false;

let _beamActive = false;
let _beamPhase = 'idle';
let _beamPhaseStartTs = 0;
let _beamHoldDur = 0;
let _beamFullLen = 0;          // full range when nothing's in the way
let _beamMaxLen = 0;            // current visual length (clamped to nearest hit)
let _beamMaxRad = 0;
let _beamSizeMul = 1;
let _beamRed = false;          // locked at fire time
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
// Extra mesh layered over the orb in red mode for the dark-core +
// heat-shimmer look. Hidden while the orb is still blue.
let _orbShimmer = null;
let _orbLight = null;

let _beamGroup = null;
let _beamCore = null;
let _beamMid = null;
let _beamOuter = null;
let _beamCap = null;
let _beamLight = null;

// Self-destruct explosion (built lazily on first overcharge). Three
// concentric additive spheres + a point light, all expanding & fading.
let _kaboomGroup = null;
let _kaboomCore = null;
let _kaboomMid = null;
let _kaboomOuter = null;
let _kaboomLight = null;
let _kaboomActive = false;
let _kaboomStartTs = 0;
const KABOOM_DUR_SEC = 0.65;
const KABOOM_PEAK_RADIUS = 28;

const _tmpDir = new THREE.Vector3();
const _tmpOrigin = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpUp = new THREE.Vector3(0, 1, 0);

let _chargeOsc = null;
let _chargeGain = null;
let _chargeFilter = null;

// Dread layer that plays during the 5-second red→death danger window.
// Detuned dissonant whine + pitched rumble that ramps to peak at death.
let _dreadOscA = null;
let _dreadOscB = null;
let _dreadGain = null;
let _dreadRumble = null;
let _dreadRumbleGain = null;
let _dreadActive = false;

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
  _onOvercharge = (typeof refs.onOvercharge === 'function') ? refs.onOvercharge : null;
}

export function isCharging() { return _charging; }
export function getChargeRatio() { return _chargeRatio; }
export function isBeamActive() { return _beamActive; }

// Pre-build the orb, beam, kaboom meshes and their lights up front,
// then compile their shader programs so the first F-hold doesn't
// stutter on shader compile or material allocation. Safe to call
// multiple times — _ensureBuilt() is idempotent.
export function prewarm(renderer) {
  if (!_scene || !_camera) return;
  _ensureBuilt();
  if (renderer && renderer.compile) {
    try { renderer.compile(_scene, _camera); } catch (e) { }
  }
}

export function startCharge() {
  if (!_scene || !_camera) return false;
  if (_charging || _beamActive) return false;
  _ensureBuilt();
  _charging = true;
  _chargeStartTs = _now();
  _chargeRatio = 0;
  _chargeHeldSec = 0;
  _chargeRed = false;
  _applyOrbPalette(false);
  _orbGroup.visible = true;
  _startChargeSfx();
  return true;
}

export function releaseCharge() {
  if (!_charging) return false;
  const heldSec = (_now() - _chargeStartTs) / 1000;
  _charging = false;
  _stopChargeSfx();
  _stopDreadSfx();
  _orbGroup.visible = false;
  // Fizzle silently if you let go before the minimum hold. No beam,
  // no SFX, nothing — the held-too-short attempt just disappears.
  if (heldSec < CHARGE_MIN_SEC) {
    _chargeRatio = 0;
    _chargeHeldSec = 0;
    return false;
  }
  _fireBeam(heldSec);
  return true;
}

// Force-cancel any in-progress charge (e.g. SS expired mid-charge).
export function cancelCharge() {
  if (!_charging) return false;
  _charging = false;
  _chargeRatio = 0;
  _chargeHeldSec = 0;
  _chargeRed = false;
  _stopChargeSfx();
  _stopDreadSfx();
  if (_orbGroup) _orbGroup.visible = false;
  return true;
}

// Player overcharged past the danger window — orb detonates in their
// face. Cleans up the charge state, plays a kaboom, fires the wired
// onOvercharge callback so the death flow can take over.
function _triggerOvercharge() {
  // Capture orb position before we hide it, so the explosion lines up.
  const explodeAt = _tmpOrigin.copy(_orbGroup ? _orbGroup.position : _camera.position);
  _charging = false;
  _chargeRatio = 0;
  _chargeHeldSec = 0;
  _chargeRed = false;
  _stopChargeSfx();
  _stopDreadSfx();
  if (_orbGroup) _orbGroup.visible = false;
  _spawnOverchargeExplosion(explodeAt);
  _playOverchargeBoomSfx();
  if (_onOvercharge) {
    try { _onOvercharge(); } catch (e) { console.warn('[kamehameha] onOvercharge cb failed', e); }
  }
}

export function update(dtSec) {
  if (!_initBuilt) return;
  const t = _now();

  if (_kaboomActive) _updateKaboom(t);

  if (_charging) {
    const heldSec = (t - _chargeStartTs) / 1000;
    _chargeHeldSec = heldSec;
    _chargeRatio = Math.min(1, heldSec / CHARGE_FULL_SEC);
    // Latch into red mode once we cross the threshold; stays red for
    // the rest of this charge.
    if (!_chargeRed && heldSec >= RED_THRESHOLD_SEC) {
      _chargeRed = true;
      _applyOrbPalette(true);
    }
    // Once we're in the red zone, layer in the dread SFX whose
    // intensity ramps with how close we are to detonation.
    if (heldSec >= RED_THRESHOLD_SEC) {
      const dangerK = Math.max(0, Math.min(1, (heldSec - RED_THRESHOLD_SEC) / DANGER_WINDOW_SEC));
      _updateDreadSfx(dangerK);
    }
    // Held past the red zone for too long → cat detonates itself.
    if (heldSec >= DEATH_THRESHOLD_SEC) {
      _triggerOvercharge();
      return;
    }
    _updateOrbTransform(t);
    // Cut the charge whir if SFX gets muted mid-charge.
    if (sfxMuted && _chargeOsc) _stopChargeSfx();
    if (sfxMuted && _dreadActive) _stopDreadSfx();
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

function _fireBeam(heldSec) {
  _getMuzzlePosition(_beamOrigin);
  _getAimDirection(_beamDir);

  // Red cannon mode if the player held past the threshold. Locks the
  // beam's color + radius for its whole lifetime.
  _beamRed = heldSec >= RED_THRESHOLD_SEC;
  _applyBeamPalette(_beamRed);

  _beamFullLen = BEAM_LEN;
  _beamMaxRad = BEAM_RADIUS * (_beamRed ? BEAM_RED_RADIUS_MUL : 1);
  // Beam is sustained for half as long as you charged. Uncapped —
  // a 60s charge gives a 30s beam, a 5min charge gives 2:30.
  _beamHoldDur = heldSec * 0.5;
  _beamSizeMul = _beamRed ? SCORCH_SIZE_RED : SCORCH_SIZE_BLUE;
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
    _beamLight.intensity = _beamRed ? 11 : 7;
  }

  _beamActive = true;
  _beamPhase = 'extend';
  _beamPhaseStartTs = _now();

  // SFX power scales with the first 10s of charge so short shots stay
  // modest and red-cannon shots stay loud, without growing forever.
  const sfxRatio = Math.min(1, heldSec / RED_THRESHOLD_SEC);
  _playReleaseSfx(sfxRatio);
  _startSustainSfx(sfxRatio);
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
      // Skip our own FX, the caster, mid-air particles/sprites, and
      // anything already opted out of clicks (soft visual FX, scorch
      // decals, etc). Without this the beam ate floating air-flow
      // particles and stamped burn marks mid-air.
      if (o.isPoints || o.isSprite) { skip = true; break; }
      if (o.userData) {
        if (o.userData._fireballSkip) { skip = true; break; }
        if (o.userData.clickPassthrough) { skip = true; break; }
      }
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

  // Orb size: smooth easing from BASE → FULL across the first
  // CHARGE_FULL_SEC seconds, then very slow uncapped growth past that.
  // Ease-out so the early growth feels punchy and the late growth
  // doesn't visually run away.
  const eo = 1 - Math.pow(1 - _chargeRatio, 2);
  let baseR = ORB_BASE_RADIUS + (ORB_FULL_RADIUS - ORB_BASE_RADIUS) * eo;
  if (_chargeHeldSec > CHARGE_FULL_SEC) {
    baseR += (_chargeHeldSec - CHARGE_FULL_SEC) * ORB_SLOW_GROWTH;
  }
  // Faster wobble in red mode to read as unstable / overcharged.
  const pulseSpeed = _chargeRed ? 0.040 : 0.018;
  const pulseAmp = _chargeRed ? 0.12 : 0.08;
  const pulse = 1 + pulseAmp * Math.sin(t * pulseSpeed);
  const r = baseR * pulse;
  _orbCore.scale.setScalar(r * 0.55);
  _orbInner.scale.setScalar(r * 0.85);
  _orbHaze.scale.setScalar(r * 1.35);

  const brightK = 0.6 + 0.4 * _chargeRatio;
  if (_orbCore.material) _orbCore.material.opacity = brightK;
  if (_orbInner.material) _orbInner.material.opacity = 0.7 * brightK;
  if (_orbHaze.material) _orbHaze.material.opacity = 0.35 * brightK;
  if (_orbLight) _orbLight.intensity = 1.5 + 4 * _chargeRatio;
  if (_orbLight) _orbLight.position.copy(_tmpOrigin);

  // Heat-shimmer overlay: only visible in red mode. A dark-red sphere
  // sized just inside the haze, with a fast offset pulse so it reads
  // as a roiling hot core rather than a static layer.
  if (_orbShimmer) {
    if (_chargeRed) {
      _orbShimmer.visible = true;
      const shimmerPulse = 1 + 0.18 * Math.sin(t * 0.055 + 1.7);
      _orbShimmer.scale.setScalar(r * 0.72 * shimmerPulse);
      if (_orbShimmer.material) _orbShimmer.material.opacity = 0.55 + 0.25 * Math.sin(t * 0.07);
    } else {
      _orbShimmer.visible = false;
    }
  }
}

// Swap the orb's three layer colors (and the point light) between
// blue and red palettes. Called on charge-start (always blue) and the
// instant the player crosses the red threshold.
function _applyOrbPalette(red) {
  if (!_orbCore) return;
  const p = red ? ORB_COLORS_RED : ORB_COLORS_BLUE;
  if (_orbCore.material) _orbCore.material.color.setHex(p.core);
  if (_orbInner.material) _orbInner.material.color.setHex(p.inner);
  if (_orbHaze.material) _orbHaze.material.color.setHex(p.haze);
  if (_orbLight) _orbLight.color.setHex(p.light);
  if (_orbShimmer && _orbShimmer.material) _orbShimmer.material.color.setHex(p.shimmer);
}

// Same idea for the beam meshes — locked at fire time so the color
// can't change mid-shot.
function _applyBeamPalette(red) {
  if (!_beamCore) return;
  const p = red ? BEAM_COLORS_RED : BEAM_COLORS_BLUE;
  if (_beamOuter && _beamOuter.material) _beamOuter.material.color.setHex(p.outer);
  if (_beamMid && _beamMid.material) _beamMid.material.color.setHex(p.mid);
  if (_beamCore && _beamCore.material) _beamCore.material.color.setHex(p.core);
  if (_beamCap && _beamCap.material) _beamCap.material.color.setHex(p.cap);
  if (_beamLight) _beamLight.color.setHex(p.light);
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

  // Heat-shimmer layer (red mode only): NormalBlending dark-red sphere
  // that sits inside the haze. Hidden until red mode latches on.
  _orbShimmer = new THREE.Mesh(orbCoreGeo, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
  }));
  _orbShimmer.renderOrder = 1002;
  _orbShimmer.visible = false;
  _orbGroup.add(_orbShimmer);

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

  // Build the overcharge kaboom up front too. Its PointLight is what
  // forces the shader recompile that causes a stutter on first death;
  // pulling it into _ensureBuilt makes the recompile happen on first
  // charge instead, long before the player could overcharge.
  _ensureKaboomBuilt();

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

// ── Dread SFX (red→death danger window) ────────────────────────────
// Two slightly detuned sawtooths that beat against each other plus a
// pitched-up rumble. Volume + brightness ramp with `dangerK` (0..1).
function _ensureDreadSfxBuilt() {
  if (_dreadActive) return true;
  if (sfxMuted) return false;
  const ac = coins.getAudioCtx();
  if (!ac) return false;
  const now = ac.currentTime;
  _dreadOscA = ac.createOscillator();
  _dreadOscA.type = 'sawtooth';
  _dreadOscA.frequency.setValueAtTime(118, now);
  _dreadOscB = ac.createOscillator();
  _dreadOscB.type = 'sawtooth';
  // Beat against A — produces a queasy ~7 Hz wobble that gets thicker
  // as the danger ramps up.
  _dreadOscB.frequency.setValueAtTime(125, now);
  _dreadGain = ac.createGain();
  _dreadGain.gain.setValueAtTime(0.0001, now);
  _dreadOscA.connect(_dreadGain);
  _dreadOscB.connect(_dreadGain);
  _dreadGain.connect(ac.destination);
  _dreadOscA.start(now);
  _dreadOscB.start(now);

  _dreadRumble = ac.createOscillator();
  _dreadRumble.type = 'sine';
  _dreadRumble.frequency.setValueAtTime(38, now);
  _dreadRumbleGain = ac.createGain();
  _dreadRumbleGain.gain.setValueAtTime(0.0001, now);
  _dreadRumble.connect(_dreadRumbleGain).connect(ac.destination);
  _dreadRumble.start(now);

  _dreadActive = true;
  return true;
}

function _updateDreadSfx(dangerK) {
  if (sfxMuted) { if (_dreadActive) _stopDreadSfx(); return; }
  if (!_ensureDreadSfxBuilt()) return;
  const ac = coins.getAudioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const k = Math.max(0, Math.min(1, dangerK));
  // Quadratic ramp so the dread mostly hits in the back half of the
  // window instead of being noisy from the moment red latches.
  const k2 = k * k;
  // Whine: detune widens (more dissonance) and volume grows.
  if (_dreadOscA) _dreadOscA.frequency.setTargetAtTime(118 + 24 * k, now, 0.05);
  if (_dreadOscB) _dreadOscB.frequency.setTargetAtTime(125 + 60 * k, now, 0.05);
  if (_dreadGain) _dreadGain.gain.setTargetAtTime(0.005 + 0.085 * k2, now, 0.05);
  // Rumble: pitch climbs and volume swells.
  if (_dreadRumble) _dreadRumble.frequency.setTargetAtTime(38 + 22 * k, now, 0.05);
  if (_dreadRumbleGain) _dreadRumbleGain.gain.setTargetAtTime(0.01 + 0.16 * k2, now, 0.05);
}

function _stopDreadSfx() {
  if (!_dreadActive) {
    _dreadOscA = null; _dreadOscB = null; _dreadGain = null;
    _dreadRumble = null; _dreadRumbleGain = null;
    return;
  }
  const ac = coins.getAudioCtx();
  const now = ac ? ac.currentTime : 0;
  if (_dreadGain && ac) {
    try {
      _dreadGain.gain.cancelScheduledValues(now);
      _dreadGain.gain.setValueAtTime(_dreadGain.gain.value, now);
      _dreadGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch (e) { }
  }
  if (_dreadRumbleGain && ac) {
    try {
      _dreadRumbleGain.gain.cancelScheduledValues(now);
      _dreadRumbleGain.gain.setValueAtTime(_dreadRumbleGain.gain.value, now);
      _dreadRumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch (e) { }
  }
  try { _dreadOscA && _dreadOscA.stop(now + 0.1); } catch (e) { }
  try { _dreadOscB && _dreadOscB.stop(now + 0.1); } catch (e) { }
  try { _dreadRumble && _dreadRumble.stop(now + 0.1); } catch (e) { }
  _dreadOscA = null; _dreadOscB = null; _dreadGain = null;
  _dreadRumble = null; _dreadRumbleGain = null;
  _dreadActive = false;
}

// ── Self-destruct kaboom (visuals + boom SFX) ──────────────────────
function _ensureKaboomBuilt() {
  if (_kaboomGroup) return;
  if (!_scene) return;
  _kaboomGroup = new THREE.Group();
  _kaboomGroup.visible = false;
  _kaboomGroup.userData._fireballSkip = true;
  _scene.add(_kaboomGroup);
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  const mk = (color, opacity, ro) => {
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    m.renderOrder = ro;
    m.userData._fireballSkip = true;
    return m;
  };
  _kaboomCore = mk(0xfff2c0, 1.0, 1003);
  _kaboomMid = mk(0xff7733, 0.85, 1002);
  _kaboomOuter = mk(0xc01a08, 0.55, 1001);
  _kaboomGroup.add(_kaboomOuter);
  _kaboomGroup.add(_kaboomMid);
  _kaboomGroup.add(_kaboomCore);
  _kaboomLight = new THREE.PointLight(0xff5530, 0, 360, 1.4);
  _scene.add(_kaboomLight);
}

function _spawnOverchargeExplosion(at) {
  _ensureKaboomBuilt();
  if (!_kaboomGroup) return;
  _kaboomGroup.position.copy(at);
  _kaboomGroup.visible = true;
  _kaboomActive = true;
  _kaboomStartTs = _now();
  if (_kaboomLight) {
    _kaboomLight.position.copy(at);
    _kaboomLight.intensity = 14;
  }
}

function _updateKaboom(t) {
  const k = Math.max(0, Math.min(1, (t - _kaboomStartTs) / (KABOOM_DUR_SEC * 1000)));
  // Ease-out expansion + alpha falloff.
  const eo = 1 - Math.pow(1 - k, 3);
  const r = KABOOM_PEAK_RADIUS * eo;
  const alpha = 1 - k;
  if (_kaboomCore) {
    _kaboomCore.scale.setScalar(r * 0.45);
    if (_kaboomCore.material) _kaboomCore.material.opacity = 1.0 * alpha;
  }
  if (_kaboomMid) {
    _kaboomMid.scale.setScalar(r * 0.75);
    if (_kaboomMid.material) _kaboomMid.material.opacity = 0.85 * alpha;
  }
  if (_kaboomOuter) {
    _kaboomOuter.scale.setScalar(r * 1.15);
    if (_kaboomOuter.material) _kaboomOuter.material.opacity = 0.55 * alpha;
  }
  if (_kaboomLight) _kaboomLight.intensity = 14 * alpha;
  if (k >= 1) {
    _kaboomActive = false;
    if (_kaboomGroup) _kaboomGroup.visible = false;
    if (_kaboomLight) _kaboomLight.intensity = 0;
  }
}

function _playOverchargeBoomSfx() {
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
  // Sub-bass thump
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(160, now);
  sub.frequency.exponentialRampToValueAtTime(28, now + 0.55);
  const subG = ac.createGain();
  subG.gain.setValueAtTime(0.0001, now);
  subG.gain.linearRampToValueAtTime(0.55, now + 0.02);
  subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  sub.connect(subG).connect(ac.destination);
  sub.start(now);
  sub.stop(now + 0.75);
  // Crunchy noise burst
  const body = ac.createBufferSource();
  body.buffer = _noiseBuf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, now);
  lp.frequency.exponentialRampToValueAtTime(380, now + 0.6);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, now);
  bg.gain.linearRampToValueAtTime(0.40, now + 0.03);
  bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
  body.connect(lp).connect(bg).connect(ac.destination);
  body.start(now);
  body.stop(now + 0.9);
}
