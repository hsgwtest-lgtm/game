/* =============================================
   STL Exporter - Binary STL format
   ============================================= */

(function () {
  'use strict';

  function exportSTL(meshes) {
    // Merge all meshes and calculate total triangles
    var totalTriangles = 0;
    var meshDataList = [];

    for (var mi = 0; mi < meshes.length; mi++) {
      var mesh = meshes[mi];
      mesh.updateMatrixWorld();
      var geom = mesh.geometry;
      if (geom.index) {
        geom = geom.toNonIndexed();
      }
      if (!geom.getAttribute('normal')) {
        geom.computeVertexNormals();
      }
      var posAttr = geom.getAttribute('position');
      var count = posAttr.count / 3;
      totalTriangles += count;
      meshDataList.push({ geom: geom, matrix: mesh.matrixWorld });
    }

    // Binary STL format:
    // 80 bytes header + 4 bytes triangle count + 50 bytes per triangle
    var bufferSize = 80 + 4 + totalTriangles * 50;
    var buffer = new ArrayBuffer(bufferSize);
    var view = new DataView(buffer);

    // Header (80 bytes) - write app identifier
    var header = 'Mobile 3D Modeler - Binary STL';
    for (var i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }

    // Triangle count
    view.setUint32(80, totalTriangles, true);

    var offset = 84;
    var tempVert = new THREE.Vector3();
    var tempNorm = new THREE.Vector3();
    var normalMatrix = new THREE.Matrix3();

    for (var di = 0; di < meshDataList.length; di++) {
      var dGeom = meshDataList[di].geom;
      var dMatrix = meshDataList[di].matrix;
      var dPosAttr = dGeom.getAttribute('position');
      var dNormAttr = dGeom.getAttribute('normal');
      normalMatrix.getNormalMatrix(dMatrix);

      for (var fi = 0; fi < dPosAttr.count; fi += 3) {
        // Compute face normal from first vertex normal
        tempNorm.set(dNormAttr.getX(fi), dNormAttr.getY(fi), dNormAttr.getZ(fi));
        tempNorm.applyMatrix3(normalMatrix).normalize();

        // Normal vector
        view.setFloat32(offset, tempNorm.x, true); offset += 4;
        view.setFloat32(offset, tempNorm.y, true); offset += 4;
        view.setFloat32(offset, tempNorm.z, true); offset += 4;

        // Three vertices
        for (var j = 0; j < 3; j++) {
          var k = fi + j;
          tempVert.set(dPosAttr.getX(k), dPosAttr.getY(k), dPosAttr.getZ(k));
          tempVert.applyMatrix4(dMatrix);

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
      navigator.share({ files: [file], title: filename }).catch(function () {
        fallbackDownload(blob, filename);
      });
    } else {
      fallbackDownload(blob, filename);
    }
  }

  function fallbackDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  window.STLExporter = {
    export: exportSTL,
    download: downloadSTL
  };
})();
