// ─── Cat Preview Renderer ───────────────────────────────────────────
// Creates mini Three.js scenes for the character select screen.
// Each cat model spins slowly on its own canvas with proper tweaks.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAT_MODEL_PRESETS } from './constants.js';

const previews = []; // { renderer, scene, camera, model, mixer, animSpeed }
let _animId = null;

const PREVIEW_BASE_YAW = THREE.MathUtils.degToRad(35);
const PREVIEW_SPIN_SPEED = 0.012;
const PREVIEW_RETURN_STIFFNESS = 0.16;

/** Pause a looping action for `pauseSeconds` between loops */
function _applyLoopPause(action, ts, pauseSeconds) {
  if (!action) return;
  const clip = action.getClip();
  if (!clip || clip.duration <= 0) return;
  const cycleTime = action.time % clip.duration;
  const nearEnd = cycleTime > clip.duration * 0.92;
  if (nearEnd) {
    if (!action._loopPauseStart) action._loopPauseStart = ts;
    if (ts - action._loopPauseStart < pauseSeconds * 1000) {
      action.paused = true; return;
    }
    action._loopPauseStart = null; action.paused = false;
  } else {
    action._loopPauseStart = null; action.paused = false;
  }
}

const MODEL_MAP = {
  classic: { src: 'assets/cat.glb' },
  toon: { src: 'assets/tooncat.glb' },
  bababooey: { src: 'assets/bababooey_cat.glb' },
  totodile: { src: 'assets/totodile.glb' },
  korra: { src: null, procedural: true },
};

/**
 * Remove the bababooey cat's backdrop/graph mesh.
 * Matches by name regex or falls back to the largest planar mesh.
 */
function _stripBababooeyBackdrop(model) {
  if (!model) return;
  const nameHint = /(graph|chart|grid|axis|axes|backdrop|background|board|screen|panel|plane|pplane|lambert1)/i;
  const toRemove = [];

  model.traverse(child => {
    if (!child.isMesh) return;
    const name = (child.name || '').toLowerCase();
    const matName = (child.material && child.material.name || '').toLowerCase();
    if (nameHint.test(name) || nameHint.test(matName)) {
      toRemove.push(child);
    }
  });

  // Fallback: remove the largest planar mesh if no name match
  if (toRemove.length === 0) {
    let biggest = null, biggestArea = 0;
    model.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
      const dims = [sx, sy, sz].sort((a, b) => b - a);
      // Planar = thinnest dimension < 10% of largest
      if (dims[2] < dims[0] * 0.1) {
        const area = dims[0] * dims[1];
        if (area > biggestArea) { biggestArea = area; biggest = child; }
      }
    });
    if (biggest) toRemove.push(biggest);
  }

  for (const mesh of toRemove) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
      else mesh.material.dispose();
    }
  }
}

// ── Procedural idle for preview (self-contained) ────────────────────

const _pvEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _pvQA = new THREE.Quaternion();
const _pvQB = new THREE.Quaternion();

function _collectPreviewIdleBones(model) {
  const tailRe = /(^tail\d*([._]|$)|_tail|tail_)/i;
  const headRe = /(^head$|^head[._]|_head|head_|^neck$|^neck[._]|_neck|neck_)/i;
  const spineRe = /(^spine$|^spine[._]|_spine|spine_|^chest$|^chest[._]|_chest|chest_)/i;
  const tails = [], heads = [], spines = [];
  model.traverse(o => {
    if (!o || !o.isBone) return;
    const n = String(o.name || '');
    if (tailRe.test(n)) tails.push(o);
    if (headRe.test(n)) heads.push(o);
    if (spineRe.test(n)) spines.push(o);
  });
  if (tails.length > 4) tails.length = 4;
  if (spines.length > 2) spines.length = 2;
  // Pick best head bone
  const filteredHeads = [];
  if (heads.length) {
    const headBone = heads.find(b => /head/i.test(String(b.name || ''))) || heads[0];
    filteredHeads.push(headBone);
    const neckBone = heads.find(b => /neck/i.test(String(b.name || '')) && b !== headBone);
    if (neckBone) filteredHeads.push(neckBone);
  }
  // Store base quaternions
  const all = [...tails, ...spines, ...filteredHeads];
  for (const b of all) {
    if (!b.userData) b.userData = {};
    b.userData._pvBaseQuat = b.quaternion.clone();
  }
  return { tails, heads: filteredHeads, spines };
}

function _applyPreviewProceduralIdle(bones, ts) {
  const t = ts * 0.001;
  for (let i = 0; i < bones.tails.length; i++) {
    const b = bones.tails[i];
    const base = b.userData._pvBaseQuat;
    const wave = 0.75 + (i * 0.18);
    const yaw = Math.sin((t * 1.7 * wave) + (i * 0.55)) * 0.065;
    const pitch = Math.sin((t * 1.2 * wave) + (i * 0.4)) * 0.025;
    const roll = Math.sin((t * 1.05 * wave) + (i * 0.9)) * 0.012;
    _pvEuler.set(pitch, yaw, roll);
    _pvQA.setFromEuler(_pvEuler);
    _pvQB.copy(base).multiply(_pvQA);
    b.quaternion.slerp(_pvQB, 0.5);
  }
  for (let i = 0; i < bones.spines.length; i++) {
    const b = bones.spines[i];
    const base = b.userData._pvBaseQuat;
    const swayScale = 0.65 - (i * 0.12);
    const yaw = Math.sin((t * 0.82) + (i * 0.45)) * 0.012 * swayScale;
    const pitch = Math.sin((t * 0.62) + (i * 0.35)) * 0.008 * swayScale;
    _pvEuler.set(pitch, yaw, 0);
    _pvQA.setFromEuler(_pvEuler);
    _pvQB.copy(base).multiply(_pvQA);
    b.quaternion.slerp(_pvQB, 0.32);
  }
  for (let i = 0; i < bones.heads.length; i++) {
    const b = bones.heads[i];
    const base = b.userData._pvBaseQuat;
    const headScale = i === 0 ? 1 : 0.58;
    const yaw = (Math.sin((t * 0.8) + 0.7) * 0.12 + Math.sin((t * 1.55) + 0.2) * 0.036) * headScale;
    const pitch = (Math.sin((t * 0.62) + 1.1) * 0.072 + Math.sin((t * 1.35) + 0.9) * 0.021) * headScale;
    _pvEuler.set(pitch, yaw, 0);
    _pvQA.setFromEuler(_pvEuler);
    _pvQB.copy(base).multiply(_pvQA);
    b.quaternion.slerp(_pvQB, 0.78);
  }
}

function _processLoadedModel(preview, entry, gltf, preset) {
  const model = gltf.scene;

  // Strip bababooey backdrop
  if (entry.key === 'bababooey') _stripBababooeyBackdrop(model);

  // Scale to consistent HEIGHT (3 units) so all cats are the same size
  const TARGET_H = 3;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 0.001);
  const s = TARGET_H / h;
  model.scale.setScalar(s);

  // Re-center: XZ centered, feet on ground (y=0)
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  // Second pass — find the lowest foot bone to correct grounding for
  // skeletal models whose geometry extends below the foot rest position.
  model.updateMatrixWorld(true);
  let minFootY = Infinity;
  const _tmpV = new THREE.Vector3();
  model.traverse(o => {
    if (!o || !o.isBone) return;
    if (!/foot|toe|paw/i.test(String(o.name || ''))) return;
    o.getWorldPosition(_tmpV);
    if (_tmpV.y < minFootY) minFootY = _tmpV.y;
  });
  if (Number.isFinite(minFootY)) model.position.y -= minFootY;

  model.rotation.y = PREVIEW_BASE_YAW;

  // Material cleanup
  model.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.metalness = 0;
      child.material.roughness = Math.max(child.material.roughness, 0.6);
    }
  });

  preview.scene.add(model);
  preview.model = model;
  preview.baseScale = model.scale.x; // uniform scale, save for squish

  // Auto-frame camera to fit the model with consistent padding.
  // Compute the bounding sphere after final positioning, then set
  // camera distance so the model fills roughly the same fraction of
  // the viewport regardless of proportions.
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fovRad = THREE.MathUtils.degToRad(preview.camera.fov);
  // Distance so the sphere fits with ~25% padding
  const fitDist = (sphere.radius * 0.95) / Math.sin(fovRad / 2);
  // Position camera slightly right and above center, looking at sphere center
  preview.camera.position.set(
    sphere.center.x + fitDist * 0.12,
    sphere.center.y + fitDist * 0.08,
    sphere.center.z + fitDist
  );
  preview.camera.lookAt(sphere.center.x, sphere.center.y * 0.85, sphere.center.z);
  preview.camera.updateProjectionMatrix();

  // Animation mixer
  if (gltf.animations && gltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find(a => /idle|sit|rest/i.test(a.name));
    if (idleClip) {
      // Has a dedicated idle clip — play it
      const action = mixer.clipAction(idleClip);
      action.play();
      preview.mixer = mixer;
      preview.idleAction = action;
      preview.loopPause = Math.max(0, Number(preset.idleLoopPause) || 0);
    } else {
      // No idle clip (e.g. toon cat only has walk) — use procedural idle.
      // Don't play any baked clip; just collect bones for procedural sway.
      preview.mixer = mixer;
      preview.useProceduralIdle = true;
      preview.idleBones = _collectPreviewIdleBones(model);
    }
  } else {
    // No animations at all — still set up procedural idle
    preview.useProceduralIdle = true;
    preview.idleBones = _collectPreviewIdleBones(model);
  }
}

export function initPreviews() {
  const loader = new GLTFLoader();
  const entries = [
    { key: 'classic', canvasId: 'previewClassic' },
    { key: 'toon', canvasId: 'previewToon' },
    { key: 'bababooey', canvasId: 'previewBababooey' },
    { key: 'totodile', canvasId: 'previewTotodile' },
    { key: 'korra', canvasId: 'previewKorra' },
  ];

  for (const entry of entries) {
    const canvas = document.getElementById(entry.canvasId);
    if (!canvas) continue;

    const cfg = MODEL_MAP[entry.key];
    const preset = CAT_MODEL_PRESETS[entry.key] || CAT_MODEL_PRESETS.classic;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Scene
    const scene = new THREE.Scene();

    // Camera — will be auto-framed per model after loading
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    camera.position.set(0, 1.5, 10); // default, overridden by auto-frame
    camera.lookAt(0, 1, 0);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8899bb, 0.4);
    rimLight.position.set(-3, 2, -4);
    scene.add(rimLight);

    const animSpeed = Math.max(0.12, Number(preset.animSpeed) || 1);
    const preview = { renderer, scene, camera, model: null, mixer: null, key: entry.key, cfg, animSpeed, src: cfg.src };
    previews.push(preview);

    if (cfg.procedural) {
      // Procedural model (Korra) — build in code, no GLB needed.
      import('./korra-model.js').then(({ buildKorraModel }) => {
        const result = buildKorraModel();
        // Wrap in a fake gltf-like structure for _processLoadedModel.
        const fakeGltf = { scene: result.scene, animations: result.animations || [] };
        _processLoadedModel(preview, entry, fakeGltf, preset);
        _renderPreviewOnce(preview);
      }).catch(err => console.warn('[cat-preview] procedural build failed', err));
    } else {
      // Load model (with fallback for alt filenames)
      const loadModel = (src) => {
        loader.load(src, (gltf) => {
          _processLoadedModel(preview, entry, gltf, preset);
          _renderPreviewOnce(preview);
        }, undefined, (err) => {
          const altSources = { 'assets/tooncat.glb': 'assets/toon-cat.glb', 'assets/toon-cat.glb': 'assets/tooncat.glb' };
          const alt = altSources[src];
          if (alt) { loadModel(alt); }
          else { console.warn('[cat-preview] failed to load', src, err); }
        });
      };
      loadModel(cfg.src);
    }
  }

  if (!_animId) _animate();
}

/** Size the canvas and render a single frame, even if the char-select modal
 *  hasn't been opened yet. Safe to call at any time; no-ops if the canvas
 *  has no layout yet. */
function _renderPreviewOnce(p) {
  if (!p || !p.renderer || !p.model) return;
  const rect = p.renderer.domElement.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    p.renderer.setSize(rect.width, rect.height, false);
    p.camera.aspect = rect.width / rect.height;
    p.camera.updateProjectionMatrix();
  }
  p.renderer.render(p.scene, p.camera);
}

/** Re-render all loaded previews once. Call when the character-select modal
 *  is opened so the first frame appears without waiting for rAF. */
export function flushPreviewsOnOpen() {
  for (const p of previews) _renderPreviewOnce(p);
}

function _animate() {
  _animId = requestAnimationFrame(_animate);

  const charSelect = document.getElementById('charSelect');
  if (!charSelect || !charSelect.classList.contains('open')) return;

  // Only animate rotation for the currently selected cat card.
  const selectedCard = document.querySelector('.char-card.selected[data-model]');
  const selectedKey = selectedCard ? selectedCard.getAttribute('data-model') : 'classic';

  const dt = 1 / 60;

  for (const p of previews) {
    // Resize canvas
    const rect = p.renderer.domElement.getBoundingClientRect();
    const w = Math.floor(rect.width * window.devicePixelRatio);
    const h = Math.floor(rect.height * window.devicePixelRatio);
    if (p.renderer.domElement.width !== w || p.renderer.domElement.height !== h) {
      p.renderer.setSize(rect.width, rect.height, false);
      p.camera.aspect = rect.width / rect.height;
      p.camera.updateProjectionMatrix();
    }

    // Spin only the selected model; non-selected models ease back to base yaw.
    if (p.model && p.key === selectedKey) {
      p.model.rotation.y += PREVIEW_SPIN_SPEED;
    } else if (p.model) {
      const delta = Math.atan2(
        Math.sin(PREVIEW_BASE_YAW - p.model.rotation.y),
        Math.cos(PREVIEW_BASE_YAW - p.model.rotation.y)
      );
      p.model.rotation.y += delta * PREVIEW_RETURN_STIFFNESS;
      if (Math.abs(delta) < 0.0009) p.model.rotation.y = PREVIEW_BASE_YAW;
    }

    // Update mixer with model-specific animation speed
    if (p.mixer && !p.useProceduralIdle) {
      p.mixer.update(dt * p.animSpeed);
      // Apply idle loop pause (bababooey pauses between bounces)
      if (p.idleAction && p.loopPause > 0) {
        _applyLoopPause(p.idleAction, performance.now(), p.loopPause);
      }
    }

    // Procedural idle for models without a dedicated idle clip
    if (p.useProceduralIdle && p.idleBones) {
      _applyPreviewProceduralIdle(p.idleBones, performance.now());
    }

    // Bababooey idle squish — gentle breathing scale oscillation
    if (p.key === 'bababooey' && p.model && p.baseScale) {
      const t = performance.now() * 0.001;
      const wave = Math.sin(t * 1.6) * 0.7 + Math.sin(t * 2.5) * 0.3;
      const sq = wave * 0.035;
      p.model.scale.set(
        p.baseScale * (1 + sq * 0.6),
        p.baseScale * (1 - sq),
        p.baseScale * (1 + sq * 0.6)
      );
    }
    // Totodile idle squish — shallower since the bone idle still reads.
    if (p.key === 'totodile' && p.model && p.baseScale) {
      const t = performance.now() * 0.001;
      const wave = Math.sin(t * 1.5) * 0.7 + Math.sin(t * 2.4 + 0.5) * 0.3;
      const sq = wave * 0.022;
      p.model.scale.set(
        p.baseScale * (1 + sq * 0.5),
        p.baseScale * (1 - sq),
        p.baseScale * (1 + sq * 0.5)
      );
    }

    p.renderer.render(p.scene, p.camera);
  }
}

export function disposePreviews() {
  if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
  for (const p of previews) { p.renderer.dispose(); }
  previews.length = 0;
}

/** Recolor the classic cat preview model */
export function recolorClassicPreview(coatHex) {
  const p = previews.find(p => p.key === 'classic');
  if (!p || !p.model) return;
  const color = new THREE.Color(coatHex);
  p.model.traverse(child => {
    if (child.isMesh && child.material && child.material.map) {
      // Tint the base color to approximate the coat
      child.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.3);
      child.material.needsUpdate = true;
    }
  });
}
