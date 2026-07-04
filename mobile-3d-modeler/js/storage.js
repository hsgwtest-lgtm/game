/* =============================================
   IndexedDB Storage - Project auto-save & management
   ============================================= */

(function () {
  'use strict';

  const DB_NAME = 'Mobile3DModeler';
  const DB_VERSION = 1;
  const STORE_NAME = 'projects';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = (e) => { db = e.target.result; resolve(db); };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  function serializeMesh(mesh) {
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute('position');
    const positions = Array.from(posAttr.array);
    let indices = null;
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

  function deserializeMesh(data, material) {
    let geom;
    const positions = new Float32Array(data.positions);
    geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (data.indices) {
      geom.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
    }
    geom.computeVertexNormals();

    const mat = material || new THREE.MeshStandardMaterial({
      color: data.color || 0x58a6ff,
      metalness: 0.1,
      roughness: 0.6,
      flatShading: false
    });

    const mesh = new THREE.Mesh(geom, mat);
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
    const database = await openDB();
    const serialized = meshes.map(m => serializeMesh(m));
    const now = Date.now();
    const project = {
      id: id,
      name: name,
      meshes: serialized,
      updatedAt: now,
      createdAt: now
    };

    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      // Preserve original createdAt if project exists
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result && getReq.result.createdAt) {
          project.createdAt = getReq.result.createdAt;
        }
        store.put(project);
      };
      tx.oncomplete = () => resolve(project);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getProject(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function listProjects() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('updatedAt');
      const request = index.getAll();
      request.onsuccess = () => {
        const results = request.result || [];
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteProject(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
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
