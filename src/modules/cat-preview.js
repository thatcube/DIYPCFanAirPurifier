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
  classic:   { src: 'assets/cat.glb',           scale: 4.5, y: -2.5, camY: 1.7, camZ: 4.7, targetY: 1.0 },
  toon:      { src: 'assets/tooncat.glb',       scale: 4.0, y: -3.0, camY: 1.85, camZ: 5.15, targetY: 1.1 },
  bababooey: { src: 'assets/bababooey_cat.glb', scale: 4.5, y: -2.5, camY: 1.9, camZ: 5.35, targetY: 1.15 },
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

    // Camera — use preset values for framing
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, cfg.camY, cfg.camZ);
    camera.lookAt(0, cfg.targetY, 0);

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

    // Load model
    loader.load(cfg.src, (gltf) => {
      const model = gltf.scene;

      // Strip bababooey backdrop (graph/chart mesh)
      if (entry.key === 'bababooey') {
        _stripBababooeyBackdrop(model);
      }

      model.scale.setScalar(cfg.scale);
      model.position.y = cfg.y;

      // Clean up materials for consistent look
      model.traverse(child => {
        if (child.isMesh && child.material) {
          child.material.metalness = 0;
          child.material.roughness = Math.max(child.material.roughness, 0.6);
        }
      });

      scene.add(model);
      preview.model = model;

      // Animation mixer
      if (gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        // Find idle animation, fall back to first
        let clip = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
        const action = mixer.clipAction(clip);
        action.play();
        preview.mixer = mixer;
        preview.idleAction = action;
        preview.loopPause = Math.max(0, Number(preset.idleLoopPause) || 0);
      }
    }, undefined, (err) => {
      console.warn('[cat-preview] failed to load', cfg.src, err);
    });
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
