/**
 * objects.js — stackable block factory (Three.js mesh + Rapier physics body)
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

const COLORS = [0xff6b35, 0xffd700, 0x58a6ff, 0x7ee787, 0xbc8cff, 0xff9f43];
let colorIdx = 0;

function nextColor() {
  return COLORS[colorIdx++ % COLORS.length];
}

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.3,
    envMapIntensity: 0.8,
  });
}

/**
 * Create a Three.js mesh for the given block type.
 * @param {'cube'|'sphere'|'cylinder'} type
 * @param {number} color
 * @returns {THREE.Mesh}
 */
export function createMesh(type, color) {
  let geo;
  switch (type) {
    case 'sphere':
      geo = new THREE.SphereGeometry(0.6, 20, 16);
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(0.45, 0.45, 1.4, 20);
      break;
    default:
      geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
  const mat = makeMaterial(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Full block entry — mesh + physics handle + metadata.
 * @param {'cube'|'sphere'|'cylinder'} type
 * @param {{x,y,z}} pos
 * @param {import('./physics.js').PhysicsWorld} physics
 * @param {import('./renderer.js').Renderer} renderer
 * @returns {{ type, handle, mesh, color, isGrabbed }}
 */
export function spawnBlock(type, pos, physics, renderer) {
  const color = nextColor();
  const mesh = createMesh(type, color);
  mesh.position.set(pos.x, pos.y, pos.z);
  renderer.add(mesh);

  const handle = physics.createBlock(type, pos);

  return { type, handle, mesh, color, isGrabbed: false };
}

export const BLOCK_TYPES = ['cube', 'sphere', 'cylinder'];
