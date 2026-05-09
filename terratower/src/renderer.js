/**
 * renderer.js — Three.js scene setup
 */
import * as THREE from 'https://esm.sh/three@0.176.0';

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

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  add(obj) { this.scene.add(obj); }
  remove(obj) { this.scene.remove(obj); }
}
