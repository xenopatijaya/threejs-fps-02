// Fighter bodies: stylised low-poly figures built from primitives, one per
// team colour. The head sphere is the headshot zone, the torso box the body
// zone; both carry userData so the shooter's raycast knows what it hit.
import * as THREE from 'three';
import { TEAMS } from './palette.js';

export function createFighter(team) {
  const color = new THREE.Color(TEAMS[team].color);
  const dark = new THREE.Color(TEAMS[team].dark);
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.9 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.55 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.5 });

  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), vest);
  torso.position.y = 1.12;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.06), accent);
  visor.position.set(0, 1.64, 0.19);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), cloth);
  legL.position.set(-0.14, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.16), cloth);
  armL.position.set(-0.33, 1.15, 0.1);
  armL.rotation.x = -0.9;
  const armR = armL.clone();
  armR.position.x = 0.33;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), gunMat);
  gun.position.set(0.12, 1.28, 0.42);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.08, 0.32), accent);
  band.position.y = 1.32;
  group.add(torso, head, visor, legL, legR, armL, armR, gun, band);
  return { group, head, torso, legL, legR, gun };
}

// A fighter's hit meshes, tagged for the shooter's raycast.
export function hitMeshes(fighter, actor) {
  fighter.head.userData = { actor, part: 'head' };
  fighter.torso.userData = { actor, part: 'body' };
  fighter.legL.userData = { actor, part: 'legs' };
  fighter.legR.userData = { actor, part: 'legs' };
  return [fighter.head, fighter.torso, fighter.legL, fighter.legR];
}
