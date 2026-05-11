/**
 * physics.js — Rapier.js (WASM) wrapper
 *
 * Provides a thin API over Rapier:
 *  - createWorld()
 *  - createBase()           fixed ground collider
 *  - createBlock(type, pos) dynamic rigid body + collider
 *  - grabBody(handle)       switch body to kinematic
 *  - releaseBody(handle, vel) switch back to dynamic with impulse
 *  - step()                 advance simulation
 *  - syncMeshes(objects)    copy physics transforms → Three.js meshes
 */

let RAPIER = null;

export async function initRapier() {
  const mod = await import('https://esm.sh/@dimforge/rapier3d-compat@0.14.0');
  await mod.init();
  RAPIER = mod;
  return RAPIER;
}

export class PhysicsWorld {
  constructor() {
    if (!RAPIER) throw new Error('Call initRapier() first');

    const gravity = { x: 0, y: -18, z: 0 };
    this.world = new RAPIER.World(gravity);
    this._bodies = new Map(); // handle → { body, collider }

    this._createGround();
    this._createWalls();
  }

  _createGround() {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(5, 0.2, 5).setRestitution(0.3).setFriction(0.8);
    this.world.createCollider(colDesc, body);
  }

  _createWalls() {
    const wallData = [
      [0, 4, -5.5, 5, 4, 0.1],
      [0, 4,  5.5, 5, 4, 0.1],
      [-5.5, 4, 0, 0.1, 4, 5],
      [ 5.5, 4, 0, 0.1, 4, 5],
    ];
    for (const [x, y, z, hw, hh, hd] of wallData) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
      const body = this.world.createRigidBody(bodyDesc);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh, hd), body);
    }
  }

  /**
   * Create a dynamic block and return its Rapier handle.
   * @param {'cube'|'sphere'|'cylinder'} type
   * @param {{x,y,z}} pos
   * @returns {number} rigid body handle
   */
  createBlock(type, pos) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.4)
      .setAngularDamping(0.6)
      .setCcdEnabled(true);

    const body = this.world.createRigidBody(bodyDesc);

    let colDesc;
    switch (type) {
      case 'sphere':
        colDesc = RAPIER.ColliderDesc.ball(0.6).setRestitution(0.4).setFriction(0.7);
        break;
      case 'cylinder':
        colDesc = RAPIER.ColliderDesc.cylinder(0.7, 0.45).setRestitution(0.3).setFriction(0.8);
        break;
      default: // cube
        colDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.6, 0.6).setRestitution(0.25).setFriction(0.9);
    }
    this.world.createCollider(colDesc, body);

    const handle = body.handle;
    this._bodies.set(handle, body);
    return handle;
  }

  grabBody(handle) {
    const body = this._bodies.get(handle);
    if (!body) return;
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setGravityScale(0, true);
  }

  setKinematicPosition(handle, pos) {
    const body = this._bodies.get(handle);
    if (!body) return;
    body.setNextKinematicTranslation(pos);
  }

  setKinematicRotation(handle, quat) {
    const body = this._bodies.get(handle);
    if (!body) return;
    body.setNextKinematicRotation(quat);
  }

  releaseBody(handle) {
    const body = this._bodies.get(handle);
    if (!body) return;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setGravityScale(1, true);
  }

  releaseBodyWithVelocity(handle, vel) {
    const body = this._bodies.get(handle);
    if (!body) return;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setGravityScale(1, true);
    body.setLinvel(vel, true);
  }

  step() {
    this.world.step();
  }

  syncMeshes(objects) {
    for (const obj of objects) {
      const body = this._bodies.get(obj.handle);
      if (!body) continue;
      const t = body.translation();
      const r = body.rotation();
      obj.mesh.position.set(t.x, t.y, t.z);
      obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  removeBody(handle) {
    const body = this._bodies.get(handle);
    if (body) {
      this.world.removeRigidBody(body);
      this._bodies.delete(handle);
    }
  }
}
