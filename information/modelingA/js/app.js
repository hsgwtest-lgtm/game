/* =============================================
   Mobile 3D Modeler - Main Application
   Three.js viewport, primitives, transforms,
   CSG operations, project management
   ============================================= */

(function () {
  'use strict';

  // ---- State ----
  var state = {
    scene: null,
    camera: null,
    renderer: null,
    orbitControls: null,
    transformControls: null,
    objects: [],        // User-created meshes
    selectedObject: null,
    selectedObjects: [], // For CSG multi-select
    transformMode: 'translate',
    projectId: null,
    projectName: 'Untitled',
    undoStack: [],
    redoStack: [],
    autoSaveTimer: null,
    objectCounter: 0,
    gridHelper: null
  };

  // ---- Materials ----
  var COLORS = [0x58a6ff, 0x3fb950, 0xf85149, 0xd29922, 0xbc8cff, 0x79c0ff];
  var colorIndex = 0;

  function nextColor() {
    var c = COLORS[colorIndex % COLORS.length];
    colorIndex++;
    return c;
  }

  function createMaterial(color) {
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.1,
      roughness: 0.6,
      flatShading: false
    });
  }

  // ---- Initialization ----
  function init() {
    initScene();
    initLights();
    initGrid();
    initControls();
    initUI();
    initServiceWorker();
    loadLastProject();
    animate();
    scheduleAutoSave();
  }

  function initScene() {
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0d1117);

    state.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    state.camera.position.set(80, 60, 80);
    state.camera.lookAt(0, 0, 0);

    var canvas = document.getElementById('viewport');
    state.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    resizeRenderer();
    window.addEventListener('resize', resizeRenderer);
  }

  function resizeRenderer() {
    var container = document.getElementById('viewport-container');
    var w = container.clientWidth;
    var h = container.clientHeight;
    state.renderer.setSize(w, h);
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
  }

  function initLights() {
    var ambient = new THREE.AmbientLight(0xffffff, 0.5);
    state.scene.add(ambient);

    var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 300;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    state.scene.add(dirLight);

    var fillLight = new THREE.DirectionalLight(0x88aaff, 0.3);
    fillLight.position.set(-30, 40, -30);
    state.scene.add(fillLight);
  }

  function initGrid() {
    // Build plate grid (200mm x 200mm)
    var gridSize = 200;
    var gridDivisions = 20; // 10mm per division

    state.gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x30363d, 0x21262d);
    state.scene.add(state.gridHelper);

    // Build plate surface
    var plateGeom = new THREE.PlaneGeometry(gridSize, gridSize);
    var plateMat = new THREE.MeshStandardMaterial({
      color: 0x161b22,
      metalness: 0.0,
      roughness: 0.9,
      transparent: true,
      opacity: 0.8
    });
    var plate = new THREE.Mesh(plateGeom, plateMat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.1;
    plate.receiveShadow = true;
    plate.userData.isPlate = true;
    state.scene.add(plate);
  }

  function initControls() {
    // OrbitControls
    state.orbitControls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
    state.orbitControls.enableDamping = true;
    state.orbitControls.dampingFactor = 0.1;
    state.orbitControls.target.set(0, 0, 0);
    state.orbitControls.minDistance = 10;
    state.orbitControls.maxDistance = 500;
    state.orbitControls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    // TransformControls
    state.transformControls = new THREE.TransformControls(state.camera, state.renderer.domElement);
    state.transformControls.setSize(1.2); // Larger gizmo for touch
    state.transformControls.setSpace('world');
    state.scene.add(state.transformControls);

    state.transformControls.addEventListener('dragging-changed', function (event) {
      state.orbitControls.enabled = !event.value;
    });

    state.transformControls.addEventListener('objectChange', function () {
      updateTransformPanel();
    });

    state.transformControls.addEventListener('mouseUp', function () {
      pushUndo();
    });

    // Raycaster for object selection
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var pointerDownTime = 0;
    var pointerDownPos = { x: 0, y: 0 };

    var canvas = state.renderer.domElement;

    canvas.addEventListener('pointerdown', function (e) {
      pointerDownTime = Date.now();
      pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('pointerup', function (e) {
      var elapsed = Date.now() - pointerDownTime;
      var dx = e.clientX - pointerDownPos.x;
      var dy = e.clientY - pointerDownPos.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      // Only treat as tap if short and no drag
      if (elapsed < 300 && dist < 10) {
        var rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, state.camera);

        var hits = raycaster.intersectObjects(state.objects, false);
        if (hits.length > 0) {
          selectObject(hits[0].object);
        } else {
          deselectAll();
        }
      }
    });
  }

  // ---- Object Selection ----
  function selectObject(obj) {
    deselectAll();
    state.selectedObject = obj;
    obj.material.emissive = new THREE.Color(0x224488);
    obj.material.emissiveIntensity = 0.3;
    state.transformControls.attach(obj);
    state.transformControls.setMode(state.transformMode);
    updateTransformPanel();
    document.getElementById('selected-name').textContent = obj.name;
  }

  function deselectAll() {
    if (state.selectedObject) {
      state.selectedObject.material.emissive = new THREE.Color(0x000000);
      state.selectedObject.material.emissiveIntensity = 0;
    }
    state.selectedObject = null;
    state.selectedObjects = [];
    state.transformControls.detach();
    document.getElementById('selected-name').textContent = 'オブジェクト未選択';
    resetTransformPanel();
  }

  // ---- Primitives ----
  function addPrimitive(type) {
    state.objectCounter++;
    var geom, name;
    var size = 20; // Default 20mm

    switch (type) {
      case 'cube':
        geom = new THREE.BoxGeometry(size, size, size);
        name = 'Cube_' + String(state.objectCounter).padStart(2, '0');
        break;
      case 'cylinder':
        geom = new THREE.CylinderGeometry(size / 2, size / 2, size, 32);
        name = 'Cylinder_' + String(state.objectCounter).padStart(2, '0');
        break;
      case 'sphere':
        geom = new THREE.SphereGeometry(size / 2, 32, 24);
        name = 'Sphere_' + String(state.objectCounter).padStart(2, '0');
        break;
      case 'cone':
        geom = new THREE.ConeGeometry(size / 2, size, 32);
        name = 'Cone_' + String(state.objectCounter).padStart(2, '0');
        break;
      case 'torus':
        geom = new THREE.TorusGeometry(size / 2, size / 6, 24, 48);
        name = 'Torus_' + String(state.objectCounter).padStart(2, '0');
        break;
      default:
        return;
    }

    var color = nextColor();
    var mat = createMaterial(color);
    var mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, size / 2, 0);
    mesh.name = name;
    mesh.userData.shapeType = type;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    state.scene.add(mesh);
    state.objects.push(mesh);
    selectObject(mesh);
    pushUndo();
    showToast(name + ' を追加');
  }

  // ---- Transform Panel ----
  function updateTransformPanel() {
    var obj = state.selectedObject;
    if (!obj) return;

    document.getElementById('pos-x').value = obj.position.x.toFixed(1);
    document.getElementById('pos-y').value = obj.position.y.toFixed(1);
    document.getElementById('pos-z').value = obj.position.z.toFixed(1);
    document.getElementById('scale-slider').value = obj.scale.x;
    document.getElementById('scale-value').textContent = obj.scale.x.toFixed(1);

    var rotY = THREE.MathUtils.radToDeg(obj.rotation.y);
    document.getElementById('rotation-slider').value = ((rotY % 360) + 360) % 360;
    document.getElementById('rotation-value').textContent = Math.round(((rotY % 360) + 360) % 360) + '°';
  }

  function resetTransformPanel() {
    document.getElementById('pos-x').value = '0';
    document.getElementById('pos-y').value = '0';
    document.getElementById('pos-z').value = '0';
    document.getElementById('scale-slider').value = '1';
    document.getElementById('scale-value').textContent = '1.0';
    document.getElementById('rotation-slider').value = '0';
    document.getElementById('rotation-value').textContent = '0°';
  }

  function applyPositionFromInputs() {
    var obj = state.selectedObject;
    if (!obj) return;
    obj.position.x = parseFloat(document.getElementById('pos-x').value) || 0;
    obj.position.y = parseFloat(document.getElementById('pos-y').value) || 0;
    obj.position.z = parseFloat(document.getElementById('pos-z').value) || 0;
    pushUndo();
  }

  // ---- CSG Operations ----
  function performCSG(operation) {
    if (state.objects.length < 2) {
      showToast('CSG演算には2つ以上のオブジェクトが必要です');
      return;
    }

    // Use last two objects if none specifically selected
    var objB = state.selectedObject || state.objects[state.objects.length - 1];
    var objA = null;

    // Find the other object (the one before selected, or second to last)
    for (var i = state.objects.length - 1; i >= 0; i--) {
      if (state.objects[i] !== objB) {
        objA = state.objects[i];
        break;
      }
    }

    if (!objA || !objB) {
      showToast('CSG演算に2つのオブジェクトを選択してください');
      return;
    }

    showToast('CSG演算中...');

    try {
      var material = createMaterial(objA.material.color.getHex());
      var result;

      switch (operation) {
        case 'union':
          result = CSGEngine.union(objA, objB, material);
          break;
        case 'subtract':
          result = CSGEngine.subtract(objA, objB, material);
          break;
        case 'intersect':
          result = CSGEngine.intersect(objA, objB, material);
          break;
      }

      if (result) {
        state.objectCounter++;
        result.name = 'CSG_' + String(state.objectCounter).padStart(2, '0');
        result.userData.shapeType = 'custom';
        result.castShadow = true;
        result.receiveShadow = true;

        // Remove source objects and dispose
        removeObject(objA);
        removeObject(objB);

        // Add result
        state.scene.add(result);
        state.objects.push(result);
        selectObject(result);
        pushUndo();

        var opNames = { union: '結合', subtract: '切削', intersect: '交差' };
        showToast(opNames[operation] + '完了: ' + result.name);
      }
    } catch (e) {
      console.error('CSG error:', e);
      showToast('CSG演算に失敗しました');
    }
  }

  // ---- Object Management ----
  function removeObject(obj) {
    var idx = state.objects.indexOf(obj);
    if (idx >= 0) state.objects.splice(idx, 1);
    state.scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }

  function deleteSelected() {
    if (!state.selectedObject) {
      showToast('オブジェクトを選択してください');
      return;
    }
    var name = state.selectedObject.name;
    state.transformControls.detach();
    removeObject(state.selectedObject);
    state.selectedObject = null;
    resetTransformPanel();
    document.getElementById('selected-name').textContent = 'オブジェクト未選択';
    pushUndo();
    showToast(name + ' を削除');
  }

  // ---- Undo/Redo ----
  function captureState() {
    return state.objects.map(function (obj) { return ProjectStorage.serializeMesh(obj); });
  }

  function restoreState(snapshot) {
    // Clear current objects
    for (var i = 0; i < state.objects.length; i++) {
      state.transformControls.detach();
      state.scene.remove(state.objects[i]);
      if (state.objects[i].geometry) state.objects[i].geometry.dispose();
      if (state.objects[i].material) state.objects[i].material.dispose();
    }
    state.objects = [];
    state.selectedObject = null;

    // Restore from snapshot
    for (var j = 0; j < snapshot.length; j++) {
      var mesh = ProjectStorage.deserializeMesh(snapshot[j]);
      state.scene.add(mesh);
      state.objects.push(mesh);
    }

    resetTransformPanel();
    document.getElementById('selected-name').textContent = 'オブジェクト未選択';
  }

  function pushUndo() {
    state.undoStack.push(captureState());
    state.redoStack = [];
    if (state.undoStack.length > 30) state.undoStack.shift();
  }

  function undo() {
    if (state.undoStack.length < 2) {
      showToast('これ以上戻れません');
      return;
    }
    state.redoStack.push(state.undoStack.pop());
    var prev = state.undoStack[state.undoStack.length - 1];
    restoreState(prev);
    showToast('元に戻しました');
  }

  function redo() {
    if (state.redoStack.length === 0) {
      showToast('やり直しはありません');
      return;
    }
    var next = state.redoStack.pop();
    state.undoStack.push(next);
    restoreState(next);
    showToast('やり直しました');
  }

  // ---- Camera Views ----
  function setView(type) {
    var target = state.orbitControls.target.clone();
    var dist = 120;

    switch (type) {
      case 'reset':
        state.camera.position.set(80, 60, 80);
        break;
      case 'top':
        state.camera.position.set(target.x, target.y + dist, target.z + 0.01);
        break;
      case 'front':
        state.camera.position.set(target.x, target.y, target.z + dist);
        break;
      case 'right':
        state.camera.position.set(target.x + dist, target.y, target.z + 0.01);
        break;
    }
    state.camera.lookAt(target);
    state.orbitControls.update();
  }

  // ---- Export ----
  function exportSTL() {
    if (state.objects.length === 0) {
      showToast('エクスポートするオブジェクトがありません');
      return;
    }
    var filename = (state.projectName || 'model') + '.stl';
    STLExporter.download(state.objects, filename);
    showToast('STLエクスポート: ' + filename);
  }

  // ---- Auto Save ----
  function scheduleAutoSave() {
    if (state.autoSaveTimer) clearInterval(state.autoSaveTimer);
    state.autoSaveTimer = setInterval(function () {
      autoSave();
    }, 10000); // Save every 10 seconds
  }

  async function autoSave() {
    if (state.objects.length === 0 && !state.projectId) return;
    if (!state.projectId) {
      state.projectId = 'proj_' + Date.now();
    }
    try {
      await ProjectStorage.save(state.projectId, state.projectName, state.objects);
    } catch (e) {
      console.error('Auto-save failed:', e);
    }
  }

  async function loadLastProject() {
    try {
      var projects = await ProjectStorage.list();
      if (projects.length > 0) {
        var last = projects[0];
        await loadProject(last.id);
      }
    } catch (e) {
      console.error('Failed to load last project:', e);
    }
  }

  async function loadProject(id) {
    try {
      var project = await ProjectStorage.get(id);
      if (!project) return;

      // Clear current scene
      for (var i = 0; i < state.objects.length; i++) {
        state.scene.remove(state.objects[i]);
        if (state.objects[i].geometry) state.objects[i].geometry.dispose();
        if (state.objects[i].material) state.objects[i].material.dispose();
      }
      state.objects = [];
      state.selectedObject = null;
      state.transformControls.detach();

      // Restore meshes
      for (var j = 0; j < project.meshes.length; j++) {
        var mesh = ProjectStorage.deserializeMesh(project.meshes[j]);
        state.scene.add(mesh);
        state.objects.push(mesh);
      }

      state.projectId = project.id;
      state.projectName = project.name;
      state.undoStack = [captureState()];
      state.redoStack = [];

      resetTransformPanel();
      document.getElementById('selected-name').textContent = 'オブジェクト未選択';
    } catch (e) {
      console.error('Failed to load project:', e);
    }
  }

  function newProject() {
    for (var i = 0; i < state.objects.length; i++) {
      state.scene.remove(state.objects[i]);
      if (state.objects[i].geometry) state.objects[i].geometry.dispose();
      if (state.objects[i].material) state.objects[i].material.dispose();
    }
    state.objects = [];
    state.selectedObject = null;
    state.transformControls.detach();
    state.projectId = 'proj_' + Date.now();
    state.projectName = 'Untitled';
    state.objectCounter = 0;
    state.undoStack = [];
    state.redoStack = [];
    colorIndex = 0;
    resetTransformPanel();
    document.getElementById('selected-name').textContent = 'オブジェクト未選択';
    showToast('新規プロジェクト作成');
  }

  // ---- Projects Menu ----
  async function showProjectList() {
    var list = document.getElementById('project-list');
    list.innerHTML = '';

    try {
      var projects = await ProjectStorage.list();
      if (projects.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">保存されたプロジェクトはありません</p>';
        return;
      }

      for (var p = 0; p < projects.length; p++) {
        (function (proj) {
          var item = document.createElement('div');
          item.className = 'project-item';

          var info = document.createElement('div');
          var nameEl = document.createElement('div');
          nameEl.className = 'project-name';
          nameEl.textContent = proj.name + ' (' + proj.meshes.length + 'オブジェクト)';
          var dateEl = document.createElement('div');
          dateEl.className = 'project-date';
          dateEl.textContent = new Date(proj.updatedAt).toLocaleString('ja-JP');
          info.appendChild(nameEl);
          info.appendChild(dateEl);

          var deleteBtn = document.createElement('button');
          deleteBtn.className = 'project-delete';
          deleteBtn.textContent = '🗑';
          deleteBtn.addEventListener('click', async function (e) {
            e.stopPropagation();
            await ProjectStorage.delete(proj.id);
            showProjectList();
            showToast('プロジェクトを削除');
          });

          item.appendChild(info);
          item.appendChild(deleteBtn);

          item.addEventListener('click', function () {
            loadProject(proj.id);
            closeSideMenu();
            showToast('プロジェクト読み込み: ' + proj.name);
          });

          list.appendChild(item);
        })(projects[p]);
      }
    } catch (e) {
      console.error('Failed to list projects:', e);
    }
  }

  function openSideMenu() {
    document.getElementById('side-menu').classList.remove('hidden');
    document.getElementById('menu-overlay').classList.remove('hidden');
    showProjectList();
  }

  function closeSideMenu() {
    document.getElementById('side-menu').classList.add('hidden');
    document.getElementById('menu-overlay').classList.add('hidden');
  }

  // ---- Toast ----
  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.add('hidden');
    }, 2000);
  }

  // ---- UI Event Bindings ----
  function initUI() {
    // Header buttons
    document.getElementById('btn-menu').addEventListener('click', openSideMenu);
    document.getElementById('btn-menu-close').addEventListener('click', closeSideMenu);
    document.getElementById('menu-overlay').addEventListener('click', closeSideMenu);
    document.getElementById('btn-export').addEventListener('click', exportSTL);
    document.getElementById('btn-new-project').addEventListener('click', function () {
      newProject();
      closeSideMenu();
    });

    // View buttons
    document.getElementById('btn-view-reset').addEventListener('click', function () { setView('reset'); });
    document.getElementById('btn-view-top').addEventListener('click', function () { setView('top'); });
    document.getElementById('btn-view-front').addEventListener('click', function () { setView('front'); });
    document.getElementById('btn-view-right').addEventListener('click', function () { setView('right'); });

    // Primitive buttons
    document.querySelectorAll('[data-shape]').forEach(function (btn) {
      btn.addEventListener('click', function () { addPrimitive(btn.dataset.shape); });
    });

    // Transform mode buttons
    document.querySelectorAll('[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.transformMode = btn.dataset.mode;
        if (state.selectedObject) {
          state.transformControls.setMode(state.transformMode);
        }
        // Highlight active
        document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
    // Set initial active
    document.getElementById('btn-move').classList.add('active');

    // CSG buttons
    document.getElementById('btn-union').addEventListener('click', function () { performCSG('union'); });
    document.getElementById('btn-subtract').addEventListener('click', function () { performCSG('subtract'); });
    document.getElementById('btn-intersect').addEventListener('click', function () { performCSG('intersect'); });

    // Delete
    document.getElementById('btn-delete').addEventListener('click', deleteSelected);

    // Undo/Redo
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);

    // Position inputs
    ['pos-x', 'pos-y', 'pos-z'].forEach(function (id) {
      var input = document.getElementById(id);
      input.addEventListener('change', applyPositionFromInputs);
    });

    // Step buttons
    document.querySelectorAll('.step-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.selectedObject) return;
        var axis = btn.dataset.axis;
        var delta = parseFloat(btn.dataset.delta);
        var input = document.getElementById('pos-' + axis);
        var current = parseFloat(input.value) || 0;
        input.value = (current + delta).toFixed(1);
        applyPositionFromInputs();
      });
    });

    // Scale slider
    var scaleSlider = document.getElementById('scale-slider');
    scaleSlider.addEventListener('input', function () {
      if (!state.selectedObject) return;
      var v = parseFloat(scaleSlider.value);
      state.selectedObject.scale.set(v, v, v);
      document.getElementById('scale-value').textContent = v.toFixed(1);
    });
    scaleSlider.addEventListener('change', function () { pushUndo(); });

    // Rotation slider
    var rotSlider = document.getElementById('rotation-slider');
    rotSlider.addEventListener('input', function () {
      if (!state.selectedObject) return;
      var deg = parseFloat(rotSlider.value);
      state.selectedObject.rotation.y = THREE.MathUtils.degToRad(deg);
      document.getElementById('rotation-value').textContent = Math.round(deg) + '°';
    });
    rotSlider.addEventListener('change', function () { pushUndo(); });

    // Prevent iOS gestures on app container
    document.body.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.body.addEventListener('gesturechange', function (e) { e.preventDefault(); });

    // Push initial undo state
    state.undoStack.push(captureState());
  }

  // ---- Service Worker ----
  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.warn('SW registration failed:', err);
      });
    }
  }

  // ---- Animation Loop ----
  function animate() {
    requestAnimationFrame(animate);
    state.orbitControls.update();
    state.renderer.render(state.scene, state.camera);
  }

  // ---- Start ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
