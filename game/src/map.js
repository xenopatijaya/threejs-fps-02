// Monsoon Lane: a rainy night-market lane in a port town. Two bombsites — the
// Shrine (west) and the Docks (east) — joined by A-long, B-long and a covered
// market hall through mid. Nothing here copies a commercial map: the stalls,
// the shrine, the containers and the neon signs are this game's own.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const BOUNDS = { x0: -22, x1: 22, z0: -15, z1: 15 };

export const SITES = {
  A: { name: 'Shrine', x: -16.5, z: -8, r: 3.4 },
  B: { name: 'Docks', x: 16.5, z: -8, r: 3.4 },
};

export const SPAWNS = {
  lanterns: [
    { x: -4, z: 12.5 }, { x: -2, z: 13 }, { x: 0, z: 12.5 },
    { x: 2, z: 13 }, { x: 4, z: 12.5 },
  ],
  harbour: [
    { x: -4, z: -12.5 }, { x: -2, z: -13 }, { x: 0, z: -12.5 },
    { x: 2, z: -13 }, { x: 4, z: -12.5 },
  ],
};

// Waypoint graph the bots route on. Nodes are open ground; edges are walkable.
const WAYPOINTS = {
  spawnL: { x: 0, z: 12.5, to: ['midSouth', 'aLong1', 'bLong1'] },
  spawnH: { x: 0, z: -12.5, to: ['midNorth', 'aHold1', 'bHold1'] },
  midSouth: { x: 0, z: 8, to: ['spawnL', 'mid', 'aLong1', 'bLong1'] },
  mid: { x: 0, z: 0, to: ['midSouth', 'midNorth', 'aMid', 'bMid'] },
  midNorth: { x: 0, z: -6, to: ['mid', 'spawnH', 'aMid', 'bMid', 'midHold', 'midHold2'] },
  aLong1: { x: -19, z: 8, to: ['spawnL', 'midSouth', 'aLong2'] },
  aLong2: { x: -19, z: 0, to: ['aLong1', 'aLong3', 'aMid'] },
  aLong3: { x: -19, z: -6, to: ['aLong2', 'siteA', 'aHold2'] },
  // Waypoints must sit on open ground: siteA used to be the shrine altar's
  // own spot, bMid inside a stall, aHold1/aHold2/bHold2 inside containers —
  // bots routed there pressed against the box forever and never arrived.
  siteA: { x: -16.5, z: -5.6, to: ['aLong3', 'aHold1', 'aMid'] },
  bLong1: { x: 19, z: 8, to: ['spawnL', 'midSouth', 'bLong2'] },
  bLong2: { x: 19, z: 0, to: ['bLong1', 'bLong3', 'bMid'] },
  bLong3: { x: 19, z: -6, to: ['bLong2', 'siteB', 'bHold2'] },
  siteB: { x: 16.5, z: -8, to: ['bLong3', 'bHold1', 'bMid'] },
  aMid: { x: -10, z: -4, to: ['mid', 'midNorth', 'aLong2', 'siteA'] },
  bMid: { x: 10, z: -2.2, to: ['mid', 'midNorth', 'bLong2', 'siteB'] },
  aHold1: { x: -12, z: -10.5, to: ['siteA', 'spawnH', 'midNorth'] },
  aHold2: { x: -16, z: -11.5, to: ['aLong3', 'siteA'] },
  bHold1: { x: 13, z: -11.5, to: ['siteB', 'spawnH', 'midNorth'] },
  bHold2: { x: 15.5, z: -9.5, to: ['bLong3', 'siteB'] },
  midHold: { x: -3, z: -9.5, to: ['midNorth', 'aHold1'] },
  midHold2: { x: 3, z: -9.5, to: ['midNorth', 'bHold1'] },
};

// Breadth-first shortest path over the waypoint graph.
export function findPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of WAYPOINTS[id]?.to ?? []) {
      if (!(next in prev)) {
        prev[next] = id;
        if (next === toId) {
          const path = [toId];
          let cur = toId;
          while (prev[cur] !== null) { cur = prev[cur]; path.unshift(cur); }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [toId];
}

export function nearestWaypoint(x, z) {
  let best = 'mid';
  let bestD = Infinity;
  for (const [id, w] of Object.entries(WAYPOINTS)) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// 3D segment vs AABB (slab method). Used for line of sight.
export function segmentHitsBox(ax, ay, az, bx, by, bz, box) {
  let tmin = 0;
  let tmax = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax, ay, az];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return false;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Line of sight between two eye positions, blocked by any solid box.
export function hasLOS(ax, ay, az, bx, by, bz, colliders) {
  for (const box of colliders) {
    if (segmentHitsBox(ax, ay, az, bx, by, bz, box)) return false;
  }
  return true;
}

// Circle (actor) vs 2D AABB resolve, per axis, so actors slide along walls.
export function resolveMove(pos, radius, moveBoxes) {
  for (const b of moveBoxes) {
    // A box blocks only where it crosses the actor's body span (feet to
    // head). The market roof, the stall awnings and the shrine roof all sit
    // above head height: treating them as ground walls made mid and site A
    // unusable — actors were shoved out of the footprint sideways, and the
    // site A bomb could never be reached to defuse it.
    if (pos.y + 1.7 <= b.y0) continue;
    if (pos.y >= b.y0 + b.h) continue;
    if (pos.x + radius > b.x0 && pos.x - radius < b.x1 && pos.z + radius > b.z0 && pos.z - radius < b.z1) {
      const dxl = pos.x + radius - b.x0;
      const dxr = b.x1 - (pos.x - radius);
      const dzl = pos.z + radius - b.z0;
      const dzr = b.z1 - (pos.z - radius);
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) pos.x = b.x0 - radius;
      else if (m === dxr) pos.x = b.x1 + radius;
      else if (m === dzl) pos.z = b.z0 - radius;
      else pos.z = b.z1 + radius;
    }
  }
  pos.x = Math.max(BOUNDS.x0 + 0.5, Math.min(BOUNDS.x1 - 0.5, pos.x));
  pos.z = Math.max(BOUNDS.z0 + 0.5, Math.min(BOUNDS.z1 - 0.5, pos.z));
}

function signTexture(lines, bg, fg, accent) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = accent;
  g.lineWidth = 10;
  g.strokeRect(14, 14, 484, 228);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.font = 'bold 92px system-ui, sans-serif';
  g.fillText(lines[0], 256, 118);
  if (lines[1]) {
    g.font = 'bold 44px system-ui, sans-serif';
    g.fillStyle = accent;
    g.fillText(lines[1], 256, 196);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = {};
  for (const [name, hex] of Object.entries(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      roughness: name === 'groundWet' ? 0.25 : name === 'lantern' ? 0.4 : 0.9,
      metalness: name === 'groundWet' ? 0.55 : 0.04,
    });
  }
  const colliders = [];
  const moveBoxes = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const b3 = new THREE.Box3().setFromObject(mesh);
    if (solid) {
      colliders.push(b3);
      // y0 is the box's underside: overhead boxes (roofs, awnings) must not
      // act as ground-level walls — resolveMove tests actors against it.
      moveBoxes.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h, y0: y - h / 2 });
    }
    shootables.push(mesh);
    return mesh;
  }

  // Ground: wet cobbles with a glossier strip down mid.
  box(44.4, 0.4, 30.4, 0, -0.2, 0, 'ground', false);
  box(6, 0.42, 30.4, 0, -0.19, 0, 'groundWet', false);
  // Outer walls.
  box(0.5, 4.6, 30.4, -22.2, 2.3, 0, 'plaster');
  box(0.5, 4.6, 30.4, 22.2, 2.3, 0, 'plaster');
  box(44.4, 4.6, 0.5, 0, 2.3, -15.2, 'plasterDark');
  box(44.4, 4.6, 0.5, 0, 2.3, 15.2, 'plaster');
  // Market hall roof over mid, held by pillars.
  box(16, 0.3, 12, 0, 4.4, 0, 'woodDark');
  for (const [px, pz] of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) {
    box(0.7, 4.4, 0.7, px, 2.2, pz, 'woodDark');
  }
  // Stalls: counters with striped awnings.
  const stallSpots = [
    [-4, -2, 'awningTeal'], [4, 2, 'awningRed'], [-4, 3, 'awningRed'],
    [4, -2.5, 'awningTeal'], [-11, 4, 'awningTeal'], [11, -4.5, 'awningRed'],
  ];
  for (const [sx, sz, awn] of stallSpots) {
    box(2.6, 1.1, 1.4, sx, 0.55, sz, 'wood');
    box(2.9, 0.12, 1.8, sx, 1.9, sz, awn);
    box(0.12, 0.8, 0.12, sx - 1.3, 1.45, sz - 0.8, 'woodDark');
    box(0.12, 0.8, 0.12, sx + 1.3, 1.45, sz - 0.8, 'woodDark');
  }
  // Crates: crouch cover scattered on the lanes.
  const crates = [
    [-14, 1.1, 1.1, 4], [-14, 1.1, 1.1, -3], [-9, 1.1, 1.1, 8],
    [9, 1.1, 1.1, 8], [14, 1.1, 1.1, -3], [14, 1.1, 1.1, 4],
    [-6, 1.1, 1.1, -9], [6, 1.1, 1.1, -9], [-2, 1.1, 1.1, -11.5],
    [2, 1.1, 1.1, -11.5], [-19, 1.1, 1.1, 3], [19, 1.1, 1.1, 3],
  ];
  for (const [cx, ch, cd, cz] of crates) box(1.2, ch, cd, cx, ch / 2, cz, 'wood');
  // Containers at the Docks (site B) and a stack at the Shrine (site A).
  box(5.2, 2.6, 2.4, 18.5, 1.3, -11.5, 'container');
  box(5.2, 2.6, 2.4, 13.5, 1.3, -13, 'containerBlue');
  box(2.4, 2.6, 5.2, 20.5, 1.3, -6, 'containerBlue');
  box(4.4, 2.4, 2.2, -19, 1.2, -11, 'container');
  box(2.2, 2.4, 4.4, -13.5, 1.2, -12.5, 'containerBlue');
  // Shrine: a small roofed altar at site A.
  box(3.4, 0.3, 3.4, -16.5, 2.6, -8, 'woodDark');
  for (const [px, pz] of [[-18, -9.5], [-15, -9.5], [-18, -6.5], [-15, -6.5]]) {
    box(0.4, 2.6, 0.4, px, 1.3, pz, 'awningRed');
  }
  box(1.6, 1.0, 1.0, -16.5, 0.5, -8, 'wood');
  // Low walls that split the lanes and give crouch cover.
  box(0.4, 1.1, 6, -11, 0.55, 8, 'plaster');
  box(0.4, 1.1, 6, 11, 0.55, 8, 'plaster');
  box(6, 1.1, 0.4, -8, 0.55, -11.5, 'plasterDark');
  box(6, 1.1, 0.4, 8, 0.55, -11.5, 'plasterDark');
  // Carts near spawns.
  box(2.0, 0.9, 1.2, -8, 0.45, 11, 'wood');
  box(2.0, 0.9, 1.2, 8, 0.45, 11, 'wood');

  // Neon and painted signs (canvas textures, no external art).
  function sign(lines, bg, fg, accent, w, h, x, y, z, ry) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: signTexture(lines, bg, fg, accent),
        emissive: new THREE.Color(accent),
        emissiveMap: signTexture(lines, bg, fg, accent),
        emissiveIntensity: 0.55,
        roughness: 0.6,
      }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    group.add(mesh);
    return mesh;
  }
  sign(['SHRINE', 'SITE A'], '#1a0f14', '#e9e6df', '#ff5d8f', 3.4, 1.7, -16.5, 3.6, -14.9, 0);
  sign(['DOCKS', 'SITE B'], '#0f1a1a', '#e9e6df', '#35d0c5', 3.4, 1.7, 16.5, 3.6, -14.9, 0);
  sign(['MONSOON', 'LANE'], '#141021', '#f0a830', '#f0a830', 4.2, 2.1, 0, 3.9, 14.9, Math.PI);
  sign(['RAMEN', '24H'], '#1a1210', '#ff5d8f', '#ff5d8f', 2.6, 1.3, -21.9, 3.2, -4, Math.PI / 2);
  sign(['TIDE', 'MARKET'], '#0f1a1a', '#35d0c5', '#35d0c5', 2.6, 1.3, 21.9, 3.2, 4, -Math.PI / 2);

  // Paper lanterns: glowing spheres strung over the hall and the sites.
  const lanternGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const lanternMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.lantern), emissive: new THREE.Color(PALETTE.lantern),
    emissiveIntensity: 1.1, roughness: 0.5,
  });
  const lanternSpots = [
    [-16.5, 2.9, -8], [-13, 2.9, -8], [16.5, 2.9, -8], [13, 2.9, -8],
    [-4, 3.4, 0], [0, 3.4, 0], [4, 3.4, 0], [0, 3.4, 6], [0, 3.4, -6],
  ];
  for (const [lx, ly, lz] of lanternSpots) {
    const m = new THREE.Mesh(lanternGeo, lanternMat);
    m.position.set(lx, ly, lz);
    group.add(m);
  }

  // Lights: cool moon key with shadows, warm lamps over the hall and sites.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#2a3450'), new THREE.Color('#0b0e1a'), 1.15));
  const moon = new THREE.DirectionalLight(new THREE.Color('#b8c8ff'), 1.8);
  moon.position.set(12, 20, 8);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -26;
  moon.shadow.camera.right = 26;
  moon.shadow.camera.top = 20;
  moon.shadow.camera.bottom = -20;
  moon.shadow.camera.far = 60;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const lamp = (x, y, z, color, intensity) => {
    const p = new THREE.PointLight(new THREE.Color(color), intensity, 16, 1.6);
    p.position.set(x, y, z);
    scene.add(p);
  };
  lamp(0, 3.6, 0, '#f0a830', 22);
  lamp(-16.5, 3.2, -8, '#ff5d8f', 16);
  lamp(16.5, 3.2, -8, '#35d0c5', 16);
  lamp(0, 3.6, 12, '#f0a830', 12);

  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 55);
  return { colliders, moveBoxes, shootables, sites: SITES, spawns: SPAWNS, waypoints: WAYPOINTS, group };
}
