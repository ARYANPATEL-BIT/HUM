import { CONFIG } from '../config.js';

// Circle (player, XZ plane) vs axis-aligned wall boxes. Boxes come from a provider with
// query(x, z, r, out) -> [{ minX, minZ, maxX, maxZ }] (the chunk manager).
export class CollisionWorld {
  constructor(provider) {
    this.provider = provider;
    this.near = [];
  }

  // Push a circle at pos (x,z) out of all overlapping boxes. Mutates pos.
  resolve(pos, r) {
    const near = this.provider.query(pos.x, pos.z, r, this.near);
    for (let iter = 0; iter < CONFIG.collision.iterations; iter++) {
      let moved = false;
      for (const b of near) {
        // Closest point on the box to the circle centre; if it's within r we overlap.
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;

        if (d2 > 1e-10) {
          // Push straight away from the closest point. Only the normal component is removed,
          // so the tangential part of the motion survives => sliding along walls.
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        } else {
          // Centre is inside the box: exit via the side with the least penetration.
          const left = pos.x - b.minX + r;
          const right = b.maxX - pos.x + r;
          const top = pos.z - b.minZ + r;
          const bottom = b.maxZ - pos.z + r;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x -= left;
          else if (m === right) pos.x += right;
          else if (m === top) pos.z -= top;
          else pos.z += bottom;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  // Move a circle by (dx, dz) in small substeps so fast movement can't tunnel through thin walls.
  move(pos, dx, dz, r) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / CONFIG.collision.maxSubstep));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      pos.x += sx;
      pos.z += sz;
      this.resolve(pos, r);
    }
  }
}
