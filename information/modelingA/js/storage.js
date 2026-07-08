/* =============================================
   IndexedDB Storage - Project auto-save & management
   ============================================= */

(function () {
  'use strict';

  var DB_NAME = 'ModelingA3DModeler';
  var DB_VERSION = 1;
  var STORE_NAME = 'projects';
  var db = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (db) { resolve(db); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (e) {
        var database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          var store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = function (e) { db = e.target.result; resolve(db); };
      request.onerror = function (e) { reject(e.target.error); };
    });
  }

  function serializeMesh(mesh) {
    var geom = mesh.geometry;
    var posAttr = geom.getAttribute('position');
    var positions = Array.from(posAttr.array);
    var indices = null;
    if (geom.index) {
      indices = Array.from(geom.index.array);
    }

    return {
      name: mesh.name,
      type: mesh.userData.shapeType || 'custom',
      params: mesh.userData.shapeParams || null,
      positions: positions,
      indices: indices,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      color: mesh.material.color ? mesh.material.color.getHex() : 0x58a6ff
    };
  }

  function deserializeMesh(data) {
    var positions = new Float32Array(data.positions);
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (data.indices) {
      geom.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
    }
    geom.computeVertexNormals();

    var mat = new THREE.MeshStandardMaterial({
      color: data.color || 0x58a6ff,
      metalness: 0.1,
      roughness: 0.6,
      flatShading: false
    });

    var mesh = new THREE.Mesh(geom, mat);
    mesh.name = data.name;
    mesh.userData.shapeType = data.type;
    mesh.userData.shapeParams = data.params;
    mesh.position.set(data.position[0], data.position[1], data.position[2]);
    mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
    mesh.scale.set(data.scale[0], data.scale[1], data.scale[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  async function saveProject(id, name, meshes) {
    var database = await openDB();
    var serialized = meshes.map(function (m) { return serializeMesh(m); });
    var now = Date.now();
    var project = {
      id: id,
      name: name,
      meshes: serialized,
      updatedAt: now,
      createdAt: now
    };

    return new Promise(function (resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      // Preserve original createdAt if project exists
      var getReq = store.get(id);
      getReq.onsuccess = function () {
        if (getReq.result && getReq.result.createdAt) {
          project.createdAt = getReq.result.createdAt;
        }
        store.put(project);
      };
      tx.oncomplete = function () { resolve(project); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  async function getProject(id) {
    var database = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readonly');
      var request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function (e) { reject(e.target.error); };
    });
  }

  async function listProjects() {
    var database = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var index = store.index('updatedAt');
      var request = index.getAll();
      request.onsuccess = function () {
        var results = request.result || [];
        results.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        resolve(results);
      };
      request.onerror = function (e) { reject(e.target.error); };
    });
  }

  async function deleteProject(id) {
    var database = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  window.ProjectStorage = {
    save: saveProject,
    get: getProject,
    list: listProjects,
    delete: deleteProject,
    serializeMesh: serializeMesh,
    deserializeMesh: deserializeMesh,
    openDB: openDB
  };
})();
