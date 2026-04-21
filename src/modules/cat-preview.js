// ─── Cat Preview Renderer ───────────────────────────────────────────
// Creates mini Three.js scenes for the character select screen.
// Each cat model spins slowly on its own canvas.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const previews = []; // { renderer, scene, camera, model, mixer }
let _animId = null;

const MODEL_MAP = {
  classic:   { src: 'assets/cat.glb', scale: 4.5, y: -2.5, camY: 1 },
  toon:      { src: 'assets/tooncat.glb', scale: 4, y: -3, camY: 0.5 },
  bababooey: { src: 'assets/bababooey_cat.glb', scale: 4.5, y: -2.5, camY: 1 },
};

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

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, cfg.camY, 8);
    camera.lookAt(0, cfg.camY, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffeedd, 1.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8899bb, 0.4);
    rim.position.set(-3, 2, -4);
    scene.add(rim);

    const preview = { renderer, scene, camera, model: null, mixer: null, key: entry.key, cfg };
    previews.push(preview);

    // Load model
    loader.load(cfg.src, (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(cfg.scale);
      model.position.y = cfg.y;
      scene.add(model);
      preview.model = model;

      // Animation mixer
      if (gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        // Try to find idle animation, fall back to first
        let clip = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
        const action = mixer.clipAction(clip);
        action.play();
        preview.mixer = mixer;
      }
    }, undefined, (err) => {
      console.warn('[cat-preview] failed to load', cfg.src, err);
    });
  }

  // Start render loop
  if (!_animId) _animate();
}

function _animate() {
  _animId = requestAnimationFrame(_animate);

  const charSelect = document.getElementById('charSelect');
  if (!charSelect || !charSelect.classList.contains('open')) return;

  const dt = 1 / 60;

  for (const p of previews) {
    // Resize canvas to match CSS size
    const rect = p.renderer.domElement.getBoundingClientRect();
    const w = Math.floor(rect.width * window.devicePixelRatio);
    const h = Math.floor(rect.height * window.devicePixelRatio);
    if (p.renderer.domElement.width !== w || p.renderer.domElement.height !== h) {
      p.renderer.setSize(rect.width, rect.height, false);
      p.camera.aspect = rect.width / rect.height;
      p.camera.updateProjectionMatrix();
    }

    // Spin model
    if (p.model) {
      p.model.rotation.y += 0.01;
    }

    // Update mixer
    if (p.mixer) {
      p.mixer.update(dt);
    }

    p.renderer.render(p.scene, p.camera);
  }
}

export function disposePreviews() {
  if (_animId) {
    cancelAnimationFrame(_animId);
    _animId = null;
  }
  for (const p of previews) {
    p.renderer.dispose();
  }
  previews.length = 0;
}
