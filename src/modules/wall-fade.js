// ─── Room auto-fade ─────────────────────────────────────────────────
// Fades ANY room object (walls, ceiling, bed, furniture) that is
// between the camera and the orbit target so nothing blocks the view.
// Console props (Xbox, Switch, game stack) are excluded.

import * as THREE from 'three';

// ── State ───────────────────────────────────────────────────────────

const _fadingMeshes = [];
let _target = new THREE.Vector3(); // orbit target (updated each frame)

// Reusable vectors
const _camDir = new THREE.Vector3();
const _objDir = new THREE.Vector3();

// ── Init: collect all room meshes ───────────────────────────────────

export function init(scene, roomRefs) {
  _fadingMeshes.length = 0;

  scene.traverse(obj => {
    if (!obj._isRoom || !obj.isMesh || !obj.material) return;
    // Skip console props — Xbox, Switch, game stack should never fade
    if (obj._isConsoleProp || obj._noFade) {
      obj.material.transparent = false;
      obj.material.opacity = 1;
      obj.material.depthWrite = true;
      return;
    }
    // Preserve intentionally translucent materials
    if (obj.material.transparent || obj.material.opacity < 0.999) {
      obj._fadeBaseOpacity = obj.material.opacity;
      obj._fadeBaseTransparent = obj.material.transparent;
      obj._fadeBaseDepthWrite = obj.material.depthWrite;
    } else {
      obj.material.transparent = false;
      obj.material.opacity = 1;
      obj.material.depthWrite = true;
    }

    // Tag by position for directional fading
    const z = obj.position.z, x = obj.position.x, y = obj.position.y;
    if (obj === roomRefs.floor || obj._isFloor) { obj._fadeTag = 'floor'; }
    else if (obj === roomRefs.ceiling) { obj._fadeTag = 'ceiling'; }
    else if (z > 47 && Math.abs(x) < 60) { obj._fadeTag = 'back'; }
    else if (z < -76 && Math.abs(x) < 60) { obj._fadeTag = 'front'; }
    else if (x < -49) { obj._fadeTag = 'right'; }
    else if (x > 79) { obj._fadeTag = 'left'; }
    else { obj._fadeTag = 'interior'; }

    _fadingMeshes.push(obj);
  });
}

// ── Per-frame fade update ───────────────────────────────────────────

function _setFadeOpacity(mesh, alpha) {
  const mat = mesh.material;
  if (mesh._fadeBaseOpacity !== undefined) {
    mat.opacity = Math.min(mesh._fadeBaseOpacity, alpha);
    mat.transparent = mesh._fadeBaseTransparent;
    mat.depthWrite = mesh._fadeBaseDepthWrite;
    return;
  }
  const faded = alpha < 0.999;
  if (mat.transparent !== faded) {
    mat.transparent = faded;
    mat.needsUpdate = true;
  }
  mat.depthWrite = !faded;
  mat.opacity = alpha;
}

export function update(camera, orbitTarget) {
  if (!_fadingMeshes.length) return;

  if (orbitTarget) _target.copy(orbitTarget);

  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;

  // Camera → target direction
  _camDir.set(_target.x - cx, _target.y - cy, _target.z - cz);
  const camDist = _camDir.length();
  if (camDist > 0.01) _camDir.divideScalar(camDist);

  // Determine if camera is outside each wall boundary
  const margin = 4;
  const outsideBack  = cz > 49 - margin;
  const outsideFront = cz < -78 + margin;
  const outsideRight = cx < -51 + margin;
  const outsideLeft  = cx > 81 - margin;
  const aboveCeiling = cy > 67;

  for (const m of _fadingMeshes) {
    const tag = m._fadeTag;

    // Floor: fade when below
    if (tag === 'floor') {
      _setFadeOpacity(m, cy < m.position.y ? 0.08 : 1);
      continue;
    }

    // Ceiling: fade when camera is above or looking down from high angle
    if (tag === 'ceiling') {
      _setFadeOpacity(m, aboveCeiling || cy > 50 ? 0.08 : 1);
      continue;
    }

    // Exterior walls: fade when camera is outside that wall
    if (tag === 'back' || tag === 'front' || tag === 'right' || tag === 'left') {
      const outside = (tag === 'back' && outsideBack)
        || (tag === 'front' && outsideFront)
        || (tag === 'right' && outsideRight)
        || (tag === 'left' && outsideLeft);
      _setFadeOpacity(m, outside ? 0.08 : 1);
      continue;
    }

    // Interior objects: fade if they're between camera and target
    // Project object position onto camera→target ray
    const ox = m.position.x - cx;
    const oy = m.position.y - cy;
    const oz = m.position.z - cz;
    // Dot product = how far along the ray this object is
    const dot = ox * _camDir.x + oy * _camDir.y + oz * _camDir.z;
    // Cross-distance = how far from the ray axis
    const projX = ox - _camDir.x * dot;
    const projY = oy - _camDir.y * dot;
    const projZ = oz - _camDir.z * dot;
    const crossDist = Math.sqrt(projX * projX + projY * projY + projZ * projZ);

    // Object is "in the way" if it's between camera and target (dot > 0, dot < camDist)
    // and close to the ray axis (crossDist < threshold)
    const inFront = dot > -5 && dot < camDist * 0.85;
    const nearRay = crossDist < 25; // generous radius for big objects like bed

    if (inFront && nearRay) {
      // Fade more aggressively the closer to the ray axis
      const t = Math.max(0.03, crossDist / 25);
      _setFadeOpacity(m, t);
    } else {
      _setFadeOpacity(m, 1);
    }
  }
}

// ── Reset all to opaque (e.g. entering FP mode) ────────────────────

export function resetAll() {
  for (const m of _fadingMeshes) {
    _setFadeOpacity(m, 1);
  }
}
