// ─── Material helpers ───────────────────────────────────────────────

import * as THREE from 'three';

/**
 * Create a MeshPhongMaterial with sensible defaults.
 * Drop-in replacement for the inline stdMat() used throughout the project.
 */
export function stdMat(opts = {}) {
  const defaults = {
    color: 0xcccccc,
    shininess: 30,
    flatShading: false,
    side: THREE.FrontSide
  };
  return new THREE.MeshPhongMaterial({ ...defaults, ...opts });
}
