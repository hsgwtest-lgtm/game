/* =============================================
   STL Exporter - Binary STL format
   ============================================= */

(function () {
  'use strict';

  function exportSTL(meshes) {
    // Merge all meshes and calculate total triangles
    let totalTriangles = 0;
    const meshDataList = [];

    for (const mesh of meshes) {
      mesh.updateMatrixWorld();
      let geom = mesh.geometry;
      if (geom.index) {
        geom = geom.toNonIndexed();
      }
      if (!geom.getAttribute('normal')) {
        geom.computeVertexNormals();
      }
      const posAttr = geom.getAttribute('position');
      const count = posAttr.count / 3;
      totalTriangles += count;
      meshDataList.push({ geom, matrix: mesh.matrixWorld });
    }

    // Binary STL format:
    // 80 bytes header + 4 bytes triangle count + 50 bytes per triangle
    const bufferSize = 80 + 4 + totalTriangles * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header (80 bytes) - write app identifier
    const header = 'Mobile 3D Modeler - Binary STL';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }

    // Triangle count
    view.setUint32(80, totalTriangles, true);

    let offset = 84;
    const tempVert = new THREE.Vector3();
    const tempNorm = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();

    for (const { geom, matrix } of meshDataList) {
      const posAttr = geom.getAttribute('position');
      const normAttr = geom.getAttribute('normal');
      normalMatrix.getNormalMatrix(matrix);

      for (let i = 0; i < posAttr.count; i += 3) {
        // Compute face normal from first vertex normal
        tempNorm.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
        tempNorm.applyMatrix3(normalMatrix).normalize();

        // Normal vector
        view.setFloat32(offset, tempNorm.x, true); offset += 4;
        view.setFloat32(offset, tempNorm.y, true); offset += 4;
        view.setFloat32(offset, tempNorm.z, true); offset += 4;

        // Three vertices
        for (let j = 0; j < 3; j++) {
          const k = i + j;
          tempVert.set(posAttr.getX(k), posAttr.getY(k), posAttr.getZ(k));
          tempVert.applyMatrix4(matrix);

          view.setFloat32(offset, tempVert.x, true); offset += 4;
          view.setFloat32(offset, tempVert.y, true); offset += 4;
          view.setFloat32(offset, tempVert.z, true); offset += 4;
        }

        // Attribute byte count (unused)
        view.setUint16(offset, 0, true); offset += 2;
      }
    }

    return new Blob([buffer], { type: 'application/octet-stream' });
  }

  function downloadSTL(meshes, filename) {
    filename = filename || 'model.stl';
    const blob = exportSTL(meshes);

    // iOS Safari: use share API if available, otherwise download link
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
      const file = new File([blob], filename, { type: 'application/octet-stream' });
      navigator.share({ files: [file], title: filename }).catch(() => {
        fallbackDownload(blob, filename);
      });
    } else {
      fallbackDownload(blob, filename);
    }
  }

  function fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.STLExporter = {
    export: exportSTL,
    download: downloadSTL
  };
})();
