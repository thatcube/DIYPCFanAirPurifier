// ─── Renderer setup ─────────────────────────────────────────────────

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { state } from './state.js';
import { QUALITY_DPR_TIERS_MOBILE, QUALITY_DPR_TIERS_DESKTOP } from './constants.js';

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

  const dprTiers = state.isMobile ? QUALITY_DPR_TIERS_MOBILE : QUALITY_DPR_TIERS_DESKTOP;
  const dpr = Math.min(window.devicePixelRatio, dprTiers[state.qualityTier] || dprTiers[0]);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0xd4dce8, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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

  // Build a cheap PMREM environment map so metallic/glossy materials
  // (stainless water bowl, chrome, glass, etc.) have something real to
  // reflect. We deliberately do NOT assign scene.environment — that would
  // make the env act as an ambient IBL light on every PBR material and
  // brighten the whole room (breaking the night/lights-off look). Instead
  // we publish the texture on state.envMap; stdMat() opts individual
  // metallic/glossy materials into reflecting it.
  if (state.renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      state.envMap = envTex;
      window._roomEnvMap = envTex;
      pmrem.dispose();
    } catch (e) {
      console.warn('PMREM env map generation failed:', e);
    }
  }

  return { scene, camera };
}
