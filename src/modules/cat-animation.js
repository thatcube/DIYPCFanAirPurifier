// ─── Cat animation module ───────────────────────────────────────────
// Model loading, animation mixer, procedural idle/run/jump,
// preview renderer, and ground pinning.
//
// This module manages:
// - Loading cat GLBs with fallback paths
// - catGroup, catModel, catMixer (scene objects)
// - _stepCatMixer() — gameplay animation tick
// - _tickCatPreview() — launcher preview render
// - Procedural idle (tail sway, head bob, spine sway)
// - Procedural run (bababooey), jump legs (toon)
// - Head-nod on click
// - Preview system (separate renderer/scene/camera)
//
// DEPENDENCY NOTE: This module depends on play-mode state (_fpVy,
// _fpKeys, etc.) which will be passed via a refs parameter rather
// than imported, to avoid circular dependencies with the game module.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { state } from './state.js';
import {
  getSelectedModelPreset, getModelPreset, getSourcesForModelKey,
  isToonSource, getModelSource, isColorable,
  applyAppearanceToModel, catModelKey, catColorKey
} from './cat-appearance.js';

// ── Exported scene objects ──────────────────────────────────────────

export const catGroup = new THREE.Group();
catGroup.visible = false;

// Hard-exclude the entire cat subtree from ANY shadow pass. three.js
// calls onBeforeShadow on each object before rendering it into a shadow
// map — flipping castShadow off here guarantees the cat never writes to
// any shadow map, regardless of what other code does to castShadow.
catGroup.onBeforeShadow = function () {
  this.traverse(o => { if (o.isMesh) o.castShadow = false; });
};

export let catModel = null;
export let catMixer = null;
export let catWalkAction = null;
export let catIdleAction = null;

// Kept for API compatibility (no-op shim — blob shadow was removed).
export const catBlobShadow = null;
export function updateCatBlobShadow() {}

// ── Constants ───────────────────────────────────────────────────────

const TARGET_HEIGHT = 4.0; // desired visual height in inches
// Click nod — exaggerated bow that bends the cat ~90° forward, then
// springs back. Fast-out / slow-back so the bend reads as "snap, hold,
// recover" rather than a polite head bob.
const NOD_DUR_MS = 520;
const NOD_PEAK_PITCH = 1.35;   // radians (~77°) distributed across upper-body bones

// ── State ───────────────────────────────────────────────────────────

const baseScale     = new THREE.Vector3(1, 1, 1);
const previewBaseScale = new THREE.Vector3(1, 1, 1);
const baseLocalPos  = new THREE.Vector3();
const baseLocalQuat = new THREE.Quaternion();
let gameLoadNonce = 0;
let nodStartTs = -1e9;
let _babaRunPhase = 0;
let _babaRunLastTs = -1;
let _totoRunPhase = 0;
let _totoRunLastTs = -1;
let _babaRollAnchorReady = false;
// Half-height offset so the spin pivot sits at body center, not the feet.
let _babaRollHalfHeight = 0;

// Bone references for procedural animation
const idleTailBones  = [];
const idleHeadBones  = [];
const idleSpineBones = [];
const tmpEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const tmpQuat  = new THREE.Quaternion();
const tmpQuatB = new THREE.Quaternion();
const tmpQuatC = new THREE.Quaternion();
const tmpQuatD = new THREE.Quaternion();
const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const groundTmpParentPos = new THREE.Vector3();
const boxTmp = new THREE.Box3();

// Bababooey bone refs
const babaBones = { left: null, right: null, up: null, down: null, mid: null };
const babaBase  = { left: null, right: null, up: null, down: null, mid: null };

// Toon leg bone refs
const toonLegBones = {};
const toonLegBase  = {};

// Korra bone refs (procedural quadruped cat)
const korraBones = {
  hips: null, spine: null, chest: null, neck: null, head: null,
  tail1: null, tail2: null, tail3: null,
  lfLeg: null, rfLeg: null, lbLeg: null, rbLeg: null,
  lfFoot: null, rfFoot: null, lbFoot: null, rbFoot: null
};
const korraBase = {};
for (const k in korraBones) korraBase[k] = null;
let _korraRunPhase = 0;
let _korraRunLastTs = -1;

// Totodile bone refs (humanoid biped rig from the Pokémon FBX import).
// Bone names like "LThigh_05", "RForeArm_033", "Tail1_017", "Jaw_029".
const totoBones = {
  hips: null, waist: null, spine: null, neck: null, head: null, jaw: null,
  tail1: null, tail2: null,
  lThigh: null, lLeg: null, lFoot: null, lToe: null,
  rThigh: null, rLeg: null, rFoot: null, rToe: null,
  lShoulder: null, lArm: null, lForeArm: null, lHand: null,
  rShoulder: null, rArm: null, rForeArm: null, rHand: null
};
const totoBase = {};
for (const k in totoBones) totoBase[k] = null;

// Preview state
let previewRenderer = null;
let previewScene    = null;
let previewCamera   = null;
let previewControls = null;
let previewModel    = null;
let previewMixer    = null;
let previewIdleAction = null;
let previewWalkAction = null;
let previewLastTs   = 0;
let previewW = 0, previewH = 0;
let previewLoadNonce = 0;
const previewBaseLocalPos = new THREE.Vector3();
const previewBaseLocalQuat = new THREE.Quaternion();

// ── Public API ──────────────────────────────────────────────────────

export function getBaseScale() { return baseScale; }
export function getPreviewBaseScale() { return previewBaseScale; }
export function getBaseLocalPos() { return baseLocalPos; }
export function getBaseLocalQuat() { return baseLocalQuat; }

export function triggerNod() {
  nodStartTs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

/**
 * Load the gameplay cat from current model selection.
 * @param {object} refs - { applyCatColorToModel, playLauncherOpen, setLauncherCatPreview }
 */
export function loadGameplayCat(refs = {}) {
  console.log('[cat-anim] loadGameplayCat called, GLTFLoader=', typeof GLTFLoader);
  const nonce = ++gameLoadNonce;
  clearGameplayCat();

  const preset = getSelectedModelPreset();

  // Procedural models (like Korra) are built in code, not loaded from GLB.
  if (preset.procedural) {
    import('./korra-model.js').then(({ buildKorraModel }) => {
      if (nonce !== gameLoadNonce) return;
      const result = buildKorraModel();
      _initGameplayCatFromScene(result.scene, result.animations, '', refs, nonce);
    }).catch(err => console.warn('Procedural cat build failed', err));
    return;
  }

  const loader = new GLTFLoader();
  const sources = getSourcesForModelKey(catModelKey);
  console.log('[cat-anim] loading sources:', sources);

  _loadWithFallback(loader, (gltf, src) => {
    if (nonce !== gameLoadNonce) return;
    console.log('[cat-anim] loaded:', src);
    _initGameplayCatFromScene(gltf.scene, gltf.animations, src, refs, nonce);
  }, (err) => { console.warn('Cat load failed', err); }, sources);
}

/**
 * Shared post-load setup for both GLB and procedural models.
 */
function _initGameplayCatFromScene(scene, animations, src, refs, nonce) {
    if (nonce !== gameLoadNonce) return;
    catModel = scene;
    _collectIdleBones(catModel);
    _stripBackdrop(catModel, src);

    // Auto-scale
    const box = new THREE.Box3().setFromObject(catModel);
    const size = box.getSize(new THREE.Vector3());
    const h = Math.max(size.y, 0.0001);
    const w = Math.max(size.x, size.z, 0.0001);
    const sH = TARGET_HEIGHT / h;
    const sW = (TARGET_HEIGHT * 1.6) / w;
    const s = Math.pow(sH, 0.65) * Math.pow(sW, 0.35);
    catModel.scale.setScalar(s);
    baseScale.copy(catModel.scale);

    _centerAndGround(catModel);

    baseLocalPos.copy(catModel.position);
    baseLocalQuat.copy(catModel.quaternion);
    _cacheBababooeyRollAnchor(catModel, src);

    // Shadows + material cleanup
    catModel.traverse(o => {
      if (o.isMesh) {
        o.castShadow = false; o.receiveShadow = true;
        if (o.isSkinnedMesh) o.frustumCulled = false;
        if (o.material && o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
            m.metalness = 0;
            m.roughness = Math.max(0.9, Number(m.roughness) || 0);
            m.envMapIntensity = Math.min(0.08, Number(m.envMapIntensity) || 0.08);
            if (m.clearcoat !== undefined) m.clearcoat = 0;
            if (m.sheen !== undefined) m.sheen = 0;
            m.needsUpdate = true;
          }
        }
      }
    });

    if (refs.applyCatColorToModel) refs.applyCatColorToModel();
    catGroup.add(catModel);

    // Always create a mixer so procedural-only rigs (like Totodile)
    // still execute the gameplay animation path.
    catMixer = new THREE.AnimationMixer(catModel);

    // Animations
    if (animations && animations.length) {
      for (const clip of animations) {
        clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.position'));
      }
      for (const clip of animations) {
        clip.resetDuration();
      }

      const byName = (names) => {
        for (const n of names) {
          const c = animations.find(a => a.name.toLowerCase().includes(n));
          if (c) return c;
        }
        return null;
      };
      const walkClip = byName(['walk', 'run', 'gallop']) || animations[0];
      const idleClip = byName(['idle', 'sit', 'rest']) || animations[0];
      if (walkClip) { catWalkAction = catMixer.clipAction(walkClip); catWalkAction.play(); catWalkAction.weight = 0; }
      if (idleClip && idleClip !== walkClip) { catIdleAction = catMixer.clipAction(idleClip); catIdleAction.play(); catIdleAction.weight = 1; }
      else if (catWalkAction) catWalkAction.weight = 1;
    }
}

export function clearGameplayCat() {
  if (catMixer) { catMixer.stopAllAction(); catMixer = null; }
  catWalkAction = null; catIdleAction = null;
  if (catModel && catModel.parent) catModel.parent.remove(catModel);
  catModel = null;
  _babaRunPhase = 0;
  _babaRunLastTs = -1;
  _totoRunPhase = 0;
  _totoRunLastTs = -1;
  _korraRunPhase = 0;
  _korraRunLastTs = -1;
  _resetBababooeyRollAnchor();
  _resetIdleBones();
}

/**
 * Force-disable shadow casting on the cat model. At throttled shadow
 * refresh rates (8 Hz in play mode) the cat's cast shadow visibly lags
 * behind on the floor. We rely on the fake blob shadow (catBlobShadow)
 * for contact shadowing instead. Kept as a function so it can be
 * reapplied after model swaps or appearance changes.
 */
export function setCatShadows(_enabled) {
  if (!catModel) return;
  catModel.traverse(o => { if (o.isMesh) o.castShadow = false; });
}

/**
 * Apply current color preset to both game + preview models.
 */
export function applyColorToAll() {
  applyAppearanceToModel(catModel, baseScale);
  applyAppearanceToModel(previewModel, previewBaseScale);
}

// ── Asset loading with fallback ─────────────────────────────────────

function _loadWithFallback(loader, onLoad, onError, sources) {
  const tryLoad = (idx, lastErr) => {
    if (idx >= sources.length) {
      if (onError) onError(lastErr || new Error('No cat model could be loaded'));
      return;
    }
    const src = sources[idx];
    loader.load(src, (gltf) => {
      if (gltf) {
        gltf.userData = gltf.userData || {};
        gltf.userData.modelSource = src;
        if (gltf.scene) {
          gltf.scene.userData = gltf.scene.userData || {};
          gltf.scene.userData.modelSource = src;
        }
      }
      onLoad(gltf, src);
    }, undefined, (err) => {
      console.warn('Cat model load failed for', src, err);
      tryLoad(idx + 1, err);
    });
  };
  tryLoad(0, null);
}

// ── Model utilities ─────────────────────────────────────────────────

function _stripBackdrop(model, src) {
  if (!/bababooey/i.test(src)) return;
  const hint = /(graph|chart|grid|axis|axes|backdrop|background|board|screen|panel|plane|pplane|lambert1|floor|ground)/i;
  const toRemove = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    const n = String(o.name || '');
    const mn = String(o.material && o.material.name || '');
    if (hint.test(n) || hint.test(mn)) toRemove.push(o);
  });
  // Fallback: remove largest planar mesh
  if (toRemove.length === 0) {
    let biggest = null, bigArea = 0;
    model.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const dims = [bb.max.x-bb.min.x, bb.max.y-bb.min.y, bb.max.z-bb.min.z].sort((a,b)=>b-a);
      if (dims[2] < dims[0]*0.1 && dims[0]*dims[1] > bigArea) { bigArea = dims[0]*dims[1]; biggest = o; }
    });
    if (biggest) toRemove.push(biggest);
  }
  for (const o of toRemove) { if (o.parent) o.parent.remove(o); }
}

function _centerAndGround(model) {
  // Two-pass ground: first center XZ and rough-ground on box.min.y,
  // then find foot bones and correct Y so feet sit exactly at local Y=0.
  // This makes every model consistent regardless of mesh origin or bone
  // rest-pose, so no per-model fudge offsets are needed.
  //
  // In Three.js 0.184+, SkinnedMesh has boundingBox=null which makes
  // Box3.setFromObject call computeBoundingBox (bone-aware, expensive,
  // frame-varying). Force it to undefined so setFromObject uses the
  // stable geometry-level bounding box instead.
  model.traverse(o => {
    if (o.isSkinnedMesh && o.boundingBox === null) o.boundingBox = undefined;
  });
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  // Second pass — find the lowest foot bone and pin to that instead,
  // because skeletal models often have geometry that extends below the
  // foot rest position (e.g. toon cat's big paws).
  model.updateMatrixWorld(true);
  let minFootY = Infinity;
  const _tmpVec = new THREE.Vector3();
  model.traverse(o => {
    if (!o || !o.isBone) return;
    if (!/foot|toe|paw/i.test(String(o.name || ''))) return;
    o.getWorldPosition(_tmpVec);
    if (_tmpVec.y < minFootY) minFootY = _tmpVec.y;
  });
  if (Number.isFinite(minFootY)) {
    model.position.y -= minFootY;
  }
}

function _pinToGround(model, baseLPos) {
  if (!model || !model.parent) return;

  boxTmp.setFromObject(model);
  if (!Number.isFinite(boxTmp.min.y)) return;
  const parent = model.parent;
  parent.getWorldPosition(groundTmpParentPos);
  const localMinY = boxTmp.min.y - groundTmpParentPos.y;
  const targetLocalMinY = baseLPos.y + 0.002;
  const delta = targetLocalMinY - localMinY;
  model.position.y += delta;
}

function _resetBababooeyRollAnchor() {
  _babaRollAnchorReady = false;
  _babaRollHalfHeight = 0;
}

function _cacheBababooeyRollAnchor(model, src) {
  _resetBababooeyRollAnchor();
  if (!model) return;
  if (!/bababooey/i.test(String(src || ''))) return;

  model.updateMatrixWorld(true);
  boxTmp.setFromObject(model);
  if (!Number.isFinite(boxTmp.min.y)) return;
  boxTmp.getCenter(tmpVecA);
  model.worldToLocal(tmpVecA);
  // The model is grounded (origin at feet), so the center Y in local
  // space tells us exactly how far up to shift the pivot for spinning.
  _babaRollHalfHeight = tmpVecA.y - baseLocalPos.y;
  _babaRollAnchorReady = true;
}

// ── Bone collection ─────────────────────────────────────────────────

function _resetIdleBones() {
  idleTailBones.length = 0;
  idleHeadBones.length = 0;
  idleSpineBones.length = 0;
}

function _getOrInitIdleBaseQuat(bone) {
  if (!bone || !bone.isBone) return null;
  if (!bone.userData) bone.userData = {};
  const cached = bone.userData._catIdleBaseQuat;
  if (cached && cached.isQuaternion) return cached;
  bone.userData._catIdleBaseQuat = bone.quaternion.clone();
  return bone.userData._catIdleBaseQuat;
}

function _collectIdleBones(model) {
  _resetIdleBones();
  if (!model) return;
  const tailRe = /(^tail$|^tail[._]|_tail|tail_)/i;
  const headRe = /(^head$|^head[._]|_head|head_|^neck$|^neck[._]|_neck|neck_)/i;
  const spineRe = /(^spine$|^spine[._]|_spine|spine_|^chest$|^chest[._]|_chest|chest_)/i;
  const heads = [];

  for (const k in babaBones) { babaBones[k] = null; babaBase[k] = null; }
  for (const k in toonLegBones) { toonLegBones[k] = null; toonLegBase[k] = null; }
  for (const k in totoBones) { totoBones[k] = null; totoBase[k] = null; }
  for (const k in korraBones) { korraBones[k] = null; korraBase[k] = null; }
  _korraRunPhase = 0; _korraRunLastTs = -1;

  // Totodile bone-name → key. Match against the leading semantic
  // segment so trailing FBX node-id suffixes (e.g. "_05", "_011") are
  // ignored. All matches are anchored at start of bone name.
  const totoMap = {
    hips:      /^Hips(?:[._]|\d|$)/i,
    waist:     /^Waist(?:[._]|\d|$)/i,
    spine:     /^Spine(?:[._]|\d|$)/i,
    neck:      /^Neck(?:[._]|\d|$)/i,
    head:      /^Head(?:[._]|\d|$)/i,
    jaw:       /^Jaw(?:[._]|\d|$)/i,
    tail1:     /^Tail1(?:[._]|\d|$)/i,
    tail2:     /^Tail2(?:[._]|\d|$)/i,
    lThigh:    /^LThigh(?:[._]|\d|$)/i,
    lLeg:      /^LLeg(?:[._]|\d|$)/i,
    lFoot:     /^LFoot(?:[._]|\d|$)/i,
    lToe:      /^LToe(?:[._]|\d|$)/i,
    rThigh:    /^RThigh(?:[._]|\d|$)/i,
    rLeg:      /^RLeg(?:[._]|\d|$)/i,
    rFoot:     /^RFoot(?:[._]|\d|$)/i,
    rToe:      /^RToe(?:[._]|\d|$)/i,
    lShoulder: /^LShoulder(?:[._]|\d|$)/i,
    lArm:      /^LArm(?:[._]|\d|$)/i,
    lForeArm:  /^LForeArm(?:[._]|\d|$)/i,
    lHand:     /^LHand(?:[._]|\d|$)/i,
    rShoulder: /^RShoulder(?:[._]|\d|$)/i,
    rArm:      /^RArm(?:[._]|\d|$)/i,
    rForeArm:  /^RForeArm(?:[._]|\d|$)/i,
    rHand:     /^RHand(?:[._]|\d|$)/i
  };

  model.traverse(o => {
    if (!o || !o.isBone) return;
    const n = String(o.name || '');
    if (tailRe.test(n)) idleTailBones.push(o);
    if (headRe.test(n)) heads.push(o);
    if (spineRe.test(n)) idleSpineBones.push(o);
    // Bababooey bones
    if (/joint_Left_04/i.test(n))  { babaBones.left = o; babaBase.left = o.quaternion.clone(); }
    if (/joint_Right_05/i.test(n)) { babaBones.right = o; babaBase.right = o.quaternion.clone(); }
    if (/joint_Up_02/i.test(n))    { babaBones.up = o; babaBase.up = o.quaternion.clone(); }
    if (/joint_Down_03/i.test(n))  { babaBones.down = o; babaBase.down = o.quaternion.clone(); }
    if (/joint_M_01/i.test(n))     { babaBones.mid = o; babaBase.mid = o.quaternion.clone(); }
    // Toon leg bones
    const toonMap = {
      thighBL: /^thigh\.B\.L/i, upperBL: /^leg\.upper\.B\.L/i, lowerBL: /^leg\.lower\.B\.L/i, footBL: /^foot\.B\.L/i,
      thighBR: /^thigh\.B\.R/i, upperBR: /^leg\.upper\.B\.R/i, lowerBR: /^leg\.lower\.B\.R/i, footBR: /^foot\.B\.R/i,
      upperFL: /^leg\.upper\.F\.L/i, lowerFL: /^leg\.lower\.F(\.)?L/i, footFL: /^foot\.F\.L/i,
      upperFR: /^leg\.upper\.F\.R/i, lowerFR: /^leg\.lower\.F\.R/i, footFR: /^foot\.F\.R/i,
      // Toon rig also has animated IK foot controls that influence stance.
      footIkFL: /^foot\.F\.IK\.L/i, footIkBL: /^foot\.B\.IK\.L/i,
      footIkFR: /^foot\.F\.IK\.R/i, footIkBR: /^foot\.B\.IK\.R/i
    };
    for (const k in toonMap) {
      if (toonLegBones[k] == null && toonMap[k].test(n)) {
        toonLegBones[k] = o; toonLegBase[k] = o.quaternion.clone();
      }
    }
    // Totodile bones
    for (const k in totoMap) {
      if (totoBones[k] == null && totoMap[k].test(n)) {
        totoBones[k] = o; totoBase[k] = o.quaternion.clone();
      }
    }
    // Korra bones (procedural quadruped)
    const korraMap = {
      hips:   /^Hips$/i,   spine: /^Spine$/i,  chest: /^Chest$/i,
      neck:   /^Neck$/i,   head:  /^Head$/i,
      tail1:  /^Tail1$/i,  tail2: /^Tail2$/i,  tail3: /^Tail3$/i,
      lfLeg:  /^LFrontLeg$/i,  rfLeg:  /^RFrontLeg$/i,
      lbLeg:  /^LBackLeg$/i,   rbLeg:  /^RBackLeg$/i,
      lfFoot: /^LFrontFoot$/i, rfFoot: /^RFrontFoot$/i,
      lbFoot: /^LBackFoot$/i,  rbFoot: /^RBackFoot$/i
    };
    for (const k in korraMap) {
      if (korraBones[k] == null && korraMap[k].test(n)) {
        korraBones[k] = o; korraBase[k] = o.quaternion.clone();
      }
    }
  });
  if (idleTailBones.length > 4) idleTailBones.length = 4;
  if (idleSpineBones.length > 2) idleSpineBones.length = 2;
  if (heads.length) {
    const headBone = heads.find(b => /head/i.test(String(b.name || ''))) || heads[0];
    idleHeadBones.push(headBone);
    const neckBone = heads.find(b => /neck/i.test(String(b.name || '')) && b !== headBone);
    if (neckBone) idleHeadBones.push(neckBone);
  }
}

// ── Loop-pause utility (shared by preview + gameplay) ───────────────

export function applyLoopPause(action, ts, pauseSeconds, allowPause) {
  if (!action || !pauseSeconds || !allowPause) return;
  const clip = action.getClip();
  if (!clip) return;
  const dur = clip.duration;
  if (dur <= 0) return;
  const cycleTime = action.time % dur;
  const nearEnd = cycleTime > dur * 0.92;
  if (nearEnd) {
    if (!action._loopPauseStart) action._loopPauseStart = ts;
    const elapsed = ts - action._loopPauseStart;
    if (elapsed < pauseSeconds * 1000) {
      action.paused = true;
      return;
    }
    action._loopPauseStart = null;
    action.paused = false;
  } else {
    action._loopPauseStart = null;
    action.paused = false;
  }
}


export function refreshGameplayIdleBasePose() {
  const all = [...idleTailBones, ...idleSpineBones, ...idleHeadBones];
  for (const b of all) {
    if (!b || !b.isBone) continue;
    // Reuse existing Quaternion to avoid GC churn.
    const base = _getOrInitIdleBaseQuat(b);
    if (base) base.copy(b.quaternion);
  }
}

export function applyGameplayProceduralIdle(ts, intensity) {
  if (intensity <= 0) return;
  const t = ts * 0.001;
  const classicHeadPitchSign = catModelKey === 'classic' ? -1 : 1;

  for (let i = 0; i < idleTailBones.length; i++) {
    const b = idleTailBones[i];
    if (!b || !b.isBone) continue;
    const base = _getOrInitIdleBaseQuat(b);
    if (!base) continue;
    const wave = 0.75 + (i * 0.18);
    const yaw = Math.sin((t * 1.7 * wave) + (i * 0.55)) * 0.065 * intensity;
    const pitch = Math.sin((t * 1.2 * wave) + (i * 0.4)) * 0.025 * intensity;
    const roll = Math.sin((t * 1.05 * wave) + (i * 0.9)) * 0.012 * intensity;
    tmpEuler.set(pitch, yaw, roll);
    tmpQuat.setFromEuler(tmpEuler);
    tmpQuatB.copy(base).multiply(tmpQuat);
    b.quaternion.slerp(tmpQuatB, Math.min(1, 0.5 * intensity));
  }

  for (let i = 0; i < idleSpineBones.length; i++) {
    const b = idleSpineBones[i];
    if (!b || !b.isBone) continue;
    const base = _getOrInitIdleBaseQuat(b);
    if (!base) continue;
    const swayScale = 0.65 - (i * 0.12);
    const yaw = Math.sin((t * 0.82) + (i * 0.45)) * 0.012 * intensity * swayScale;
    const pitch = Math.sin((t * 0.62) + (i * 0.35)) * 0.008 * intensity * swayScale;
    tmpEuler.set(pitch, yaw, 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpQuatB.copy(base).multiply(tmpQuat);
    b.quaternion.slerp(tmpQuatB, Math.min(1, 0.32 * intensity));
  }

  for (let i = 0; i < idleHeadBones.length; i++) {
    const b = idleHeadBones[i];
    if (!b || !b.isBone) continue;
    const base = _getOrInitIdleBaseQuat(b);
    if (!base) continue;
    const headScale = i === 0 ? 1 : 0.58;
    const yaw = (Math.sin((t * 0.8) + 0.7) * 0.12 + Math.sin((t * 1.55) + 0.2) * 0.036) * intensity * headScale;
    const pitch = (Math.sin((t * 0.62) + 1.1) * 0.072 + Math.sin((t * 1.35) + 0.9) * 0.021) * intensity * headScale * classicHeadPitchSign;
    tmpEuler.set(pitch, yaw, 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpQuatB.copy(base).multiply(tmpQuat);
    b.quaternion.slerp(tmpQuatB, Math.min(1, 0.78 * intensity));
  }
}

export function applyBababooeyProceduralRun(ts, moveSpeed, moveBlend) {
  if (!catModel) return;
  if (!babaBones.left && !babaBones.right && !babaBones.down && !babaBones.up && !babaBones.mid) return;
  const blend = Math.max(0, Math.min(1, moveBlend));
  if (!Number.isFinite(_babaRunLastTs) || _babaRunLastTs < 0) _babaRunLastTs = ts;
  const phaseDt = Math.max(0, Math.min(0.05, (ts - _babaRunLastTs) * 0.001));
  _babaRunLastTs = ts;
  if (blend <= 0.001) {
    _babaRunPhase = 0;
    catModel.quaternion.copy(baseLocalQuat);
    catModel.position.copy(baseLocalPos);
    return;
  }

  const cadence = 15.0;
  _babaRunPhase += cadence * phaseDt;
  if (_babaRunPhase > Math.PI * 2) _babaRunPhase %= (Math.PI * 2);
  const phase = _babaRunPhase;
  const tuck = blend;

  const apply = (bone, baseQ, euler, strength) => {
    if (!bone || !baseQ) return;
    tmpQuat.setFromEuler(euler);
    tmpQuatB.copy(baseQ).multiply(tmpQuat);
    const s = Math.min(1, (strength !== undefined ? strength : 0.65) * tuck);
    bone.quaternion.slerp(tmpQuatB, s);
  };

  // Sonic-style roll: keep limbs in a fixed tucked pose while root spins.
  tmpEuler.set(-0.70 * tuck, 0, 0.84 * tuck);
  apply(babaBones.left, babaBase.left, tmpEuler, 0.7);

  tmpEuler.set(-0.70 * tuck, 0, -0.84 * tuck);
  apply(babaBones.right, babaBase.right, tmpEuler, 0.7);

  if (babaBones.down) {
    tmpEuler.set(0.34 * tuck, 0, 0);
    apply(babaBones.down, babaBase.down, tmpEuler, 0.72);
  }
  if (babaBones.up) {
    tmpEuler.set(-1.06 * tuck, 0, 0);
    apply(babaBones.up, babaBase.up, tmpEuler, 0.72);
  }
  if (babaBones.mid) {
    tmpEuler.set(-0.88 * tuck, 0, 0);
    apply(babaBones.mid, babaBase.mid, tmpEuler, 0.7);
  }

  // Spin around body center, not feet. Shift up by half-height so the
  // pivot is mid-body, apply the spin, then shift back down so the
  // model stays in the same visual spot without orbiting wildly.
  const spin = phase;
  tmpEuler.set(spin, 0, 0);
  tmpQuat.setFromEuler(tmpEuler);
  tmpQuatB.copy(baseLocalQuat).multiply(tmpQuat);
  catModel.quaternion.copy(tmpQuatB);

  const hh = _babaRollAnchorReady ? _babaRollHalfHeight : 0;
  // Offset in local space before rotation: (0, hh, 0)
  // After rotation that becomes tmpQuat * (0, hh, 0).
  // We need: finalPos = basePos + (0, hh, 0) - rotated(0, hh, 0)
  tmpVecA.set(0, hh, 0);
  tmpVecB.copy(tmpVecA).applyQuaternion(tmpQuat);
  catModel.position.copy(baseLocalPos).add(tmpVecA).sub(tmpVecB);
}

function _applyToonJumpLegs(squash) {
  const L = toonLegBones;
  const B = toonLegBase;
  if (!L.upperBL && !L.upperBR && !L.upperFL && !L.upperFR) return;

  const s = Math.max(-0.45, Math.min(1, squash));
  const legScale = s >= 0 ? (1 - s * 0.85) : (1 + (-s) * 0.33);
  const shinScale = 1 - (1 - legScale) * 0.8;

  const setScale = (bone, v) => { if (bone) bone.scale.y = v; };
  setScale(L.thighBL, legScale); setScale(L.thighBR, legScale);
  setScale(L.upperBL, legScale); setScale(L.upperBR, legScale);
  setScale(L.upperFL, legScale); setScale(L.upperFR, legScale);
  setScale(L.lowerBL, shinScale); setScale(L.lowerBR, shinScale);
  setScale(L.lowerFL, shinScale); setScale(L.lowerFR, shinScale);

  const boneKeys = ['thighBL', 'thighBR', 'upperBL', 'upperBR', 'upperFL', 'upperFR',
    'lowerBL', 'lowerBR', 'lowerFL', 'lowerFR',
    // Include feet so paused walk poses don't leave the toon stance
    // permanently staggered when the player stops moving.
    'footBL', 'footBR', 'footFL', 'footFR',
    // Keep IK controls in lockstep with neutral pose too.
    'footIkFL', 'footIkBL', 'footIkFR', 'footIkBR'];
  for (const k of boneKeys) {
    const bone = L[k];
    const baseQ = B[k];
    if (bone && baseQ) bone.quaternion.copy(baseQ);
  }

  const splay = s > 0 ? Math.min(1, s) : 0;
  if (splay <= 0.001) return;
  const ang = splay * 0.95;
  const fwdTuck = splay * 0.55;
  const applyOffset = (bone, baseQ, ex, ey, ez) => {
    if (!bone || !baseQ) return;
    tmpEuler.set(ex, ey, ez);
    tmpQuat.setFromEuler(tmpEuler);
    tmpQuatB.copy(baseQ).multiply(tmpQuat);
    bone.quaternion.copy(tmpQuatB);
  };

  applyOffset(L.thighBL, B.thighBL, +fwdTuck, 0, +ang);
  applyOffset(L.thighBR, B.thighBR, +fwdTuck, 0, -ang);
  applyOffset(L.upperBL, B.upperBL, +fwdTuck, 0, +ang);
  applyOffset(L.upperBR, B.upperBR, +fwdTuck, 0, -ang);
  applyOffset(L.upperFL, B.upperFL, -fwdTuck, 0, +ang);
  applyOffset(L.upperFR, B.upperFR, -fwdTuck, 0, -ang);
  const shinBend = splay * 0.7;
  applyOffset(L.lowerBL, B.lowerBL, -shinBend * 0.6, 0, -ang * 0.4);
  applyOffset(L.lowerBR, B.lowerBR, -shinBend * 0.6, 0, +ang * 0.4);
  applyOffset(L.lowerFL, B.lowerFL, +shinBend * 0.6, 0, -ang * 0.4);
  applyOffset(L.lowerFR, B.lowerFR, +shinBend * 0.6, 0, +ang * 0.4);
}

export function applyGameplayJumpDeform({ dtSec, vy, holdFrames, modelKey }) {
  if (!catModel || !catMixer) return;
  const st = catMixer.userData || (catMixer.userData = {});
  if (!Number.isFinite(st._squashBlend)) st._squashBlend = 0;

  const vY = Number(vy) || 0;
  const held = Math.max(0, Number(holdFrames) || 0);
  const grounded = Math.abs(vY) < 0.01;
  const chargeN = Math.min(1, held / 60);
  const isBaba = modelKey === 'bababooey';
  const isToon = modelKey === 'toon';
  const isToto = modelKey === 'totodile';
  const isSquishy = isBaba || isToto;

  let target = 0;
  if (grounded && held > 0) {
    target = (isToon ? 1.0 : 0.55) * chargeN;
  } else if (vY > 0.05) {
    target = Math.max(-0.45, -vY * 3.2);
  } else if (vY < -0.03 && !isToon) {
    const k = isSquishy ? 11 : 7;
    target = Math.min(1, (-vY) * k);
  }

  const ease = 1 - Math.exp(-Math.max(0, dtSec) * 14);
  st._squashBlend += (target - st._squashBlend) * ease;
  const s = st._squashBlend;

  const syK = isSquishy ? 0.55 : (isToon ? 0.60 : 0.35);
  const sxzK = isSquishy ? 0.40 : (isToon ? 0.30 : 0.22);
  const sy = 1 - s * syK;
  const sxz = 1 + s * sxzK;
  catModel.scale.set(baseScale.x * sxz, baseScale.y * sy, baseScale.z * sxz);

  if (isToon) {
    _applyToonJumpLegs(s);
  }
}

function _applyWeightedBonePitch(pitch, targets) {
  let total = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;
    total += w;
  }
  if (total <= 0) return 0;

  let applied = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;
    tmpEuler.set(pitch * (w / total), 0, 0);
    tmpQuat.setFromEuler(tmpEuler);
    t.bone.quaternion.multiply(tmpQuat);
    applied++;
  }
  return applied;
}

function _applyWeightedBoneModelPitch(pitch, targets) {
  if (!catModel) return 0;
  let total = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone || !t.bone.parent) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;
    total += w;
  }
  if (total <= 0) return 0;

  catModel.updateMatrixWorld(true);
  const modelRightWorld = tmpVecA
    .set(1, 0, 0)
    .applyQuaternion(catModel.getWorldQuaternion(tmpQuatC))
    .normalize();

  let applied = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone || !t.bone.parent) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;

    const parentWorld = t.bone.parent.getWorldQuaternion(tmpQuatD);
    const axisLocal = tmpVecB.copy(modelRightWorld).applyQuaternion(parentWorld.invert()).normalize();
    tmpQuat.setFromAxisAngle(axisLocal, pitch * (w / total));
    t.bone.quaternion.multiply(tmpQuat);
    applied++;
  }
  return applied;
}

function _applyWeightedBoneModelYaw(yaw, targets) {
  if (!catModel) return 0;
  let total = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone || !t.bone.parent) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;
    total += w;
  }
  if (total <= 0) return 0;

  catModel.updateMatrixWorld(true);
  const modelUpWorld = tmpVecA
    .set(0, 1, 0)
    .applyQuaternion(catModel.getWorldQuaternion(tmpQuatC))
    .normalize();

  let applied = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone || !t.bone.parent) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;

    const parentWorld = t.bone.parent.getWorldQuaternion(tmpQuatD);
    const axisLocal = tmpVecB.copy(modelUpWorld).applyQuaternion(parentWorld.invert()).normalize();
    tmpQuat.setFromAxisAngle(axisLocal, yaw * (w / total));
    const baseQ = (t.baseQ && t.baseQ.isQuaternion) ? t.baseQ : null;
    if (baseQ) {
      tmpQuatB.copy(baseQ).multiply(tmpQuat);
      const strengthRaw = Number(t.strength);
      if (Number.isFinite(strengthRaw)) {
        const strength = Math.max(0, Math.min(1, strengthRaw));
        t.bone.quaternion.slerp(tmpQuatB, strength);
      } else {
        t.bone.quaternion.copy(tmpQuatB);
      }
    } else {
      t.bone.quaternion.multiply(tmpQuat);
    }
    applied++;
  }
  return applied;
}

function _applyWeightedBoneModelRoll(roll, targets) {
  if (!catModel) return 0;
  let total = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone || !t.bone.parent) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;
    total += w;
  }
  if (total <= 0) return 0;

  catModel.updateMatrixWorld(true);
  const modelForwardWorld = tmpVecA
    .set(0, 0, 1)
    .applyQuaternion(catModel.getWorldQuaternion(tmpQuatC))
    .normalize();

  let applied = 0;
  for (const t of targets) {
    if (!t || !t.bone || !t.bone.isBone || !t.bone.parent) continue;
    const w = Number(t.weight) || 0;
    if (w <= 0) continue;

    const parentWorld = t.bone.parent.getWorldQuaternion(tmpQuatD);
    const axisLocal = tmpVecB.copy(modelForwardWorld).applyQuaternion(parentWorld.invert()).normalize();
    tmpQuat.setFromAxisAngle(axisLocal, roll * (w / total));
    t.bone.quaternion.multiply(tmpQuat);
    applied++;
  }
  return applied;
}

/**
 * Skate pose helper for sideways-stance models.
 * Turns only upper body bones toward movement so the board can stay
 * sideways while the head/chest look more forward.
 */
export function applyGameplaySkateUpperBodyForwardYaw(modelKey, amount = 1, ts = 0, turnSignal = 0, moveSignal = 0) {
  if (!catModel) return 0;
  const k = Math.max(0, Math.min(1, Number(amount) || 0));

  if (modelKey === 'totodile' && k <= 0.001) {
    // Skate just turned off: explicitly relax Totodile's arm chain back to
    // base so shoulders/hands don't stay stuck in the balance pose.
    const relax = 0.52;
    _totoApply(totoBones.lShoulder, totoBase.lShoulder, 0, 0, 0, relax);
    _totoApply(totoBones.rShoulder, totoBase.rShoulder, 0, 0, 0, relax);
    _totoApply(totoBones.lArm, totoBase.lArm, 0, 0, 0, relax);
    _totoApply(totoBones.rArm, totoBase.rArm, 0, 0, 0, relax);
    _totoApply(totoBones.lForeArm, totoBase.lForeArm, 0, 0, 0, relax);
    _totoApply(totoBones.rForeArm, totoBase.rForeArm, 0, 0, 0, relax);
    _totoApply(totoBones.lHand, totoBase.lHand, 0, 0, 0, relax);
    _totoApply(totoBones.rHand, totoBase.rHand, 0, 0, 0, relax);
    return 0;
  }

  if (k <= 0.001) return 0;

  if (modelKey === 'bababooey') {
    // Keep Bababooey mostly forward-facing on the board even at lower speed.
    const torsoK = Math.max(0.82, k);
    const yaw = -1.25 * torsoK;
    return _applyWeightedBoneModelYaw(yaw, [
      { bone: babaBones.down, baseQ: babaBase.down, weight: 0.08, strength: 0.74 },
      { bone: babaBones.mid, baseQ: babaBase.mid, weight: 0.28, strength: 0.74 },
      { bone: babaBones.up, baseQ: babaBase.up, weight: 0.64, strength: 0.74 }
    ]);
  }

  if (modelKey === 'totodile') {
    const t = (Number.isFinite(ts) ? ts : 0) * 0.001;
    const turn = Math.max(-1, Math.min(1, Number(turnSignal) || 0));
    const move = Math.max(0, Math.min(1, Number(moveSignal) || 0));
    const animState = catModel.userData || (catModel.userData = {});
    if (!Number.isFinite(animState._totoSkateMoveBlend)) animState._totoSkateMoveBlend = move;
    animState._totoSkateMoveBlend += (move - animState._totoSkateMoveBlend) * 0.18;
    const moveK = animState._totoSkateMoveBlend;
    const rideKRaw = Math.max(0, Math.min(1, (moveK - 0.06) / 0.94));
    const rideK = rideKRaw * rideKRaw * (3 - 2 * rideKRaw); // smoothstep
    const rideCadence = 0.52 + rideK * 0.48;
    const rideSway = Math.sin(t * rideCadence + 0.35);
    const rideSwayFine = Math.sin(t * (rideCadence * 1.15) + 1.05);
    const rideBob = Math.sin(t * (rideCadence * 1.25) + 0.55);
    // Keep feet planted by avoiding hip rotation in skate pose.
    // Drive turn/lean from waist upward so mid/upper torso carries motion.
    const swayYaw =
      (Math.sin(t * 0.62 + 0.35) * 0.018) +
      (Math.sin(t * 1.05 + 1.1) * 0.010) +
      ((rideSway * 0.050) + (rideSwayFine * 0.020)) * rideK;
    const bodyYaw = (-0.94 + swayYaw) * k;

    let applied = _applyWeightedBoneModelYaw(bodyYaw, [
      { bone: totoBones.waist, weight: 0.30 },
      { bone: totoBones.spine, weight: 0.40 },
      { bone: totoBones.neck, weight: 0.16 },
      { bone: totoBones.head, weight: 0.14 }
    ]);

    const torsoLean = (-0.24 + Math.sin(t * 0.6 + 0.2) * 0.030 + rideBob * 0.058 * rideK) * k;
    applied += _applyWeightedBoneModelPitch(torsoLean, [
      { bone: totoBones.waist, weight: 0.36 },
      { bone: totoBones.spine, weight: 0.48 },
      { bone: totoBones.neck, weight: 0.11 },
      { bone: totoBones.head, weight: 0.05 }
    ]);

    const torsoPulse = (Math.sin(t * (rideCadence * 1.15) + 0.12) * 0.020 + rideSway * 0.010) * rideK * k;
    applied += _applyWeightedBoneModelPitch(torsoPulse, [
      { bone: totoBones.waist, weight: 0.40 },
      { bone: totoBones.spine, weight: 0.46 },
      { bone: totoBones.neck, weight: 0.09 },
      { bone: totoBones.head, weight: 0.05 }
    ]);

    const headLeadYaw = (0.30 + Math.sin(t * 0.34 + 0.4) * 0.026 + rideSway * 0.062 * rideK) * k;
    applied += _applyWeightedBoneModelYaw(-headLeadYaw, [
      { bone: totoBones.neck, weight: 0.50 },
      { bone: totoBones.head, weight: 0.50 }
    ]);

    // Clear, slower head scan while riding so the look-around reads.
    const lookRate = 0.34 + rideK * 0.12;
    const lookSweepRaw = Math.sin(t * lookRate + 2.1);
    const lookSweep = lookSweepRaw * (0.55 + 0.45 * Math.abs(lookSweepRaw));
    const lookYaw = lookSweep * (0.140 + rideK * 0.175) * rideK * k;
    applied += _applyWeightedBoneModelYaw(lookYaw, [
      { bone: totoBones.neck, weight: 0.44 },
      { bone: totoBones.head, weight: 0.56 }
    ]);

    const headNod = (Math.sin(t * 0.26 + 0.9) * (0.038 + rideK * 0.022) + rideBob * 0.012 * rideK) * k;
    applied += _applyWeightedBoneModelPitch(headNod, [
      { bone: totoBones.neck, weight: 0.46 },
      { bone: totoBones.head, weight: 0.54 }
    ]);

    // Keep Totodile's skate gaze naturally lifted so he reads as looking ahead,
    // not down at the board.
    const headUpBias = (-0.105 - rideK * 0.045) * k;
    applied += _applyWeightedBoneModelPitch(headUpBias, [
      { bone: totoBones.neck, weight: 0.54 },
      { bone: totoBones.head, weight: 0.46 }
    ]);

    // Flip the lateral head cant to the opposite side while keeping the
    // forward-facing look and up-bias intact.
    const headCantFlip = -(0.082 + rideK * 0.046) * k;
    applied += _applyWeightedBoneModelRoll(headCantFlip, [
      { bone: totoBones.neck, weight: 0.62 },
      { bone: totoBones.head, weight: 0.38 }
    ]);

    // Balance-arms layer: keep the riding pose as-is while moving, then add
    // an extra downward shoulder/arm drop only when nearly stationary.
    const armPoseK = 0 + moveK * 0.42;
    const idleDropRaw = Math.max(0, Math.min(1, (0.22 - moveK) / 0.22));
    const idleDrop = idleDropRaw * idleDropRaw * (3 - 2 * idleDropRaw); // smoothstep
    const steerLift = turn * (0.06 + moveK * 0.18);
    const shoulderRideSway = ((rideSway * 0.038) + (rideSwayFine * 0.015)) * rideK;
    const armWave = Math.sin(t * 0.55 + 0.5) * (0.006 + moveK * 0.018);
    const applyBalanceArm = (shoulder, shoulderBase, arm, armBase, foreArm, foreArmBase, hand, handBase, sideSign) => {
      const lift = steerLift * sideSign;
      const spreadSign = -sideSign;
      _totoApply(
        shoulder,
        shoulderBase,
        (0.10 + lift * 0.8 + armWave * sideSign + shoulderRideSway * sideSign) * armPoseK - 0.34 * idleDrop,
        0,
        (0.92 * spreadSign) * armPoseK,
        0.78
      );
      _totoApply(
        arm,
        armBase,
        (0.04 + lift * 0.65 + armWave * sideSign * 0.6) * armPoseK - 0.26 * idleDrop,
        0,
        (0.68 * spreadSign) * armPoseK,
        0.74
      );
      _totoApply(
        foreArm,
        foreArmBase,
        (-0.06 + lift * 0.28) * armPoseK - 0.12 * idleDrop,
        0,
        0,
        0.64
      );
      _totoApply(
        hand,
        handBase,
        (0.02 + lift * 0.12) * armPoseK - 0.05 * idleDrop,
        0,
        0,
        0.52
      );
    };

    applyBalanceArm(
      totoBones.lShoulder, totoBase.lShoulder,
      totoBones.lArm, totoBase.lArm,
      totoBones.lForeArm, totoBase.lForeArm,
      totoBones.lHand, totoBase.lHand,
      -1
    );
    applyBalanceArm(
      totoBones.rShoulder, totoBase.rShoulder,
      totoBones.rArm, totoBase.rArm,
      totoBones.rForeArm, totoBase.rForeArm,
      totoBones.rHand, totoBase.rHand,
      1
    );
    return applied;
  }

  return 0;
}

/**
 * Apply the click-interaction nod — a fast, exaggerated forward bow that
 * bends the upper half of the cat toward the click target, then springs back.
 *
 * Driven by `nodStartTs` set in triggerNod(). Returns the current nod
 * progress (0..1) so callers can layer additional effects if desired.
 *
 * Curve: 0..0.30 = fast bend down (ease-out cubic), 0.30..1.0 = spring
 * back with a slight overshoot bounce (decaying sine).
 *
 * Effect on the model:
 *   - weighted local X rotations on upper-body bones (spine/neck/head,
 *     plus model-specific torso bones) so lower body and paws stay mostly
 *     planted.
 *   - falls back to a mild root tilt only if a model has no matching
 *     upper-body bones.
 */
export function applyClickNod(ts, modelKey) {
  if (!catModel) return 0;
  const elapsed = ts - nodStartTs;
  if (elapsed < 0 || elapsed >= NOD_DUR_MS) return 0;
  const t = elapsed / NOD_DUR_MS; // 0..1
  // Two-phase curve: fast bend out, springy return.
  let bend;
  if (t < 0.30) {
    // Fast ease-out: 1 - (1-x)^3 at remap x=t/0.30
    const x = t / 0.30;
    bend = 1 - Math.pow(1 - x, 3);
  } else {
    // Spring back with one small overshoot wobble.
    const x = (t - 0.30) / 0.70; // 0..1
    // Decaying cosine: starts at 1, ends at 0, with a small bounce.
    const decay = Math.exp(-3.2 * x);
    bend = decay * Math.cos(x * Math.PI * 1.15);
  }
  // Forward pitch is distributed over upper-body bones so the lower half
  // does not hinge forward as a single rigid block.
  const nodPitchSign = modelKey === 'classic' ? -1 : 1;
  const pitch = bend * NOD_PEAK_PITCH * nodPitchSign;

  let applied = 0;
  if (modelKey === 'bababooey') {
    applied = _applyWeightedBonePitch(pitch, [
      { bone: babaBones.down, weight: 0.14 },
      { bone: babaBones.mid, weight: 0.30 },
      { bone: babaBones.up, weight: 0.56 }
    ]);
  } else if (modelKey === 'totodile') {
    applied = _applyWeightedBoneModelPitch(pitch, [
      { bone: totoBones.waist, weight: 0.12 },
      { bone: totoBones.spine, weight: 0.24 },
      { bone: totoBones.neck, weight: 0.28 },
      { bone: totoBones.head, weight: 0.36 }
    ]);
  } else {
    const spineTargets = [];
    const headTargets = [];
    let spineWeightSum = 0;

    if (idleSpineBones.length) {
      const n = idleSpineBones.length;
      const denom = (n * (n + 1)) * 0.5;
      for (let i = 0; i < n; i++) {
        const w = 0.38 * ((i + 1) / Math.max(1e-6, denom));
        spineTargets.push({ bone: idleSpineBones[i], weight: w });
        spineWeightSum += w;
      }
    }

    let neckCount = 0;
    let headCount = 0;
    for (let i = 0; i < idleHeadBones.length; i++) {
      const b = idleHeadBones[i];
      if (!b || !b.isBone) continue;
      if (/neck/i.test(String(b.name || ''))) neckCount++;
      else headCount++;
    }

    const remaining = Math.max(0, 1 - spineWeightSum);
    if (neckCount > 0 && headCount > 0) {
      const neckW = (remaining * 0.38) / neckCount;
      const headW = (remaining * 0.62) / headCount;
      for (let i = 0; i < idleHeadBones.length; i++) {
        const b = idleHeadBones[i];
        if (!b || !b.isBone) continue;
        if (/neck/i.test(String(b.name || ''))) headTargets.push({ bone: b, weight: neckW });
        else headTargets.push({ bone: b, weight: headW });
      }
    } else if (idleHeadBones.length > 0) {
      const each = remaining / idleHeadBones.length;
      for (let i = 0; i < idleHeadBones.length; i++) {
        headTargets.push({ bone: idleHeadBones[i], weight: each });
      }
    }

    applied = _applyWeightedBonePitch(pitch, [...spineTargets, ...headTargets]);
  }

  if (applied <= 0) {
    tmpEuler.set(pitch * 0.35, 0, 0);
    tmpQuat.setFromEuler(tmpEuler);
    catModel.quaternion.copy(baseLocalQuat).multiply(tmpQuat);
  }

  return Math.abs(bend);
}

/**
 * Apply a gentle breathing/squish to bababooey when idle.
 * Oscillates scale Y down and XZ up slowly for a squishy feel.
 * @param {number} ts - timestamp in ms
 * @param {number} intensity - 0..1 blend (use idleBlend)
 */
export function applyBababooeyIdleSquish(ts, intensity) {
  if (!catModel || intensity <= 0.001) return;
  const t = ts * 0.001;
  // Slow breathing: ~0.8 Hz with a gentle secondary wobble
  const wave = Math.sin(t * 1.6) * 0.7 + Math.sin(t * 2.5) * 0.3;
  const squish = wave * 0.035 * intensity; // max ~3.5% scale change
  catModel.scale.set(
    baseScale.x * (1 + squish * 0.6),
    baseScale.y * (1 - squish),
    baseScale.z * (1 + squish * 0.6)
  );
}

// ── Totodile procedural animation ───────────────────────────────────
//
// The totodile.glb model ships with a full humanoid skeleton (Hips,
// Spine, Neck, Head, Jaw, Tail1/2, plus L/R Thigh/Leg/Foot/Toe and
// L/R Shoulder/Arm/ForeArm/Hand) but ZERO baked animation clips. So
// every bit of motion has to be driven procedurally, similar to the
// bababooey path.
//
// Conventions (validated empirically):
//   - Totodile leg forward/back swing is primarily rotation around Y.
//   - Rotation around Z mostly introduces lateral splay, so we use a
//     small Z counter-term to keep feet tracking fore/aft.
//   - Body twist is rotation around Y.
// All rotations are applied as base * offset so the rest pose is the
// neutral state and amplitudes stay model-relative.

function _totoApply(bone, baseQ, ex, ey, ez, strength) {
  if (!bone || !baseQ) return;
  tmpEuler.set(ex, ey, ez);
  tmpQuat.setFromEuler(tmpEuler);
  tmpQuatB.copy(baseQ).multiply(tmpQuat);
  bone.quaternion.slerp(tmpQuatB, Math.min(1, strength));
}

function _totoApplyModelPitch(bone, baseQ, pitch, strength) {
  if (!bone || !baseQ || !bone.parent || !catModel) return;
  const modelRightWorld = tmpVecA
    .set(1, 0, 0)
    .applyQuaternion(catModel.getWorldQuaternion(tmpQuatC))
    .normalize();
  const parentWorld = bone.parent.getWorldQuaternion(tmpQuatD);
  const axisLocal = tmpVecB.copy(modelRightWorld).applyQuaternion(parentWorld.invert()).normalize();
  tmpQuat.setFromAxisAngle(axisLocal, pitch);
  tmpQuatB.copy(baseQ).multiply(tmpQuat);
  bone.quaternion.slerp(tmpQuatB, Math.min(1, strength));
}

/**
 * Totodile idle: slow breathing in the spine, soft head sway, lazy
 * tail swish, and relaxed arm sway. Designed to feel like a
 * little Pokémon waiting for its trainer.
 *
 * @param {number} ts - timestamp in ms
 * @param {number} intensity - 0..1 idle blend
 */
export function applyTotodileProceduralIdle(ts, intensity) {
  if (!catModel || intensity <= 0.001) return;
  if (!totoBones.hips && !totoBones.spine && !totoBones.head && !totoBones.tail1) return;
  const t = ts * 0.001;
  const k = Math.min(1, intensity);

  // Breathing: spine bobs back-and-forth, hips counter slightly so the
  // chest puffs without the whole body see-sawing.
  const breath = Math.sin(t * 1.7) * 0.5 + Math.sin(t * 2.6 + 0.6) * 0.18;
  _totoApply(totoBones.spine, totoBase.spine, -breath * 0.045 * k, 0, Math.sin(t * 0.9) * 0.025 * k, 0.55);
  _totoApply(totoBones.waist, totoBase.waist, breath * 0.018 * k, 0, 0, 0.5);
  _totoApply(totoBones.hips,  totoBase.hips,  breath * 0.012 * k, Math.sin(t * 0.6) * 0.015 * k, 0, 0.45);

  // Head bob should read as nodding, not side-looking. Keep it pitch-dominant
  // and let torso/tail provide most lateral motion.
  const headPitch = (Math.sin(t * 0.65 + 1.1) * 0.10 + Math.sin(t * 1.4 + 0.7) * 0.03) * k;
  catModel.updateMatrixWorld(true);
  _totoApplyModelPitch(totoBones.neck, totoBase.neck, headPitch * 0.45, 0.7);
  _totoApplyModelPitch(totoBones.head, totoBase.head, headPitch, 0.75);

  // Tail — wave with phase delay so Tail2 trails Tail1.
  const tailWave1 = Math.sin(t * 1.3) * k;
  const tailWave2 = Math.sin(t * 1.3 - 0.7) * k;
  _totoApply(totoBones.tail1, totoBase.tail1, 0, tailWave1 * 0.32, tailWave1 * 0.10, 0.7);
  _totoApply(totoBones.tail2, totoBase.tail2, 0, tailWave2 * 0.42, tailWave2 * 0.14, 0.7);

  // Arms — slight relaxed sway. Counter-phase L/R.
  const armSway = Math.sin(t * 1.1) * 0.10 * k;
  _totoApply(totoBones.lArm, totoBase.lArm,  armSway,  0, 0, 0.45);
  _totoApply(totoBones.rArm, totoBase.rArm, -armSway, 0, 0, 0.45);
}

/**
 * Totodile run cycle: alternating thigh swings, knee bends, opposite
 * arm swings, hip counter-twist, spine bob, tail counter-sway.
 *
 * @param {number} ts - timestamp in ms
 * @param {number} moveSpeed - inches/sec
 * @param {number} moveBlend - 0..1 blend factor (use moveBlend)
 */
export function applyTotodileProceduralRun(ts, moveSpeed, moveBlend) {
  if (!catModel) return;
  if (!totoBones.lThigh && !totoBones.rThigh) return;
  const sp = Math.max(0, moveSpeed);
  // ~27 in/s is a confident jog (matches bababooey normalization).
  const spN = Math.min(1, sp / 27);
  const blend = Math.max(0, Math.min(1, moveBlend)) * Math.max(0.52, spN);
  if (!Number.isFinite(_totoRunLastTs) || _totoRunLastTs < 0) _totoRunLastTs = ts;
  const phaseDt = Math.max(0, Math.min(0.05, (ts - _totoRunLastTs) * 0.001));
  _totoRunLastTs = ts;
  if (blend <= 0.001) {
    _totoRunPhase = 0;
    return;
  }

  // Stride cadence — a touch quicker than baba so the little legs read
  // as "scampering".
  const cadence = 7.0 + spN * 6.0;
  _totoRunPhase += cadence * phaseDt;
  if (_totoRunPhase > Math.PI * 2) _totoRunPhase %= (Math.PI * 2);
  const phase = _totoRunPhase;
  const sL = Math.sin(phase);
  const sR = Math.sin(phase + Math.PI);
  const walkN = 1 - spN;
  const waddleBoost = 1 + walkN * 0.45 + spN * 0.18;
  const legBlend = blend * waddleBoost;
  // Strength of a single stride peak (0..1 nominal).
  const stride = (0.62 + spN * 0.64) * legBlend;
  const legSwing = (0.30 + spN * 0.24) * legBlend;
  const kneeTuck = (0.43 + spN * 0.35) * legBlend;
  const ankleCycle = (0.12 + spN * 0.10) * legBlend;
  const toeCycle = (0.08 + spN * 0.07) * legBlend;
  const liftStrength = 0.82;
  const lSide = -1;
  const rSide = +1;
  const latCancel = (side, v, k) => -side * v * k;

  // ── Legs ──
  // Totodile's thigh flexion axis is Y (not X). Add a small per-side Z
  // counter so forward swing does not read as legs flaring outward.
  const thighL = -sL * legSwing;
  const thighR = -sR * legSwing;
  _totoApply(totoBones.lThigh, totoBase.lThigh, 0, thighL, latCancel(lSide, thighL, 0.58), liftStrength);
  _totoApply(totoBones.rThigh, totoBase.rThigh, 0, thighR, latCancel(rSide, thighR, 0.58), liftStrength);

  // Shins bend most when the leg is recovering (back-swing). Use a
  // half-rectified signal so the knee tucks during lift but stays
  // straight on the planted leg.
  const shinL = Math.max(0, sL) * kneeTuck;
  const shinR = Math.max(0, sR) * kneeTuck;
  _totoApply(totoBones.lLeg, totoBase.lLeg, 0, shinL, latCancel(lSide, shinL, 0.56), liftStrength);
  _totoApply(totoBones.rLeg, totoBase.rLeg, 0, shinR, latCancel(rSide, shinR, 0.56), liftStrength);

  // Ankles/toes follow the knee tuck plus a smooth sinusoidal cycle so
  // both phases of the stride read clearly (more obvious foot travel).
  const footL = (-shinL * 0.62) - (sL * ankleCycle);
  const footR = (-shinR * 0.62) - (sR * ankleCycle);
  const toeL = (-shinL * 0.34) - (sL * toeCycle);
  const toeR = (-shinR * 0.34) - (sR * toeCycle);
  _totoApply(totoBones.lFoot, totoBase.lFoot, 0, footL, 0, 0.68);
  _totoApply(totoBones.rFoot, totoBase.rFoot, 0, footR, 0, 0.68);
  _totoApply(totoBones.lToe, totoBase.lToe, 0, toeL, 0, 0.62);
  _totoApply(totoBones.rToe, totoBase.rToe, 0, toeR, 0, 0.62);

  // ── Arms (counter-swing) ──
  const armSwing = 0.55 * stride;
  _totoApply(totoBones.lShoulder, totoBase.lShoulder, sR * 0.18 * stride, 0, sR * 0.06 * stride, 0.5);
  _totoApply(totoBones.rShoulder, totoBase.rShoulder, sL * 0.18 * stride, 0, -sL * 0.06 * stride, 0.5);
  _totoApply(totoBones.lArm,      totoBase.lArm,      sR * armSwing, 0, 0, 0.6);
  _totoApply(totoBones.rArm,      totoBase.rArm,      sL * armSwing, 0, 0, 0.6);
  // Forearms tuck on the up-swing.
  const foreL = Math.max(0, sR) * 0.5 * stride;
  const foreR = Math.max(0, sL) * 0.5 * stride;
  _totoApply(totoBones.lForeArm, totoBase.lForeArm, -foreL, 0, 0, 0.55);
  _totoApply(totoBones.rForeArm, totoBase.rForeArm, -foreR, 0, 0, 0.55);

  // ── Hips & spine ──
  // Hips twist around Y opposite to the planted leg; spine adds a small
  // counter-twist so the shoulders stay relatively stable.
  const strideBob = Math.sin(phase * 2.0);
  const hipTwist = sL * 0.11 * blend;
  const hipRoll = sL * (0.040 + walkN * 0.055) * blend;
  const torsoCounterRoll = -hipRoll * 0.62;
  _totoApply(totoBones.hips,  totoBase.hips,  strideBob * 0.012 * blend, hipTwist, hipRoll, 0.5);
  _totoApply(totoBones.waist, totoBase.waist, 0, -hipTwist * 0.45, torsoCounterRoll + sL * 0.020 * blend, 0.48);
  _totoApply(totoBones.spine, totoBase.spine, -strideBob * 0.016 * blend, -hipTwist * 0.3, torsoCounterRoll * 0.45, 0.5);

  // ── Head ──
  // Keep stride bob vertical; side-twist here made Totodile "look sideways"
  // while running and read as a broken head bob.
  catModel.updateMatrixWorld(true);
  _totoApplyModelPitch(totoBones.neck, totoBase.neck, strideBob * 0.010 * blend, 0.46);
  _totoApplyModelPitch(totoBones.head, totoBase.head, strideBob * 0.014 * blend, 0.5);

  // ── Tail (counter-sway, exaggerated) ──
  const tailSway = -hipTwist * 2.4;
  _totoApply(totoBones.tail1, totoBase.tail1, 0, tailSway * 0.6, sL * 0.10 * blend, 0.7);
  _totoApply(totoBones.tail2, totoBase.tail2, 0, tailSway * 0.95, sL * 0.16 * blend, 0.7);
}

/**
 * Totodile breathing/squish during idle — chubby Pokémon belly.
 * Identical shape to bababooey's idle squish but shallower so the
 * skeletal animation still reads.
 */
export function applyTotodileIdleSquish(ts, intensity) {
  if (!catModel || intensity <= 0.001) return;
  const t = ts * 0.001;
  const wave = Math.sin(t * 1.5) * 0.7 + Math.sin(t * 2.4 + 0.5) * 0.3;
  const squish = wave * 0.022 * intensity;
  catModel.scale.set(
    baseScale.x * (1 + squish * 0.5),
    baseScale.y * (1 - squish),
    baseScale.z * (1 + squish * 0.5)
  );
}

// ── Korra procedural animations ────────────────────────────────────

function _korraApply(bone, base, pitch, yaw, roll, slerp) {
  if (!bone || !base) return;
  tmpEuler.set(pitch, yaw, roll);
  tmpQuat.setFromEuler(tmpEuler);
  tmpQuatB.copy(base).multiply(tmpQuat);
  bone.quaternion.slerp(tmpQuatB, slerp);
}

/**
 * Korra idle — the generic applyGameplayProceduralIdle() handles tail,
 * head, and spine sway via the auto-detected idle bone arrays.
 * This function adds cat-specific touches: a slow, natural tail sway
 * and gentle weight shifts between legs.
 */
export function applyKorraProceduralIdle(ts, intensity) {
  if (!catModel || intensity <= 0.001) return;
  if (!korraBones.lfLeg && !korraBones.spine) return;
  const t = ts * 0.001;
  const k = Math.min(1, intensity);

  // Slow, expressive tail sway — only yaw (side-to-side) so the base
  // stays anchored to the body. Layered incommensurate frequencies
  // so the motion never repeats and feels alive.
  const tailYaw  = (Math.sin(t * 0.55) * 0.30
                  + Math.sin(t * 0.93 + 1.0) * 0.18
                  + Math.sin(t * 1.71 + 2.3) * 0.08) * k;
  _korraApply(korraBones.tail1, korraBase.tail1, 0, tailYaw, 0, 0.5);

  // Subtle weight shift — legs rock very slightly
  const shift = Math.sin(t * 0.45) * 0.02 * k;
  _korraApply(korraBones.lfLeg, korraBase.lfLeg, shift, 0, 0, 0.3);
  _korraApply(korraBones.rbLeg, korraBase.rbLeg, shift, 0, 0, 0.3);
  _korraApply(korraBones.rfLeg, korraBase.rfLeg, -shift, 0, 0, 0.3);
  _korraApply(korraBones.lbLeg, korraBase.lbLeg, -shift, 0, 0, 0.3);
}

/** Korra breathing squish — gentle chest expansion. */
export function applyKorraIdleSquish(ts, intensity) {
  if (!catModel || intensity <= 0.001) return;
  const t = ts * 0.001;
  const wave = Math.sin(t * 1.4) * 0.65 + Math.sin(t * 2.3 + 0.4) * 0.35;
  const squish = wave * 0.020 * intensity;
  catModel.scale.set(
    baseScale.x * (1 + squish * 0.45),
    baseScale.y * (1 - squish),
    baseScale.z * (1 + squish * 0.45)
  );
}

/**
 * Korra quadruped run cycle: diagonal gait (LF+RB, RF+LB),
 * spine undulation, tail counter-sway.
 *
 * @param {number} ts   - timestamp in ms
 * @param {number} moveSpeed - inches/sec
 * @param {number} moveBlend - 0..1
 */
export function applyKorraProceduralRun(ts, moveSpeed, moveBlend) {
  if (!catModel) return;
  if (!korraBones.lfLeg && !korraBones.rfLeg) return;
  const sp = Math.max(0, moveSpeed);
  const spN = Math.min(1, sp / 27);
  const blend = Math.max(0, Math.min(1, moveBlend)) * Math.max(0.45, spN);
  if (blend < 0.001) return;

  if (!Number.isFinite(_korraRunLastTs) || _korraRunLastTs < 0) _korraRunLastTs = ts;
  const phaseDt = Math.max(0, Math.min(0.05, (ts - _korraRunLastTs) * 0.001));
  _korraRunLastTs = ts;

  // Phase advances with speed — faster run = faster cycle.
  const baseRate = 6.0;
  const speedRate = baseRate + spN * 6.0;
  _korraRunPhase += phaseDt * speedRate;

  const p = _korraRunPhase;
  const sL = Math.sin(p);       // left-pair phase
  const cL = Math.cos(p);
  const sR = Math.sin(p + Math.PI); // right-pair (opposite)
  const cR = Math.cos(p + Math.PI);

  // ── Legs ──
  // Diagonal gait: LF+RB swing together, RF+LB swing together.
  const legSwing = 0.45 * blend;   // forward/back swing amplitude
  const liftAngle = 0.15 * blend;  // knee lift

  // Left-front + Right-back pair
  _korraApply(korraBones.lfLeg,  korraBase.lfLeg,  sL * legSwing, 0, 0, 0.65);
  _korraApply(korraBones.lfFoot, korraBase.lfFoot, Math.max(0, -cL) * liftAngle, 0, 0, 0.5);
  _korraApply(korraBones.rbLeg,  korraBase.rbLeg,  sL * legSwing * 0.85, 0, 0, 0.65);
  _korraApply(korraBones.rbFoot, korraBase.rbFoot, Math.max(0, -cL) * liftAngle, 0, 0, 0.5);

  // Right-front + Left-back pair
  _korraApply(korraBones.rfLeg,  korraBase.rfLeg,  sR * legSwing, 0, 0, 0.65);
  _korraApply(korraBones.rfFoot, korraBase.rfFoot, Math.max(0, -cR) * liftAngle, 0, 0, 0.5);
  _korraApply(korraBones.lbLeg,  korraBase.lbLeg,  sR * legSwing * 0.85, 0, 0, 0.65);
  _korraApply(korraBones.lbFoot, korraBase.lbFoot, Math.max(0, -cR) * liftAngle, 0, 0, 0.5);

  // ── Spine undulation ──
  const spineWave = Math.sin(p * 2) * 0.04 * blend;
  _korraApply(korraBones.spine, korraBase.spine, spineWave, Math.sin(p) * 0.03 * blend, 0, 0.5);
  _korraApply(korraBones.chest, korraBase.chest, -spineWave * 0.6, Math.sin(p + 0.4) * 0.02 * blend, 0, 0.45);

  // ── Hip counter-twist ──
  const hipTwist = Math.sin(p) * 0.06 * blend;
  _korraApply(korraBones.hips, korraBase.hips, 0, hipTwist, 0, 0.45);

  // ── Head stabilization (counter spine bob) ──
  _korraApply(korraBones.neck, korraBase.neck, -spineWave * 0.5, 0, 0, 0.4);
  _korraApply(korraBones.head, korraBase.head, -spineWave * 0.3, 0, 0, 0.35);

  // ── Tail (no run override — idle sway handles it) ──
}

/**
 * Reset the cat model to its base pose and pin to the ground.
 *
 * In Three.js 0.184+, catGroup must stay at identity (pos=0, rot=0) because
 * Skeleton.update() reads bone.matrixWorld which propagates from catGroup.
 * If catGroup moves, bone matrices include that displacement, but
 * boneInverses (from bind time at origin) don't — so the shader applies
 * the displacement twice (once via boneMat, once via modelMatrix).
 *
 * Fix: catGroup stays at identity. All gameplay transforms are applied
 * to catModel directly, combining baseLocalPos with the gameplay offset.
 */
export function resetAndPinGameplayCat() {
  if (!catModel) return;
  catModel.position.copy(baseLocalPos);
  catModel.quaternion.copy(baseLocalQuat);
}
