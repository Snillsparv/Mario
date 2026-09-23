// Props + sky preview: /preview.html?m=props[&cam=x,y,z&look=x,y,z]
// Builds the terrain (or a flat stand-in if terrain.js fails to load/build), the props and
// the sky, with fog matched to the sky's horizon colour.
//   &t=secs  freeze the animation (waterfall, splash, sky drift) at a given time
//   &col=1   overlay the props' collider triangles (walls blue, floors green) and poles
//   &sky=0   hide the sky (plain background)
import * as layout from '../../world/layout.js';
import { buildProps } from '../../world/props.js';
import { buildSky, SKY_HORIZON_COLOR } from '../../world/sky.js';

export async function setup({ THREE, scene, camera, params }) {
  scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, 8000, 30000);
  scene.add(await ground(THREE));

  const props = buildProps(layout);
  scene.add(props.object3D);
  const sky = buildSky(layout);
  if (params.get('sky') !== '0') scene.add(sky.object3D);
  if (params.get('col')) scene.add(colliderOverlay(THREE, props));

  const frozen = params.get('t');
  const spawnY = layout.groundHeight(layout.SPAWN.x, layout.SPAWN.z);
  return {
    camera: { pos: [0, spawnY + 320, layout.SPAWN.z + 500], look: [0, spawnY + 200, 0] },
    update(dt, t) {
      const time = frozen !== null ? Number(frozen) : t;
      props.update(time, camera);
      sky.update(time, camera);
    },
  };
}

// The real terrain when it builds; otherwise a coarse heightfield from layout.groundHeight.
async function ground(THREE) {
  try {
    const { buildTerrain } = await import('../../world/terrain.js');
    return buildTerrain(layout).object3D;
  } catch (e) {
    console.warn('props preview: terrain unavailable, using a stand-in ground', e);
  }
  const geo = new THREE.PlaneGeometry(16000, 16000, 160, 160).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, layout.groundHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x5aa83c }));
}

function colliderOverlay(THREE, part) {
  const pos = [];
  const col = [];
  for (const c of part.colliders) {
    const p = c.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i];
      const uy = p[i + 4] - p[i + 1];
      const uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i];
      const vy = p[i + 7] - p[i + 1];
      const vz = p[i + 8] - p[i + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const ny = n[1] / (Math.hypot(...n) || 1);
      const rgb = ny > 0.1 ? [0.2, 0.9, 0.3] : ny < -0.1 ? [0.9, 0.2, 0.2] : [0.2, 0.4, 1];
      for (let k = 0; k < 9; k++) pos.push(p[i + k]);
      col.push(...rgb, ...rgb, ...rgb);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })),
  );
  for (const p of part.poles) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(p.radius, p.radius, p.y1 - p.y0, 8),
      new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }),
    );
    pole.position.set(p.x, (p.y0 + p.y1) / 2, p.z);
    group.add(pole);
  }
  return group;
}
