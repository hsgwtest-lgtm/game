/**
 * renderer.js — Three.js scene setup + AR device-orientation camera control
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

// ─── Device-orientation helpers (Three.js DeviceOrientationControls algorithm) ─
const _arEuler = new THREE.Euler();
const _arQ0    = new THREE.Quaternion();
// -90° rotation around X: camera looks out the back of the device when upright
const _arQ1    = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const _arZee   = new THREE.Vector3(0, 0, 1);

/**
 * Convert DeviceOrientationEvent angles + screen-orientation angle to a
 * world-space quaternion for the Three.js camera.
 *
 * @param {number|null} alpha  – compass heading [0, 360)
 * @param {number|null} beta   – front/back tilt [-180, 180)
 * @param {number|null} gamma  – left/right tilt [-90, 90)
 * @param {number}      screen – screen orientation angle (degrees)
 * @returns {THREE.Quaternion}
 */
function deviceOrientationQuat(alpha, beta, gamma, screen) {
  _arEuler.set(
    THREE.MathUtils.degToRad(beta   ?? 0),
    THREE.MathUtils.degToRad(alpha  ?? 0),
    THREE.MathUtils.degToRad(-(gamma ?? 0)),
    'YXZ',
  );
  const q = new THREE.Quaternion().setFromEuler(_arEuler);
  q.multiply(_arQ1);                                          // tilt to camera-forward frame
  _arQ0.setFromAxisAngle(_arZee, -THREE.MathUtils.degToRad(screen ?? 0));
  q.multiply(_arQ0);                                          // adjust for screen rotation
  return q;
}

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0d1117, 0.04);

    this._setupCamera();
    this._setupLights();
    this._setupBackground();
    this._setupBase();

    // AR state
    this._arEnabled       = false;
    this._arBaseQuat      = null;   // camera quaternion at the moment AR is enabled
    this._arDeviceQ0Inv   = null;   // inverse of device quat when AR was anchored
    this._arSmoothedQuat  = new THREE.Quaternion();

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._onResize();
  }

  _setupCamera() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 200);
    this.camera.position.set(0, 8, 18);
    this.camera.lookAt(0, 3, 0);
  }

  _setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    dirLight.position.set(8, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.setScalar(1024);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -12;
    dirLight.shadow.camera.right = 12;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -4;
    this.scene.add(dirLight);

    const fillLight = new THREE.PointLight(0x58a6ff, 0.6, 40);
    fillLight.position.set(-8, 10, 5);
    this.scene.add(fillLight);
  }

  _setupBackground() {
    // Gradient background via a large sphere
    const bgGeo = new THREE.SphereGeometry(80, 16, 16);
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x0d1117,
      side: THREE.BackSide,
    });
    this.scene.add(new THREE.Mesh(bgGeo, bgMat));
  }

  _setupBase() {
    // Visible platform
    const geo = new THREE.BoxGeometry(10, 0.4, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1c2333,
      roughness: 0.8,
      metalness: 0.2,
    });
    this.baseMesh = new THREE.Mesh(geo, mat);
    this.baseMesh.position.y = 0;
    this.baseMesh.receiveShadow = true;
    this.scene.add(this.baseMesh);

    // Grid helper on top of platform
    const grid = new THREE.GridHelper(10, 10, 0x30363d, 0x21262d);
    grid.position.y = 0.21;
    this.scene.add(grid);
  }

  _onResize() {
    const w = this.renderer.domElement.parentElement.clientWidth;
    const h = this.renderer.domElement.parentElement.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ─── AR methods ─────────────────────────────────────────────────────────────

  /**
   * Enable device-orientation AR control.
   * Call this AFTER the camera is positioned and oriented.
   * The current camera quaternion is saved as the "neutral" orientation;
   * subsequent device-orientation changes rotate relative to this baseline.
   */
  enableAR() {
    this._arEnabled      = true;
    this._arBaseQuat     = this.camera.quaternion.clone();
    this._arSmoothedQuat.copy(this.camera.quaternion);
    this._arDeviceQ0Inv  = null; // will be set on first event
  }

  /**
   * Feed raw DeviceOrientationEvent angles + screen rotation angle.
   * Applies a smoothed delta rotation to the camera.
   *
   * @param {number|null} alpha
   * @param {number|null} beta
   * @param {number|null} gamma
   * @param {number}      screenAngle  – screen orientation in degrees
   */
  applyDeviceOrientation(alpha, beta, gamma, screenAngle) {
    if (!this._arEnabled) return;
    if (alpha === null && beta === null && gamma === null) return;

    const Q = deviceOrientationQuat(alpha, beta, gamma, screenAngle);

    if (!this._arDeviceQ0Inv) {
      // Anchor: capture the device orientation at the moment AR started
      this._arDeviceQ0Inv = Q.clone().invert();
      return;
    }

    // World-space delta rotation from the anchored orientation
    const Q_delta = Q.clone().multiply(this._arDeviceQ0Inv);

    // Apply delta on top of the baseline camera orientation
    const target = this._arBaseQuat.clone();
    target.premultiply(Q_delta);

    // Smooth slerp to avoid jitter — factor 0.25 means ~10 orientation events
    // (≈ 0.17 s at 60 Hz device rate) are needed for the camera to fully settle.
    this._arSmoothedQuat.slerp(target, 0.25);
    this.camera.quaternion.copy(this._arSmoothedQuat);
  }

  /**
   * Re-anchor the AR orientation to the current device attitude.
   * Call this when the user wants to reset their view direction.
   */
  resetAROrientation() {
    this._arDeviceQ0Inv = null;
    this._arBaseQuat    = this.camera.quaternion.clone();
    this._arSmoothedQuat.copy(this.camera.quaternion);
  }

  // ─── Core render ────────────────────────────────────────────────────────────

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  add(obj) { this.scene.add(obj); }
  remove(obj) { this.scene.remove(obj); }
}
