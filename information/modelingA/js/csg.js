/* =============================================
   CSG (Constructive Solid Geometry) for Three.js
   BSP-tree based boolean operations
   Adapted from Evan Wallace's CSG.js for Three.js r128
   ============================================= */

(function () {
  'use strict';

  // ---------- Vector ----------
  class CSGVector {
    constructor(x, y, z) {
      this.x = x; this.y = y; this.z = z;
    }
    clone() { return new CSGVector(this.x, this.y, this.z); }
    negated() { return new CSGVector(-this.x, -this.y, -this.z); }
    plus(a) { return new CSGVector(this.x + a.x, this.y + a.y, this.z + a.z); }
    minus(a) { return new CSGVector(this.x - a.x, this.y - a.y, this.z - a.z); }
    times(a) { return new CSGVector(this.x * a, this.y * a, this.z * a); }
    dividedBy(a) { return new CSGVector(this.x / a, this.y / a, this.z / a); }
    dot(a) { return this.x * a.x + this.y * a.y + this.z * a.z; }
    cross(a) {
      return new CSGVector(
        this.y * a.z - this.z * a.y,
        this.z * a.x - this.x * a.z,
        this.x * a.y - this.y * a.x
      );
    }
    length() { return Math.sqrt(this.dot(this)); }
    unit() { return this.dividedBy(this.length()); }
    lerp(a, t) { return this.plus(a.minus(this).times(t)); }
  }

  // ---------- Vertex ----------
  class CSGVertex {
    constructor(pos, normal) {
      this.pos = new CSGVector(pos.x, pos.y, pos.z);
      this.normal = new CSGVector(normal.x, normal.y, normal.z);
    }
    clone() { return new CSGVertex(this.pos.clone(), this.normal.clone()); }
    flip() { this.normal = this.normal.negated(); }
    interpolate(other, t) {
      return new CSGVertex(
        this.pos.lerp(other.pos, t),
        this.normal.lerp(other.normal, t)
      );
    }
  }

  // ---------- Plane ----------
  const EPSILON = 1e-5;
  const COPLANAR = 0;
  const FRONT = 1;
  const BACK = 2;
  const SPANNING = 3;

  class CSGPlane {
    constructor(normal, w) {
      this.normal = normal;
      this.w = w;
    }
    clone() { return new CSGPlane(this.normal.clone(), this.w); }
    flip() {
      this.normal = this.normal.negated();
      this.w = -this.w;
    }

    static fromPoints(a, b, c) {
      const n = b.minus(a).cross(c.minus(a)).unit();
      return new CSGPlane(n, n.dot(a));
    }

    splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
      let polygonType = 0;
      const types = [];
      for (let i = 0; i < polygon.vertices.length; i++) {
        const t = this.normal.dot(polygon.vertices[i].pos) - this.w;
        const type = (t < -EPSILON) ? BACK : (t > EPSILON) ? FRONT : COPLANAR;
        polygonType |= type;
        types.push(type);
      }

      switch (polygonType) {
        case COPLANAR:
          (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
          break;
        case FRONT:
          front.push(polygon);
          break;
        case BACK:
          back.push(polygon);
          break;
        case SPANNING: {
          const f = [], b = [];
          for (let i = 0; i < polygon.vertices.length; i++) {
            const j = (i + 1) % polygon.vertices.length;
            const ti = types[i], tj = types[j];
            const vi = polygon.vertices[i], vj = polygon.vertices[j];
            if (ti !== BACK) f.push(vi);
            if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
            if ((ti | tj) === SPANNING) {
              const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(vj.pos.minus(vi.pos));
              const v = vi.interpolate(vj, t);
              f.push(v);
              b.push(v.clone());
            }
          }
          if (f.length >= 3) front.push(new CSGPolygon(f, polygon.shared));
          if (b.length >= 3) back.push(new CSGPolygon(b, polygon.shared));
          break;
        }
      }
    }
  }

  // ---------- Polygon ----------
  class CSGPolygon {
    constructor(vertices, shared) {
      this.vertices = vertices;
      this.shared = shared;
      this.plane = CSGPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
    }
    clone() {
      return new CSGPolygon(
        this.vertices.map(v => v.clone()),
        this.shared
      );
    }
    flip() {
      this.vertices.reverse().forEach(v => v.flip());
      this.plane.flip();
    }
  }

  // ---------- BSP Node ----------
  class CSGNode {
    constructor(polygons) {
      this.plane = null;
      this.front = null;
      this.back = null;
      this.polygons = [];
      if (polygons) this.build(polygons);
    }

    clone() {
      const node = new CSGNode();
      node.plane = this.plane && this.plane.clone();
      node.front = this.front && this.front.clone();
      node.back = this.back && this.back.clone();
      node.polygons = this.polygons.map(p => p.clone());
      return node;
    }

    invert() {
      for (let i = 0; i < this.polygons.length; i++) this.polygons[i].flip();
      if (this.plane) this.plane.flip();
      if (this.front) this.front.invert();
      if (this.back) this.back.invert();
      const temp = this.front;
      this.front = this.back;
      this.back = temp;
    }

    clipPolygons(polygons) {
      if (!this.plane) return polygons.slice();
      let front = [], back = [];
      for (let i = 0; i < polygons.length; i++) {
        this.plane.splitPolygon(polygons[i], front, back, front, back);
      }
      if (this.front) front = this.front.clipPolygons(front);
      if (this.back) back = this.back.clipPolygons(back);
      else back = [];
      return front.concat(back);
    }

    clipTo(bsp) {
      this.polygons = bsp.clipPolygons(this.polygons);
      if (this.front) this.front.clipTo(bsp);
      if (this.back) this.back.clipTo(bsp);
    }

    allPolygons() {
      let polygons = this.polygons.slice();
      if (this.front) polygons = polygons.concat(this.front.allPolygons());
      if (this.back) polygons = polygons.concat(this.back.allPolygons());
      return polygons;
    }

    build(polygons) {
      if (!polygons.length) return;
      if (!this.plane) this.plane = polygons[0].plane.clone();
      const front = [], back = [];
      for (let i = 0; i < polygons.length; i++) {
        this.plane.splitPolygon(polygons[i], this.polygons, this.polygons, front, back);
      }
      if (front.length) {
        if (!this.front) this.front = new CSGNode();
        this.front.build(front);
      }
      if (back.length) {
        if (!this.back) this.back = new CSGNode();
        this.back.build(back);
      }
    }
  }

  // ---------- CSG Solid ----------
  class CSG {
    constructor() { this.polygons = []; }

    clone() {
      const csg = new CSG();
      csg.polygons = this.polygons.map(p => p.clone());
      return csg;
    }

    toPolygons() { return this.polygons; }

    union(csg) {
      const a = new CSGNode(this.clone().polygons);
      const b = new CSGNode(csg.clone().polygons);
      a.clipTo(b);
      b.clipTo(a);
      b.invert();
      b.clipTo(a);
      b.invert();
      a.build(b.allPolygons());
      return CSG.fromPolygons(a.allPolygons());
    }

    subtract(csg) {
      const a = new CSGNode(this.clone().polygons);
      const b = new CSGNode(csg.clone().polygons);
      a.invert();
      a.clipTo(b);
      b.clipTo(a);
      b.invert();
      b.clipTo(a);
      b.invert();
      a.build(b.allPolygons());
      a.invert();
      return CSG.fromPolygons(a.allPolygons());
    }

    intersect(csg) {
      const a = new CSGNode(this.clone().polygons);
      const b = new CSGNode(csg.clone().polygons);
      a.invert();
      b.clipTo(a);
      b.invert();
      a.clipTo(b);
      b.clipTo(a);
      a.build(b.allPolygons());
      a.invert();
      return CSG.fromPolygons(a.allPolygons());
    }

    static fromPolygons(polygons) {
      const csg = new CSG();
      csg.polygons = polygons;
      return csg;
    }

    static fromGeometry(geom, matrix) {
      const polys = [];
      const posAttr = geom.getAttribute('position');
      const normAttr = geom.getAttribute('normal');
      const idx = geom.index;

      const tempVert = new THREE.Vector3();
      const tempNorm = new THREE.Vector3();

      if (idx) {
        for (let i = 0; i < idx.count; i += 3) {
          const verts = [];
          for (let j = 0; j < 3; j++) {
            const k = idx.getX(i + j);
            tempVert.set(posAttr.getX(k), posAttr.getY(k), posAttr.getZ(k));
            tempNorm.set(normAttr.getX(k), normAttr.getY(k), normAttr.getZ(k));
            if (matrix) {
              tempVert.applyMatrix4(matrix);
              tempNorm.applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();
            }
            verts.push(new CSGVertex(
              { x: tempVert.x, y: tempVert.y, z: tempVert.z },
              { x: tempNorm.x, y: tempNorm.y, z: tempNorm.z }
            ));
          }
          polys.push(new CSGPolygon(verts, null));
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          const verts = [];
          for (let j = 0; j < 3; j++) {
            const k = i + j;
            tempVert.set(posAttr.getX(k), posAttr.getY(k), posAttr.getZ(k));
            tempNorm.set(normAttr.getX(k), normAttr.getY(k), normAttr.getZ(k));
            if (matrix) {
              tempVert.applyMatrix4(matrix);
              tempNorm.applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();
            }
            verts.push(new CSGVertex(
              { x: tempVert.x, y: tempVert.y, z: tempVert.z },
              { x: tempNorm.x, y: tempNorm.y, z: tempNorm.z }
            ));
          }
          polys.push(new CSGPolygon(verts, null));
        }
      }
      return CSG.fromPolygons(polys);
    }

    toGeometry() {
      const positions = [];
      const normals = [];

      for (const polygon of this.polygons) {
        // Triangulate polygon (fan triangulation)
        for (let i = 2; i < polygon.vertices.length; i++) {
          const verts = [polygon.vertices[0], polygon.vertices[i - 1], polygon.vertices[i]];
          for (const v of verts) {
            positions.push(v.pos.x, v.pos.y, v.pos.z);
            normals.push(v.normal.x, v.normal.y, v.normal.z);
          }
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      return geom;
    }
  }

  // ---------- Three.js mesh helpers ----------
  function meshToCSG(mesh) {
    const geom = mesh.geometry;
    if (!geom.getAttribute('normal')) geom.computeVertexNormals();
    mesh.updateMatrixWorld();
    return CSG.fromGeometry(geom, mesh.matrixWorld);
  }

  function csgToMesh(csg, material) {
    const geom = csg.toGeometry();
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, material);
  }

  // Public API
  window.CSGEngine = {
    union: function (meshA, meshB, material) {
      const a = meshToCSG(meshA);
      const b = meshToCSG(meshB);
      return csgToMesh(a.union(b), material);
    },
    subtract: function (meshA, meshB, material) {
      const a = meshToCSG(meshA);
      const b = meshToCSG(meshB);
      return csgToMesh(a.subtract(b), material);
    },
    intersect: function (meshA, meshB, material) {
      const a = meshToCSG(meshA);
      const b = meshToCSG(meshB);
      return csgToMesh(a.intersect(b), material);
    }
  };
})();
