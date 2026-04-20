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

    const preset = getSelectedModelPreset();
    _centerAndGround(catModel, preset.gameLift);
    if (preset.gameModelZ) catModel.position.z += Number(preset.gameModelZ) || 0;

    baseLocalPos.copy(catModel.position);
    baseLocalQuat.copy(catModel.quaternion);

    // Shadows + material cleanup
    catModel.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && o.material.map) o.material.map.encoding = THREE.sRGBEncoding;
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
  const toRemove = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    const n = String(o.name || '').toLowerCase();
    if (n.includes('backdrop') || n.includes('background') || n.includes('plane') || n.includes('floor') || n.includes('ground')) {
      toRemove.push(o);
    }
  });
  for (const o of toRemove) { if (o.parent) o.parent.remove(o); }
}

function _centerAndGround(model, extraDrop = 0) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= (box.min.y + (extraDrop || 0));
}

function _pinToGround(model, baseLPos, offsetOverride) {
  if (!model || !model.parent) return;
  const preset = getSelectedModelPreset();
  const off = (offsetOverride !== undefined) ? offsetOverride : (preset.groundPinOffset || 0);
  model.position.copy(baseLPos);
  const parent = model.parent;
  parent.updateMatrixWorld(true);
  groundTmpParentPos.setFromMatrixPosition(parent.matrixWorld);
  const worldY = groundTmpParentPos.y + baseLPos.y;
  if (worldY < 0) model.position.y = baseLPos.y - worldY + off;
  else model.position.y = baseLPos.y + off;
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
