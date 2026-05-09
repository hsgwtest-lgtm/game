/**
 * coords.js — 2D camera space → 3D world space conversion
 *
 * MediaPipe returns normalised [0,1] coords (x mirrored for front camera).
 * We unproject them onto a plane at a given depth using Three.js camera math.
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

/**
 * Convert normalised MediaPipe landmark position to a Three.js world position.
 *
 * @param {number} nx  - normalised x [0,1], 0=left edge of video
 * @param {number} ny  - normalised y [0,1], 0=top edge of video
 * @param {number} depth - distance forward into the scene along the Z axis
 *                        (world z = camera.z - depth; depth=camera.z → world z=0)
 * @param {THREE.PerspectiveCamera} camera
 * @returns {THREE.Vector3}
 */
export function landmarkToWorld(nx, ny, depth, camera) {
  // The video element is CSS-mirrored (scaleX(-1)), so the user sees a natural
  // mirror image. MediaPipe x=0 is the left edge of the raw frame which appears
  // on the RIGHT side of the mirrored display. We must invert x here so that
  // the world-space position matches what the user sees on screen.
  // NDC: x [-1,1], y [-1,1]  (y flipped because NDC +y = up)
  const ndcX = (1 - nx) * 2 - 1;
  const ndcY = -(ny * 2 - 1);

  // Unproject NDC at near plane, then scale to desired depth
  const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
  vec.unproject(camera);

  // Ray from camera origin toward vec
  const dir = vec.sub(camera.position).normalize();
  // Walk along ray so that world.z = camera.z - depth
  // (depth = camera.z gives world.z = 0, the scene centre)
  const t = depth / -dir.z;
  return camera.position.clone().addScaledVector(dir, t);
}
