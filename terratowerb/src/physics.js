/**
 * physics.js — Cannon-es physics wrapper for TerraTowerβ
 *
 * Uses cannon-es (a modern ES-module fork of cannon.js) for 3D stacking physics.
 * Coordinate system: Y-up, metres. The ground body is repositioned once the
 * WebXR Hit Test detects the real floor level.
 */
import * as CANNON from 'https://esm.sh/cannon-es@0.20.0';

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    this._bodies = new Map(); // id (number) → CANNON.Body
    this._nextId = 0;

    this._groundBody = this._createGround();
  }

  // ─── Ground / floor ─────────────────────────────────────────────────────────

  _createGround() {
    // Infinite horizontal plane (normal points +Y after rotation)
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);
    return body;
  }

  /**
   * Reposition the physics ground to match the real-world floor detected by
   * WebXR Hit Test.
   * @param {number} y  World-space Y of the detected floor.
   */
  setFloorY(y) {
    this._groundBody.position.set(0, y, 0);
  }

  // ─── Block bodies ────────────────────────────────────────────────────────────

  /**
   * Create a dynamic physics body for a block and return its unique id.
   * @param {'cube'|'sphere'|'cylinder'} type
   * @param {{x:number, y:number, z:number}} pos  Initial world position (metres).
   * @returns {number} body id
   */
  createBlock(type, pos) {
    let shape;
    switch (type) {
      case 'sphere':
        shape = new CANNON.Sphere(0.075);
        break;
      case 'cylinder':
        // Cannon-es Cylinder: Cylinder(radiusTop, radiusBottom, height, numSegments)
        shape = new CANNON.Cylinder(0.065, 0.065, 0.15, 8);
        break;
      default: // cube
        shape = new CANNON.Box(new CANNON.Vec3(0.075, 0.075, 0.075));
    }

    const body = new CANNON.Body({
      mass: 0.5,
      shape,
      linearDamping:  0.35,
      angularDamping: 0.55,
    });
    body.position.set(pos.x, pos.y, pos.z);
    body.allowSleep = true;
    body.sleepSpeedLimit  = 0.05;
    body.sleepTimeLimit   = 1.0;
    this.world.addBody(body);

    const id = this._nextId++;
    this._bodies.set(id, body);
    return id;
  }

  // ─── Grab / release ──────────────────────────────────────────────────────────

  /**
   * Switch a body to kinematic so it can be moved by hand without physics interference.
   * @param {number} id
   */
  grabBody(id) {
    const body = this._bodies.get(id);
    if (!body) return;
    body.type = CANNON.Body.KINEMATIC;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.wakeUp();
  }

  /**
   * Teleport a kinematic body to a new world position (called every XR frame while grabbing).
   * @param {number} id
   * @param {{x:number, y:number, z:number}} pos
   */
  setKinematicPosition(id, pos) {
    const body = this._bodies.get(id);
    if (!body) return;
    body.position.set(pos.x, pos.y, pos.z);
    body.velocity.set(0, 0, 0);
  }

  /**
   * Release a grabbed body back to dynamic physics.
   * @param {number} id
   */
  releaseBody(id) {
    const body = this._bodies.get(id);
    if (!body) return;
    body.type = CANNON.Body.DYNAMIC;
    body.wakeUp();
  }

  /**
   * Release a grabbed body with an explicit throw velocity.
   * @param {number} id
   * @param {{x:number, y:number, z:number}} vel  m/s
   */
  releaseBodyWithVelocity(id, vel) {
    const body = this._bodies.get(id);
    if (!body) return;
    body.type = CANNON.Body.DYNAMIC;
    body.velocity.set(vel.x, vel.y, vel.z);
    body.wakeUp();
  }

  // ─── Simulation ─────────────────────────────────────────────────────────────

  /**
   * Advance the simulation.
   * @param {number} dt  Frame delta in seconds.
   */
  step(dt) {
    const fixedDt = 1 / 60;
    const maxSubSteps = 3;
    this.world.step(fixedDt, dt, maxSubSteps);
  }

  /**
   * Copy physics transforms to Three.js meshes (skip grabbed objects).
   * @param {Array<{id:number, mesh:Object, isGrabbed:boolean}>} objects
   */
  syncMeshes(objects) {
    for (const obj of objects) {
      if (obj.isGrabbed) continue;
      const body = this._bodies.get(obj.id);
      if (!body) continue;
      obj.mesh.position.copy(body.position);
      obj.mesh.quaternion.copy(body.quaternion);
    }
  }

  /**
   * Remove a body from the simulation.
   * @param {number} id
   */
  removeBody(id) {
    const body = this._bodies.get(id);
    if (body) {
      this.world.removeBody(body);
      this._bodies.delete(id);
    }
  }
}
