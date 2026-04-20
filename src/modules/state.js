// ─── Shared application state ───────────────────────────────────────
// Central state object so modules can access shared references (scene,
// camera, renderer, etc.) without circular imports.

import * as THREE from 'three';

export const state = {
  /** @type {THREE.Scene} */
  scene: null,
  /** @type {THREE.PerspectiveCamera} */
  camera: null,
  /** @type {THREE.WebGLRenderer} */
  renderer: null,
  /** @type {HTMLCanvasElement} */
  canvas: null,

  // Device detection
  isMobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),

  // Quality
  qualityTier: 0,

  // Purifier dimensions (inches) — shared across many modules
  W: 5.44,     // filter width
  H: 19.69,    // filter height  
  D: 24.69,    // filter depth
  ply: 0.5,    // plywood thickness (half-inch)
  ft: 0.78,    // filter thickness
  bunFootH: 2.5,
  bunFootR: 0.55,

  // Derived
  get panelW() { return this.W + 2 * this.ft; },
  get floorY() { return -(this.H / 2 + this.ply + this.bunFootH); },
};
