/**
 * objects.js — stackable block factory (Three.js mesh + Cannon-es physics body)
 *
 * Block dimensions are in metres (AR real-world scale):
 *   cube    : 0.15 m side
 *   sphere  : 0.075 m radius
 *   cylinder: 0.13 m diameter × 0.15 m tall
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
    roughness: 0.5,
    metalness: 0.25,
  });
}

/**
 * Create a Three.js mesh matching the physics shape for the given block type.
 * @param {'cube'|'sphere'|'cylinder'} type
 * @param {number} color  Hex colour
 * @returns {THREE.Mesh}
 */
export function createMesh(type, color) {
  let geo;
  switch (type) {
    case 'sphere':
      geo = new THREE.SphereGeometry(0.075, 20, 16);
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(0.065, 0.065, 0.15, 20);
      break;
    default: // cube
      geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  }
  const mesh = new THREE.Mesh(geo, makeMaterial(color));
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Spawn a block: creates both the Three.js mesh and the Cannon-es physics body.
 *
 * @param {'cube'|'sphere'|'cylinder'} type
 * @param {{x:number, y:number, z:number}} pos  World position in metres.
 * @param {import('./physics.js').PhysicsWorld} physics
 * @param {THREE.Scene} scene
 * @returns {{ type:string, id:number, mesh:THREE.Mesh, color:number, isGrabbed:boolean }}
 */
export function spawnBlock(type, pos, physics, scene) {
  const color = nextColor();
  const mesh  = createMesh(type, color);
  mesh.position.set(pos.x, pos.y, pos.z);
  scene.add(mesh);

  const id = physics.createBlock(type, pos);

  return { type, id, mesh, color, isGrabbed: false };
}

export const BLOCK_TYPES = ['cube', 'sphere', 'cylinder'];
