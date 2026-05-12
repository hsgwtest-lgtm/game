/**
 * coords.js — 2D camera space → 3D world space conversion
 *
 * MediaPipe returns normalised [0,1] coords (x mirrored for front camera).
 * We unproject them onto a plane at a given depth using Three.js camera math.
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

// Reuse allocations to avoid GC pressure
const _camForward = new THREE.Vector3();

/**
 * Convert normalised MediaPipe landmark position to a Three.js world position.
 *
 * Works correctly for any camera orientation, including device-orientation AR.
 *
 * @param {number} nx    - normalised x [0,1], 0=left edge of video
 * @param {number} ny    - normalised y [0,1], 0=top edge of video
 * @param {number} depth - distance along the camera's forward axis (world units)
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

  // Unproject NDC at near plane to get a world-space direction
  const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
  vec.unproject(camera);

  // Ray from camera origin toward vec
  const dir = vec.sub(camera.position).normalize();

  // Camera's forward direction in world space (-Z in camera-local space)
  _camForward.set(0, 0, -1).applyQuaternion(camera.quaternion);

  // Walk along the ray until the projection onto the forward axis equals `depth`.
  // This is robust for any camera orientation (AR device-orientation mode included).
  const proj = dir.dot(_camForward);
  const t = Math.abs(proj) > 0.0001 ? depth / proj : depth;

  return camera.position.clone().addScaledVector(dir, t);
}
