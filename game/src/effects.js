// Effects, pooled so the hot loop never allocates: tracer lines, impact
// sparks, smoke clouds, the muzzle flash, the rain and the first-person
// viewmodel. Smoke is gameplay, not decoration: bots cannot see through it.
import * as THREE from 'three';

const TRACER_POOL = 24;
const SPARK_POOL = 8;

export function createEffects(scene, camera) {
  // Tracers: one reusable line per shot, faded out over 90 ms.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerAt = 0;
  // Impact sparks: small point clouds, one burst at a time.
  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffc861, size: 0.09, transparent: true, opacity: 0, depthWrite: false,
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    sparks.push({ pts, life: 0, vel: [] });
  }
  let sparkAt = 0;
  // Muzzle flash: a small additive plane at the viewmodel's muzzle.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  camera.add(flash);
  flash.position.set(0.28, -0.24, -0.9);
  // Smoke clouds: translucent spheres that also block bot sight.
  const smokeClouds = [];
  const smokeGeo = new THREE.SphereGeometry(1, 14, 10);
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8, transparent: true, opacity: 0.26, roughness: 1, depthWrite: false,
  });
  // Rain: points falling in a box around the camera, recycled at the top.
  const RAIN_N = 1100;
  const rainPos = new Float32Array(RAIN_N * 3);
  const rainVel = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i += 1) {
    rainPos[i * 3] = (Math.random() - 0.5) * 44;
    rainPos[i * 3 + 1] = Math.random() * 18;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    rainVel[i] = 9 + Math.random() * 5;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    color: 0x8fa3c8, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  rain.frustumCulled = false;
  scene.add(rain);
  // Explosion light, reused for every detonation.
  const boomLight = new THREE.PointLight(0xff8a3c, 0, 22, 1.4);
  scene.add(boomLight);

  return {
    smokeClouds,
    tracer(from, to) {
      const t = tracers[tracerAt];
      tracerAt = (tracerAt + 1) % TRACER_POOL;
      const p = t.line.geometry.attributes.position.array;
      p[0] = from.x; p[1] = from.y; p[2] = from.z;
      p[3] = to.x; p[4] = to.y; p[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.opacity = 0.9;
      t.life = 0.09;
    },
    impact(point) {
      const s = sparks[sparkAt];
      sparkAt = (sparkAt + 1) % SPARK_POOL;
      const p = s.pts.geometry.attributes.position.array;
      s.vel = [];
      for (let i = 0; i < 24; i += 1) {
        p[i * 3] = point.x; p[i * 3 + 1] = point.y; p[i * 3 + 2] = point.z;
        s.vel.push(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = 1;
      s.life = 0.35;
    },
    muzzle() {
      flashMat.opacity = 0.95;
      flash.rotation.z = Math.random() * Math.PI;
      flash.scale.setScalar(0.8 + Math.random() * 0.5);
    },
    smoke(x, z, until) {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
      mesh.position.set(x, 1.0, z);
      mesh.scale.set(3.6, 1.6, 3.6);
      scene.add(mesh);
      smokeClouds.push({ x, z, r: 3.6, until, mesh });
    },
    explode(point) {
      boomLight.position.copy(point);
      boomLight.intensity = 90;
      this.impact(point);
    },
    step(dt, now, camPos) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          const p = s.pts.geometry.attributes.position.array;
          for (let i = 0; i < 24; i += 1) {
            p[i * 3] += s.vel[i].x * dt;
            p[i * 3 + 1] += s.vel[i].y * dt;
            p[i * 3 + 2] += s.vel[i].z * dt;
            s.vel[i].y -= 9 * dt;
          }
          s.pts.geometry.attributes.position.needsUpdate = true;
          s.pts.material.opacity = Math.max(0, s.life / 0.35);
        }
      }
      if (flashMat.opacity > 0) flashMat.opacity = Math.max(0, flashMat.opacity - dt * 14);
      if (boomLight.intensity > 0) boomLight.intensity = Math.max(0, boomLight.intensity - dt * 260);
      for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
        const c = smokeClouds[i];
        if (now >= c.until) {
          scene.remove(c.mesh);
          smokeClouds.splice(i, 1);
        }
      }
      // Rain follows the camera and falls straight down.
      const p = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN_N; i += 1) {
        p[i * 3 + 1] -= rainVel[i] * dt;
        if (p[i * 3 + 1] < 0) {
          p[i * 3] = camPos.x + (Math.random() - 0.5) * 44;
          p[i * 3 + 1] = 14 + Math.random() * 4;
          p[i * 3 + 2] = camPos.z + (Math.random() - 0.5) * 30;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    },
  };
}

// The first-person viewmodel: a boxy rifle with a team-coloured accent stripe,
// bobbing with movement and kicking with each shot.
export function createViewmodel(camera) {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.45, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, emissive: 0xf0a830, emissiveIntensity: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.9 });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), body);
  barrel.position.set(0, 0, -0.35);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.42), body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.02, 0.4), accent);
  stripe.position.set(0, 0.05, 0);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), grip);
  mag.position.set(0, -0.14, -0.08);
  mag.rotation.x = 0.25;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.22), grip);
  stock.position.set(0, -0.01, 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.03), body);
  sight.position.set(0, 0.1, -0.2);
  group.add(barrel, receiver, stripe, mag, stock, sight);
  group.position.set(0.28, -0.26, -0.55);
  camera.add(group);
  let kick = 0;
  let bobT = 0;
  return {
    group,
    kick() { kick = 1; },
    step(dt, speed, aiming) {
      bobT += dt * (2 + speed * 2.2);
      const bob = Math.min(1, speed / 4.3) * 0.012;
      kick = Math.max(0, kick - dt * 7);
      const ax = aiming ? 0 : 0.28;
      const ay = aiming ? -0.19 : -0.26;
      group.position.set(
        ax + Math.sin(bobT) * bob,
        ay + Math.abs(Math.cos(bobT)) * bob * 0.7,
        -0.55 + kick * 0.09,
      );
      group.rotation.x = kick * 0.16;
    },
  };
}
