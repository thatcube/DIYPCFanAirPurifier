// ─── Renderer setup ─────────────────────────────────────────────────

import * as THREE from 'three';
import { state } from './state.js';
import { QUALITY_DPR_TIERS } from './constants.js';

/**
 * Create and configure the WebGL renderer.
 * Shows a friendly error page if WebGL isn't available.
 */
export function createRenderer(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
  } catch (e) {
    document.body.innerHTML = `
      <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
        background:#0a0e14;color:#e8eef7;font-family:system-ui;padding:32px;text-align:center">
        <div>
          <h1 style="font-size:28px;margin-bottom:16px">WebGL Not Available</h1>
          <p style="opacity:0.7;max-width:480px;line-height:1.6">
            Your browser couldn't initialize 3D graphics. Try:<br>
            • Updating your GPU drivers<br>
            • Enabling hardware acceleration in browser settings<br>
            • Closing other tabs using 3D graphics<br>
            • Using a different browser (Chrome/Edge)
          </p>
        </div>
      </div>`;
    throw e;
  }

  const dpr = QUALITY_DPR_TIERS[state.qualityTier] || QUALITY_DPR_TIERS[0];
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0xd4dce8, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  state.renderer = renderer;
  state.canvas = canvas;

  return renderer;
}

/**
 * Create the scene + camera.
 */
export function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd4dce8, 0.0015);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(45, 15, 45);

  state.scene = scene;
  state.camera = camera;

  return { scene, camera };
}
