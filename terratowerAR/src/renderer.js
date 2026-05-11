/**
 * renderer.js — Three.js scene setup for AR mode
 *
 * Renders with a fully transparent background so the live rear-camera feed
 * shows through underneath.  No scene fog or opaque background geometry.
 * The platform is a semi-transparent AR-style ring/grid so blocks appear to
 * rest on a "virtual surface" floating in the real world.
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Transparent clear — real camera feed shows through
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    // No fog: the real world provides depth cues

    this._setupCamera();
    this._setupLights();
    this._setupBase();

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
    // Brighter ambient to blend naturally with real-world lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.0);
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

    const fillLight = new THREE.PointLight(0x58a6ff, 0.4, 40);
    fillLight.position.set(-8, 10, 5);
    this.scene.add(fillLight);
  }

  _setupBase() {
    // Semi-transparent platform so it blends with the real scene
    const geo = new THREE.BoxGeometry(10, 0.4, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1c2333,
      roughness: 0.8,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
    });
    this.baseMesh = new THREE.Mesh(geo, mat);
    this.baseMesh.position.y = 0;
    this.baseMesh.receiveShadow = true;
    this.scene.add(this.baseMesh);

    // Glowing AR grid on top of the platform
    const grid = new THREE.GridHelper(10, 10, 0x58a6ff, 0x30363d);
    grid.position.y = 0.21;
    // Make grid semi-transparent
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    this.scene.add(grid);

    // Corner marker dots to reinforce the AR plane
    const dotGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff });
    const corners = [[-5,0.25,-5],[-5,0.25,5],[5,0.25,-5],[5,0.25,5]];
    for (const [x, y, z] of corners) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(x, y, z);
      this.scene.add(dot);
    }
  }

  _onResize() {
    const w = this.renderer.domElement.parentElement.clientWidth;
    const h = this.renderer.domElement.parentElement.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  add(obj) { this.scene.add(obj); }
  remove(obj) { this.scene.remove(obj); }
}
