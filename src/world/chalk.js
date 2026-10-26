import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Chalk marks (Q): an X on the wall the player is looking at, or an arrow on the floor pointing the
// way they face. Two InstancedMeshes (2 draw calls for any number of marks); each is a ring buffer of
// CONFIG.chalk.maxMarks, so the oldest mark is reused. Marks live in scene space and are shifted on
// floating-origin rebases; the world is deterministic, so they still line up after chunks reload.

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _obj = new THREE.Object3D();
_obj.rotation.order = 'YXZ';
const _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

// Rough chalk strokes on a transparent canvas: many thin, jittered, semi-transparent lines.
function chalkTexture(draw) {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  const stroke = (x0, y0, x1, y1) => {
    for (let i = 0; i < 9; i++) {
      const j = () => (Math.random() - 0.5) * 6;
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.45})`;
      ctx.lineWidth = 1.5 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(x0 + j(), y0 + j());
      ctx.lineTo(x1 + j(), y1 + j());
      ctx.stroke();
    }
  };
  draw(stroke, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function markMesh(texture, max) {
  const mat = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.chalk,
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const S = CONFIG.chalk.size;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(S, S), mat, max);
  mesh.count = 0;
  mesh.frustumCulled = false; // instances spread over the whole loaded area
  return mesh;
}

export class Chalk {
  constructor(scene, chunks, assets) {
    this.chunks = chunks;
    this.wallMat = assets.materials.wall;
    this.floorMat = assets.materials.floor;
    const max = CONFIG.chalk.maxMarks;
    this.wall = markMesh(chalkTexture((s, S) => { s(24, 24, S - 24, S - 24); s(S - 24, 24, 24, S - 24); }), max);
    // Arrow pointing up the texture (+v), which becomes "forward" on the floor.
    this.floor = markMesh(chalkTexture((s, S) => { s(S / 2, S - 14, S / 2, 16); s(S / 2, 14, S / 2 - 30, 46); s(S / 2, 14, S / 2 + 30, 46); }), max);
    scene.add(this.wall, this.floor);
    this.next = { wall: 0, floor: 0 };
    this.placed = 0;
    this.cooldown = 0;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  targets() {
    const out = [];
    for (const c of this.chunks.chunks.values()) {
      for (const m of c.group.children) if (m.material === this.wallMat || m.material === this.floorMat) out.push(m);
    }
    return out;
  }

  // Returns true if a mark was drawn.
  place(camera, yaw) {
    if (this.cooldown > 0) return false;
    const C = CONFIG.chalk;
    const targets = this.targets();
    camera.getWorldDirection(_dir);
    _ray.set(camera.position, _dir);
    _ray.far = C.reach;
    const hit = _ray.intersectObjects(targets, false)[0];
    if (hit && hit.object.material === this.wallMat) {
      const n = hit.face.normal; // chunk groups only translate, so the local normal is the world normal
      _obj.position.copy(hit.point).addScaledVector(n, 0.01);
      _obj.rotation.set(0, Math.atan2(n.x, n.z), (Math.random() - 0.5) * 0.6);
      this.add('wall');
      return true;
    }
    // Floor: where the view ray hits it, else straight down from a point just ahead of the player.
    let floorHit = hit && hit.object.material === this.floorMat && hit.face.normal.y > 0.5 ? hit : null;
    if (!floorHit) {
      _origin.set(camera.position.x - Math.sin(yaw) * 0.9, camera.position.y, camera.position.z - Math.cos(yaw) * 0.9);
      if (!this.chunks.hasLineOfSight(camera.position.x, camera.position.z, _origin.x, _origin.z)) return false;
      _ray.set(_origin, DOWN);
      _ray.far = C.reach;
      floorHit = _ray.intersectObjects(targets, false).find((h) => h.face.normal.y > 0.5) ?? null;
    }
    if (!floorHit) return false;
    _obj.position.copy(floorHit.point).y += 0.01;
    _obj.rotation.set(-Math.PI / 2, yaw, 0);
    this.add('floor');
    return true;
  }

  add(kind) {
    const mesh = this[kind];
    _obj.updateMatrix();
    const i = this.next[kind];
    mesh.setMatrixAt(i, _obj.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    this.next[kind] = (i + 1) % CONFIG.chalk.maxMarks;
    mesh.count = Math.max(mesh.count, i + 1);
    this.placed++;
    this.cooldown = CONFIG.chalk.cooldown;
  }

  // Scene x, z of every mark still in the world, flat [x0, z0, x1, z1, …] (for the recap map).
  positions() {
    const out = [];
    for (const mesh of [this.wall, this.floor]) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, _m);
        out.push(_m.elements[12], _m.elements[14]);
      }
    }
    return out;
  }

  rebase(dx, dz) {
    for (const mesh of [this.wall, this.floor]) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, _m);
        _m.elements[12] -= dx;
        _m.elements[14] -= dz;
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
