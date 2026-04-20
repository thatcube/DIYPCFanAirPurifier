// ─── Purifier construction (bridge) ─────────────────────────────────
// Will contain all purifier geometry construction. Currently a stub
// that exports the interface other modules need.

import * as THREE from 'three';
import { state } from './state.js';

/**
 * Purifier construction output.
 */
export class PurifierRefs {
  constructor() {
    this.group = new THREE.Group(); // purifierGroup
    this.allRotors = [];
    this.allFanGlows = [];         // now just 1 (consolidated glow)
    this.allGrillMeshes = [];
    this.allGrillMats = [];        // cached flat material list
    this.allBladeMatsPerFan = [];
    this.allFanMats = [];
    this.allBraceMats = [];
    this.allBirchMats = [];
    this.filterL = null;
    this.filterR = null;
    this.filterMatRef = null;
    this.parts = {};               // named mesh parts for explode/collapse
    this.origins = {};             // original positions for collapse
    this.targets = {};             // explode target positions
    this.purifierGlow = null;      // single PointLight
    this.consoleProps = null;
    this.tvGameStackProps = null;
  }
}

/**
 * Create the complete purifier assembly.
 * Returns a PurifierRefs object with all mesh references.
 *
 * During migration, this is a stub.
 */
export function createPurifier(scene) {
  const refs = new PurifierRefs();
  scene.add(refs.group);
  console.log('[purifier] createPurifier stub — purifier construction pending migration');
  return refs;
}
