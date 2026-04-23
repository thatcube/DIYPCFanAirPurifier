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

export let catModel = null;
export let catMixer = null;
export let catWalkAction = null;
export let catIdleAction = null;

// ── Constants ───────────────────────────────────────────────────────

const TARGET_HEIGHT = 4.0; // desired visual height in inches
const NOD_DUR_MS = 620;
const NOD_AMP = 1.35;      // peak pitch in radians (~77°)

// ── State ───────────────────────────────────────────────────────────

const baseScale     = new THREE.Vector3(1, 1, 1);
const previewBaseScale = new THREE.Vector3(1, 1, 1);
const baseLocalPos  = new THREE.Vector3();
const baseLocalQuat = new THREE.Quaternion();
let gameLoadNonce = 0;
let nodStartTs = -1e9;

// Bone references for procedural animation
const idleTailBones  = [];
const idleHeadBones  = [];
const idleSpineBones = [];
const tmpEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const tmpQuat  = new THREE.Quaternion();
const tmpQuatB = new THREE.Quaternion();
const groundTmpParentPos = new THREE.Vector3();
const boxTmp = new THREE.Box3();

// Bababooey bone refs
const babaBones = { left: null, right: null, up: null, down: null, mid: null };
const babaBase  = { left: null, right: null, up: null, down: null, mid: null };

// Toon leg bone refs
const toonLegBones = {};
const toonLegBase  = {};

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
  const loader = new GLTFLoader();
  const sources = getSourcesForModelKey(catModelKey);
  console.log('[cat-anim] loading sources:', sources);

  _loadWithFallback(loader, (gltf, src) => {
    if (nonce !== gameLoadNonce) return;
    console.log('[cat-anim] loaded:', src);
    catModel = gltf.scene;
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

    // Log final model metrics for debugging new models
    {
      const dbgBox = new THREE.Box3().setFromObject(catModel);
      const dbgSize = dbgBox.getSize(new THREE.Vector3());
      console.log(`[cat-anim] model "${catModelKey}" grounded — pos: (${catModel.position.x.toFixed(2)}, ${catModel.position.y.toFixed(2)}, ${catModel.position.z.toFixed(2)}) size: (${dbgSize.x.toFixed(2)}, ${dbgSize.y.toFixed(2)}, ${dbgSize.z.toFixed(2)}) box.min.y: ${dbgBox.min.y.toFixed(3)}`);
    }

    // Shadows + material cleanup
    catModel.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
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

    // Animations
    if (gltf.animations && gltf.animations.length) {
      catMixer = new THREE.AnimationMixer(catModel);
      const byName = (names) => {
        for (const n of names) {
          const c = gltf.animations.find(a => a.name.toLowerCase().includes(n));
          if (c) return c;
        }
        return null;
      };
      const walkClip = byName(['walk', 'run', 'gallop']) || gltf.animations[0];
      const idleClip = byName(['idle', 'sit', 'rest']) || gltf.animations[0];
      if (walkClip) { catWalkAction = catMixer.clipAction(walkClip); catWalkAction.play(); catWalkAction.weight = 0; }
      if (idleClip && idleClip !== walkClip) { catIdleAction = catMixer.clipAction(idleClip); catIdleAction.play(); catIdleAction.weight = 1; }
      else if (catWalkAction) catWalkAction.weight = 1;
    }
  }, (err) => { console.warn('Cat load failed', err); }, sources);
}

export function clearGameplayCat() {
  if (catMixer) { catMixer.stopAllAction(); catMixer = null; }
  catWalkAction = null; catIdleAction = null;
  if (catModel && catModel.parent) catModel.parent.remove(catModel);
  catModel = null;
  _resetIdleBones();
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

  // Box-based ground pin: compute the actual mesh bounding box (which
  // changes with animation), convert to parent-local space, and push
  // the model up/down so its feet sit at baseLPos.y.
  boxTmp.setFromObject(model);
  if (!Number.isFinite(boxTmp.min.y)) return;
  const parent = model.parent;
  parent.getWorldPosition(groundTmpParentPos);
  const localMinY = boxTmp.min.y - groundTmpParentPos.y;
  const targetLocalMinY = baseLPos.y + 0.002;
  const delta = targetLocalMinY - localMinY;
  model.position.y += delta;
}

// ── Bone collection ─────────────────────────────────────────────────

function _resetIdleBones() {
  idleTailBones.length = 0;
  idleHeadBones.length = 0;
  idleSpineBones.length = 0;
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
      upperFR: /^leg\.upper\.F\.R/i, lowerFR: /^leg\.lower\.F\.R/i, footFR: /^foot\.F\.R/i
    };
    for (const k in toonMap) {
      if (toonLegBones[k] == null && toonMap[k].test(n)) {
        toonLegBones[k] = o; toonLegBase[k] = o.quaternion.clone();
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
    if (!b.userData) b.userData = {};
    b.userData._catIdleBaseQuat = b.quaternion.clone();
  }
}

export function applyGameplayProceduralIdle(ts, intensity) {
  if (intensity <= 0) return;
  const t = ts * 0.001;

  for (let i = 0; i < idleTailBones.length; i++) {
    const b = idleTailBones[i];
    if (!b || !b.isBone) continue;
    const base = (b.userData && b.userData._catIdleBaseQuat && b.userData._catIdleBaseQuat.isQuaternion)
      ? b.userData._catIdleBaseQuat
      : b.quaternion;
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
    const base = (b.userData && b.userData._catIdleBaseQuat && b.userData._catIdleBaseQuat.isQuaternion)
      ? b.userData._catIdleBaseQuat
      : b.quaternion;
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
    const base = (b.userData && b.userData._catIdleBaseQuat && b.userData._catIdleBaseQuat.isQuaternion)
      ? b.userData._catIdleBaseQuat
      : b.quaternion;
    const headScale = i === 0 ? 1 : 0.58;
    const yaw = (Math.sin((t * 0.8) + 0.7) * 0.12 + Math.sin((t * 1.55) + 0.2) * 0.036) * intensity * headScale;
    const pitch = (Math.sin((t * 0.62) + 1.1) * 0.072 + Math.sin((t * 1.35) + 0.9) * 0.021) * intensity * headScale;
    tmpEuler.set(pitch, yaw, 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpQuatB.copy(base).multiply(tmpQuat);
    b.quaternion.slerp(tmpQuatB, Math.min(1, 0.78 * intensity));
  }
}

export function applyBababooeyProceduralRun(ts, moveSpeed, moveBlend) {
  if (!babaBones.left && !babaBones.right && !babaBones.down && !babaBones.up && !babaBones.mid) return;
  const t = ts * 0.001;
  const sp = Math.max(0, moveSpeed);
  const spN = Math.min(1, sp / 0.45);
  const blend = Math.max(0, Math.min(1, moveBlend)) * spN;
  if (blend <= 0.001) return;

  const cadence = 6.0 + spN * 5.5;
  const phase = t * cadence;
  const pawAmp = (0.55 + spN * 0.55) * 0.5;
  const liftL = Math.sin(phase);
  const liftR = Math.sin(phase + Math.PI);
  const lL = liftL * pawAmp * blend;
  const lR = liftR * pawAmp * blend;

  const apply = (bone, baseQ, euler, strength) => {
    if (!bone || !baseQ) return;
    tmpQuat.setFromEuler(euler);
    tmpQuatB.copy(baseQ).multiply(tmpQuat);
    const s = Math.min(1, (strength !== undefined ? strength : 0.65) * blend);
    bone.quaternion.slerp(tmpQuatB, s);
  };

  tmpEuler.set(-Math.abs(lL) * 0.4, 0, lL * 0.85);
  apply(babaBones.left, babaBase.left, tmpEuler, 0.7);

  tmpEuler.set(-Math.abs(lR) * 0.4, 0, -lR * 0.85);
  apply(babaBones.right, babaBase.right, tmpEuler, 0.7);

  if (babaBones.down) {
    tmpEuler.set(Math.sin(phase * 0.5) * 0.09 * blend, Math.sin((phase * 0.5) + 1.2) * 0.175 * blend, 0);
    apply(babaBones.down, babaBase.down, tmpEuler, 0.6);
  }
  if (babaBones.up) {
    const lean = (0.08 + spN * 0.16) * 0.5;
    tmpEuler.set(-lean * blend, Math.sin(phase * 0.5) * 0.03 * blend, 0);
    apply(babaBones.up, babaBase.up, tmpEuler, 0.6);
  }
  if (babaBones.mid) {
    tmpEuler.set(Math.sin(phase) * 0.02 * blend, Math.sin(phase * 0.5) * 0.035 * blend, Math.sin(phase) * 0.025 * blend);
    apply(babaBones.mid, babaBase.mid, tmpEuler, 0.5);
  }
}

function _applyToonJumpLegs(squash) {
  const L = toonLegBones;
  const B = toonLegBase;
  if (!L.upperBL && !L.upperBR && !L.upperFL && !L.upperFR) return;

  const s = Math.max(-0.45, Math.min(1, squash));
  const legScale = s >= 0 ? (1 - s * 0.55) : (1 + (-s) * 0.33);
  const shinScale = 1 - (1 - legScale) * 0.8;

  const setScale = (bone, v) => { if (bone) bone.scale.y = v; };
  setScale(L.thighBL, legScale); setScale(L.thighBR, legScale);
  setScale(L.upperBL, legScale); setScale(L.upperBR, legScale);
  setScale(L.upperFL, legScale); setScale(L.upperFR, legScale);
  setScale(L.lowerBL, shinScale); setScale(L.lowerBR, shinScale);
  setScale(L.lowerFL, shinScale); setScale(L.lowerFR, shinScale);

  const boneKeys = ['thighBL', 'thighBR', 'upperBL', 'upperBR', 'upperFL', 'upperFR',
    'lowerBL', 'lowerBR', 'lowerFL', 'lowerFR'];
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

  let target = 0;
  if (grounded && held > 0) {
    target = 0.55 * chargeN;
  } else if (vY > 0.05) {
    target = Math.max(-0.45, -vY * 3.2);
  } else if (vY < -0.03 && !isToon) {
    const k = isBaba ? 11 : 7;
    target = Math.min(1, (-vY) * k);
  }

  const ease = 1 - Math.exp(-Math.max(0, dtSec) * 14);
  st._squashBlend += (target - st._squashBlend) * ease;
  const s = st._squashBlend;

  const syK = isBaba ? 0.55 : (isToon ? 0.12 : 0.35);
  const sxzK = isBaba ? 0.40 : (isToon ? 0.06 : 0.22);
  const sy = 1 - s * syK;
  const sxz = 1 + s * sxzK;
  catModel.scale.set(baseScale.x * sxz, baseScale.y * sy, baseScale.z * sxz);

  if (isToon) {
    _applyToonJumpLegs(s);
    _pinToGround(catModel, baseLocalPos);
  }
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

/**
 * Reset the cat model to its base pose and pin to the ground using the
 * box-based approach. Called every frame BEFORE applyGameplayJumpDeform
 * so animations don't drift the cat through the floor.
 */
export function resetAndPinGameplayCat() {
  if (!catModel) return;
  catModel.position.copy(baseLocalPos);
  catModel.quaternion.copy(baseLocalQuat);
  _pinToGround(catModel, baseLocalPos);
}
