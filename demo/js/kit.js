// three.js toolkit: load models, build arrangements, export GLB/USDZ.
// three.js version is pinned in the importmap of every page (three@0.163.0).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';

export { THREE };

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();

// Returns a fresh clone, normalized: centered in X/Z, bottom at y=0, size in meters as authored.
export function loadModel(url) {
  if (!cache.has(url)) {
    cache.set(url, loader.loadAsync(url).then(g => {
      const inner = g.scene;
      const box = new THREE.Box3().setFromObject(inner);
      const c = box.getCenter(new THREE.Vector3());
      inner.position.set(-c.x, -box.min.y, -c.z);
      const wrap = new THREE.Group(); wrap.add(inner);
      const size = box.getSize(new THREE.Vector3());
      wrap.userData.size = size;
      wrap.userData.radius = Math.max(size.x, size.z) / 2;
      wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return wrap;
    }));
  }
  return cache.get(url).then(w => { const c = w.clone(true); c.userData = { ...w.userData }; return c; });
}

export const TABLE_H = 0.76;
export const TABLES = {
  rect6: { shape: 'rect', w: 1.83, d: 0.76, label: '6 ft rectangular' },
  rect8: { shape: 'rect', w: 2.44, d: 0.76, label: '8 ft rectangular' },
  rect4: { shape: 'rect', w: 1.22, d: 0.61, label: '4 ft dessert table' },
  round5: { shape: 'round', w: 1.52, d: 1.52, label: '5 ft round' },
  round3: { shape: 'round', w: 0.91, d: 0.91, label: '36" round cake table' },
};

// Table whose TOP surface is at y = 0 (legs go down to -TABLE_H when withLegs).
export function makeTable(key, withLegs = false) {
  const t = TABLES[key] || TABLES.rect6;
  const g = new THREE.Group(); g.name = 'table';
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.95 });
  const thick = 0.02;
  const top = t.shape === 'round'
    ? new THREE.Mesh(new THREE.CylinderGeometry(t.w / 2, t.w / 2, thick, 64), cloth)
    : new THREE.Mesh(new THREE.BoxGeometry(t.w, thick, t.d), cloth);
  top.position.y = -thick / 2; top.receiveShadow = true; top.name = 'tabletop';
  g.add(top);
  if (withLegs) {
    // simple floor-length skirt reads better in AR than bare legs
    const skirtH = TABLE_H - thick;
    const skirt = t.shape === 'round'
      ? new THREE.Mesh(new THREE.CylinderGeometry(t.w / 2 - 0.005, t.w / 2 - 0.005, skirtH, 64, 1, true), cloth)
      : new THREE.Mesh(new THREE.BoxGeometry(t.w - 0.01, skirtH, t.d - 0.01), cloth);
    skirt.position.y = -thick - skirtH / 2; g.add(skirt);
  }
  return g;
}

// items: [{pid, x, z, rot}] (meters, degrees) ; byId: catalog products by id
// opts: { table: key|null, withTable: bool, center: bool }
export async function buildArrangement(items, byId, opts = {}) {
  const root = new THREE.Group(); root.name = 'arrangement';
  const content = new THREE.Group(); root.add(content);
  const models = await Promise.all(items.map(it => byId[it.pid] ? loadModel(byId[it.pid].glb) : null));
  items.forEach((it, i) => {
    const m = models[i]; if (!m) return;
    m.position.set(it.x, 0, it.z);
    m.rotation.y = THREE.MathUtils.degToRad(it.rot || 0);
    m.name = it.pid;
    content.add(m);
  });
  if (opts.withTable && opts.table) {
    content.add(makeTable(opts.table, true));
    content.position.y = TABLE_H;
  } else if (opts.center !== false && content.children.length) {
    const b = new THREE.Box3().setFromObject(content);
    const c = b.getCenter(new THREE.Vector3());
    content.position.set(-c.x, 0, -c.z);
  }
  return root;
}

export async function toGLB(obj) {
  const ab = await new GLTFExporter().parseAsync(obj, { binary: true, onlyVisible: true });
  return new Blob([ab], { type: 'model/gltf-binary' });
}

export async function toUSDZ(obj) {
  const ex = new USDZExporter();
  const opts = { quickLookCompatible: true, maxTextureSize: 1024 };
  const data = ex.parseAsync ? await ex.parseAsync(obj, opts) : await ex.parse(obj, opts);
  return new Blob([data], { type: 'model/vnd.usdz+zip' });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
