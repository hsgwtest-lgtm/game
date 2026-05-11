/**
 * coords.js — 2D camera space → 3D world space conversion (AR / rear camera)
 *
 * MediaPipe returns normalised [0,1] coords.
 * For the rear (environment-facing) camera the video is NOT CSS-mirrored,
 * so MediaPipe x=0 is the left edge of the frame AND appears on the LEFT side
 * of the display.  No x-inversion is needed.
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

/**
 * Convert normalised MediaPipe landmark position to a Three.js world position.
 *
 * @param {number} nx  - normalised x [0,1], 0=left edge of video/display
 * @param {number} ny  - normalised y [0,1], 0=top edge of video/display
 * @param {number} depth - distance forward into the scene along the Z axis
 * @param {THREE.PerspectiveCamera} camera
 * @returns {THREE.Vector3}
 */
export function landmarkToWorld(nx, ny, depth, camera) {
  // Rear camera: no CSS mirror, x=0 is left of display → no inversion needed.
  // NDC: x [-1,1], y [-1,1]  (y flipped because NDC +y = up)
  const ndcX =  (nx * 2 - 1);
  const ndcY = -(ny * 2 - 1);

  // Unproject NDC at near plane, then scale to desired depth
  const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
  vec.unproject(camera);

  // Ray from camera origin toward vec
  const dir = vec.sub(camera.position).normalize();
  // Walk along ray so that world.z = camera.z - depth
  const t = depth / -dir.z;
  return camera.position.clone().addScaledVector(dir, t);
}
