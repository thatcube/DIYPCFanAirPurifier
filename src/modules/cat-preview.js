// ─── Cat Preview Renderer ───────────────────────────────────────────
// Creates mini Three.js scenes for the character select screen.
// Each cat model spins slowly on its own canvas with proper tweaks.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAT_MODEL_PRESETS } from './constants.js';

const previews = []; // { renderer, scene, camera, model, mixer, animSpeed }
let _animId = null;

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
  classic:   { src: 'assets/cat.glb',           extraScale: 1, yOffset: 0 },
  toon:      { src: 'assets/tooncat.glb',       extraScale: 1.25, yOffset: -0.4 },
  bababooey: { src: 'assets/bababooey_cat.glb', extraScale: 1, yOffset: 0 },
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

function _processLoadedModel(preview, entry, gltf, preset) {
  const model = gltf.scene;

  // Strip bababooey backdrop
  if (entry.key === 'bababooey') _stripBababooeyBackdrop(model);

  // Scale to consistent HEIGHT (3 units) so all cats are the same size
  const TARGET_H = 3;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 0.001);
  const s = TARGET_H / h * (preview.cfg.extraScale || 1);
  model.scale.setScalar(s);

  // Re-center: XZ centered, feet on ground (y=0) + per-model Y offset
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y + (preview.cfg.yOffset || 0);

  // Material cleanup
  model.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.metalness = 0;
      child.material.roughness = Math.max(child.material.roughness, 0.6);
    }
  });

  preview.scene.add(model);
  preview.model = model;

  // Animation mixer
  if (gltf.animations && gltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(model);
    let clip = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
    const action = mixer.clipAction(clip);
    action.play();
    preview.mixer = mixer;
    preview.idleAction = action;
    preview.loopPause = Math.max(0, Number(preset.idleLoopPause) || 0);
  }
}

export function initPreviews() {
  const loader = new GLTFLoader();
  const entries = [
    { key: 'classic',   canvasId: 'previewClassic' },
    { key: 'toon',      canvasId: 'previewToon' },
    { key: 'bababooey', canvasId: 'previewBababooey' },
  ];

  for (const entry of entries) {
    const canvas = document.getElementById(entry.canvasId);
    if (!canvas) continue;

    const cfg = MODEL_MAP[entry.key];
    const preset = CAT_MODEL_PRESETS[entry.key] || CAT_MODEL_PRESETS.classic;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Scene
    const scene = new THREE.Scene();

    // Camera — same for all models (cats are normalized to 3 units tall, feet at y=0)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    camera.position.set(0, 1.5, 10);
    camera.lookAt(0, 1.2, 0);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8899bb, 0.4);
    rimLight.position.set(-3, 2, -4);
    scene.add(rimLight);

    const animSpeed = Math.max(0.12, Number(preset.animSpeed) || 1);
    const preview = { renderer, scene, camera, model: null, mixer: null, key: entry.key, cfg, animSpeed };
    previews.push(preview);

    // Load model (with fallback for alt filenames)
    const loadModel = (src) => {
      loader.load(src, (gltf) => {
        _processLoadedModel(preview, entry, gltf, preset);
      }, undefined, (err) => {
        const altSources = { 'assets/tooncat.glb': 'assets/toon-cat.glb', 'assets/toon-cat.glb': 'assets/tooncat.glb' };
        const alt = altSources[src];
        if (alt) { loadModel(alt); }
        else { console.warn('[cat-preview] failed to load', src, err); }
      });
    };
    loadModel(cfg.src);
  }

  if (!_animId) _animate();
}

function _animate() {
  _animId = requestAnimationFrame(_animate);

  const charSelect = document.getElementById('charSelect');
  if (!charSelect || !charSelect.classList.contains('open')) return;

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

    // Spin model slowly
    if (p.model) {
      p.model.rotation.y += 0.012;
    }

    // Update mixer with model-specific animation speed
    if (p.mixer) {
      p.mixer.update(dt * p.animSpeed);
      // Apply idle loop pause (bababooey pauses between bounces)
      if (p.idleAction && p.loopPause > 0) {
        _applyLoopPause(p.idleAction, performance.now(), p.loopPause);
      }
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
