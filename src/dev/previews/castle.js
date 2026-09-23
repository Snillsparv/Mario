// Castle + drawbridge preview: /preview.html?m=castle
// Adds a coarse stand-in ground (from layout.groundHeight) and water so the castle can be
// judged in context without depending on the terrain module.
//   &col=1  overlay collider triangles (front faces only: floors green, walls blue,
//           ceilings red) to check winding - a wrongly wound face disappears from outside.
//   &t=secs freeze the flag animation at a given time.
import * as layout from '../../world/layout.js';
import { buildCastle } from '../../world/castle.js';
import { worldMaterial, bakeLighting } from '../../render/materials.js';

export async function setup({ THREE, scene, params }) {
  scene.background = new THREE.Color(0x86b8f4);
  scene.fog = new THREE.Fog(0xa0c8ff, 9000, 30000);
  scene.add(standInGround(THREE));

  const castle = buildCastle(layout);
  scene.add(castle.object3D);
  if (params.get('col')) scene.add(colliderOverlay(THREE, castle.colliders));

  const frozen = params.get('t');
  return {
    camera: { pos: [0, 300, 6400], look: [0, 900, -1500] },
    update(dt, t) {
      castle.update(frozen !== null ? Number(frozen) : t);
    },
  };
}

function standInGround(THREE) {
  const group = new THREE.Group();
  const size = 16000;
  const seg = 160;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const tint = {
    lawn: new THREE.Color(0x58a83c),
    island: new THREE.Color(0x6ab048),
    water: new THREE.Color(0x6c6452),
    cliff: new THREE.Color(0x8a7a5c),
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, layout.groundHeight(x, z));
    const c = tint[layout.regionAt(x, z)];
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  bakeLighting(geo);
  group.add(new THREE.Mesh(geo, worldMaterial()));
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2f7fc0, transparent: true, opacity: 0.7 }),
  );
  water.position.y = layout.WATER_LEVEL;
  group.add(water);
  return group;
}

function colliderOverlay(THREE, colliders) {
  const pos = [];
  const col = [];
  for (const c of colliders) {
    const p = c.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i];
      const uy = p[i + 4] - p[i + 1];
      const uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i];
      const vy = p[i + 7] - p[i + 1];
      const vz = p[i + 8] - p[i + 2];
      const ny = (uz * vx - ux * vz) / Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const rgb = ny > 0.1 ? [0.2, 0.9, 0.3] : ny < -0.1 ? [0.9, 0.2, 0.2] : [0.2, 0.4, 1];
      for (let k = 0; k < 9; k++) pos.push(p[i + k]);
      col.push(...rgb, ...rgb, ...rgb);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000 }));
  const g = new THREE.Group();
  g.add(mesh, wire);
  return g;
}
