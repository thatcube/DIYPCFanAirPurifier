// Shared cat model helpers used by preview/game/finish renderers.

/**
 * Remove Bababooey backdrop/graph meshes.
 *
 * If `sourceHint` is provided and does not look like Bababooey, this is a no-op.
 */
export function stripBababooeyBackdrop(model, sourceHint = '') {
  if (!model) return;
  if (sourceHint && !/bababooey/i.test(String(sourceHint))) return;

  const hint = /(graph|chart|grid|axis|axes|backdrop|background|board|screen|panel|plane|pplane|lambert1|floor|ground)/i;
  const toRemove = [];
  const seen = new Set();

  const addUnique = (mesh) => {
    if (!mesh || seen.has(mesh)) return;
    seen.add(mesh);
    toRemove.push(mesh);
  };

  model.traverse((child) => {
    if (!child.isMesh) return;
    const name = String(child.name || '');
    const matName = String((child.material && child.material.name) || '');
    if (hint.test(name) || hint.test(matName)) addUnique(child);
  });

  // Fallback: remove the largest planar mesh if no name-based match exists.
  if (toRemove.length === 0) {
    let biggest = null;
    let biggestArea = 0;
    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      if (!bb) return;
      const dims = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].sort((a, b) => b - a);
      if (dims[2] < dims[0] * 0.1) {
        const area = dims[0] * dims[1];
        if (area > biggestArea) {
          biggestArea = area;
          biggest = child;
        }
      }
    });
    if (biggest) addUnique(biggest);
  }

  for (const mesh of toRemove) {
    if (mesh.parent) mesh.parent.remove(mesh);
  }
}
