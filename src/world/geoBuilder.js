import * as THREE from 'three';

// Accumulates quads into flat arrays, then emits one BufferGeometry (one draw call).
export class GeoBuilder {
  constructor(withColor = false) {
    this.pos = [];
    this.norm = [];
    this.uv = [];
    this.col = withColor ? [] : null;
    this.index = [];
  }

  get empty() {
    return this.index.length === 0;
  }

  vertex(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z);
    this.norm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.col) this.col.push(c ? c[0] : 1, c ? c[1] : 1, c ? c[2] : 1);
  }

  quadIndices() {
    const b = this.pos.length / 3 - 4;
    this.index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  // Vertical quad from (sx, sz) along (ax, az), y0..y1. Its normal is a x up = (-az, 0, ax),
  // so to face direction N pick a = (Nz, -Nx) * length.
  vquad(sx, sz, ax, az, y0, y1, u0, u1, v0, v1, c) {
    const len = Math.hypot(ax, az);
    const nx = -az / len;
    const nz = ax / len;
    this.vertex(sx, y0, sz, nx, 0, nz, u0, v0, c);
    this.vertex(sx + ax, y0, sz + az, nx, 0, nz, u1, v0, c);
    this.vertex(sx + ax, y1, sz + az, nx, 0, nz, u1, v1, c);
    this.vertex(sx, y1, sz, nx, 0, nz, u0, v1, c);
    this.quadIndices();
  }

  // Horizontal quad at height y. UVs are world-space (x, z) / texMeters so tiling is continuous.
  // c is a colour [r,g,b] or a function (x, z) -> colour for per-vertex tints.
  hquad(x0, z0, x1, z1, y, up, texMeters, c) {
    const ny = up ? 1 : -1;
    const u = (x) => x / texMeters;
    const v = (z) => -z / texMeters;
    const pts = up
      ? [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]
      : [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (const [x, z] of pts) this.vertex(x, y, z, 0, ny, 0, u(x), v(z), typeof c === 'function' ? c(x, z) : c);
    this.quadIndices();
  }

  // Four side faces of an axis-aligned box (no top/bottom: ceilings and floors hide them).
  // Wall-style UVs: u runs along the face in world meters / texW, v = y / texH.
  // mirror flips v so reflected copies under water read upside down.
  boxSides(x0, z0, x1, z1, y0, y1, texW, texH, uOffset = 0, mirror = false, c) {
    const v = (y) => (mirror ? -y : y) / texH;
    const face = (sx, sz, ax, az, along) => {
      const u0 = (along + uOffset) / texW;
      const u1 = u0 + Math.hypot(ax, az) / texW;
      this.vquad(sx, sz, ax, az, y0, y1, u0, u1, v(y0), v(y1), c);
    };
    face(x0, z1, x1 - x0, 0, x0); // +Z
    face(x1, z0, x0 - x1, 0, -x1); // -Z
    face(x1, z1, 0, z0 - z1, -z1); // +X
    face(x0, z0, 0, z1 - z0, z0); // -X
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}
