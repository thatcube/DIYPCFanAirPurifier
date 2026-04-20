// ─── Material helpers ───────────────────────────────────────────────

import * as THREE from 'three';
import { state } from './state.js';

/**
 * Create a MeshStandardMaterial with PBR defaults.
 * Converts legacy `shininess` → `roughness` (max(0.04, 1 - shininess/120)).
 * Conditionally applies envMap for metallic/glossy surfaces.
 *
 * This matches the monolith's stdMat() exactly.
 */
export function stdMat(opts = {}) {
  if ('shininess' in opts) {
    if (!('roughness' in opts)) opts.roughness = Math.max(0.04, 1 - opts.shininess / 120);
    delete opts.shininess;
  }
  if (!('metalness' in opts)) opts.metalness = 0;
  if (!('roughness' in opts)) opts.roughness = 0.5;
  // Only apply env map to metallic/glossy surfaces
  if (opts.metalness > 0.3 || opts.roughness < 0.15) {
    opts.envMap = state.envMap || window._roomEnvMap;
    if (opts.envMapIntensity === undefined) opts.envMapIntensity = 0.6;
  } else {
    if (opts.envMapIntensity === undefined) opts.envMapIntensity = 0;
  }
  return new THREE.MeshStandardMaterial(opts);
}
