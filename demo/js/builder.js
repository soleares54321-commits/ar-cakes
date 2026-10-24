// Event Table Builder: arrange catalog items on a virtual table, share via URL, export to AR.
import { THREE, loadModel, makeTable, TABLES, TABLE_H, buildArrangement, toGLB, toUSDZ, download } from './kit.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCatalog, money, esc, orderUrl, track, initAnalytics, servingsRange, loadModelViewer, isMobile, qrSvg } from './common.js';

const $ = id => document.getElementById(id);
const cat = await loadCatalog();
initAnalytics(cat);
$('bk-name').textContent = cat.bakery.name + (cat.bakery.location ? ' · ' + cat.bakery.location : '');
$('bk-note').textContent = cat.bakery.note || '';

// ---------------- state ----------------
let uidSeq = 1;
const state = { table: 'rect6', items: [] };   // items: {uid,pid,x,z,rot}  meters/degrees
let selected = null;

function encodeState() {
  const it = state.items.map(i => `${i.pid}:${Math.round(i.x * 100)}:${Math.round(i.z * 100)}:${Math.round(i.rot) % 360}`).join(',');
  return `t=${state.table}` + (it ? `&i=${it}` : '');
}
function decodeState(hash) {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const out = { table: TABLES[h.get('t')] ? h.get('t') : 'rect6', items: [], add: h.get('add') };
  for (const part of (h.get('i') || '').split(',').filter(Boolean)) {
    const [pid, x, z, rot] = part.split(':');
    if (cat.byId[pid]) out.items.push({ uid: uidSeq++, pid, x: (+x || 0) / 100, z: (+z || 0) / 100, rot: +rot || 0 });
  }
  return out;
}
function saveHash() { history.replaceState(null, '', '#' + encodeState()); }

// ---------------- three.js scene ----------------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e3dc);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 50);
camera.position.set(0, 1.3, 1.6);
const hemi = new THREE.HemisphereLight(0xffffff, 0xd8cfc4, 0.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-1.2, 2.5, 1.5); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 6 });
sun.shadow.bias = -0.0005; sun.shadow.radius = 4;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xd9d1c7, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -TABLE_H; floor.receiveShadow = true; scene.add(floor);
let tableObj = null;
const itemsRoot = new THREE.Group(); scene.add(itemsRoot);
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.05, 64), new THREE.MeshBasicMaterial({ color: 0xb4475a, transparent: true, opacity: 0.9 }));
selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.002; selRing.visible = false; scene.add(selRing);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.05, 0); controls.enableDamping = false;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 0.25; controls.maxDistance = 5;
controls.addEventListener('change', requestRender);

let needRender = true;
function requestRender() { needRender = true; }
(function loop() { if (needRender) { needRender = false; renderer.render(scene, camera); } requestAnimationFrame(loop); })();
new ResizeObserver(() => {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
}).observe(stage);

function setTable(key) {
  state.table = key;
  if (tableObj) scene.remove(tableObj);
  tableObj = makeTable(key, true); tableObj.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  scene.add(tableObj);
  const t = TABLES[key];
  const fit = Math.max(t.w, t.d) * 0.9 + 0.4;
  camera.position.set(0, fit * 0.75, fit * 0.95); controls.target.set(0, 0.05, 0); controls.update();
  state.items.forEach(clampItem); syncScene();
}

function frameItems() {
  if (!state.items.length) return;
  let span = 0.5;
  state.items.forEach(it => { span = Math.max(span, (Math.abs(it.x) + radius(it)) * 2, (Math.abs(it.z) + radius(it)) * 2); });
  const d = (span / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect) * 0.9 + 0.2;
  camera.position.set(0, d * 0.62, d * 0.8); controls.target.set(0, 0.05, 0); controls.update(); requestRender();
}

// ---------------- items ----------------
const nodes = new Map();   // uid -> Object3D
const radius = it => nodes.get(it.uid)?.userData.radius ?? 0.1;

function clampItem(it) {
  const t = TABLES[state.table], r = radius(it), m = 0.01;
  if (t.shape === 'round') {
    const R = Math.max(0, t.w / 2 - r - m), d = Math.hypot(it.x, it.z);
    if (d > R) { it.x *= R / d; it.z *= R / d; }
  } else {
    const hx = Math.max(0, t.w / 2 - r - m), hz = Math.max(0, t.d / 2 - r - m);
    it.x = Math.min(hx, Math.max(-hx, it.x)); it.z = Math.min(hz, Math.max(-hz, it.z));
  }
}

async function syncScene() {
  // remove deleted
  for (const [uid, n] of nodes) if (!state.items.find(i => i.uid === uid)) { itemsRoot.remove(n); nodes.delete(uid); }
  // add new
  await Promise.all(state.items.filter(i => !nodes.has(i.uid)).map(async it => {
    const n = await loadModel(cat.byId[it.pid].glb);
    n.userData.uid = it.uid;
    nodes.set(it.uid, n); itemsRoot.add(n);
  }));
  for (const it of state.items) {
    const n = nodes.get(it.uid); if (!n) continue;
    n.position.set(it.x, 0, it.z); n.rotation.y = THREE.MathUtils.degToRad(it.rot);
  }
  updateSelection(); renderList(); requestRender();
}

function freeSpot(r) {
  const t = TABLES[state.table];
  const ok = (x, z) => {
    if (t.shape === 'round' ? Math.hypot(x, z) > t.w / 2 - r - 0.01 : (Math.abs(x) > t.w / 2 - r - 0.01 || Math.abs(z) > t.d / 2 - r - 0.01)) return false;
    return state.items.every(o => Math.hypot(o.x - x, o.z - z) >= r + radius(o) + 0.015);
  };
  for (let ring = 0; ring < 60; ring++) {
    const d = ring * 0.04, steps = Math.max(1, Math.round(ring * 6));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const x = d * Math.cos(a), z = d * Math.sin(a);
      if (ok(x, z)) return [x, z];
    }
  }
  return [0, 0];
}

async function addItem(pid, opts = {}) {
  const p = cat.byId[pid]; if (!p) return;
  const m = await loadModel(p.glb);
  const [x, z] = opts.at || freeSpot(m.userData.radius);
  const it = { uid: uidSeq++, pid, x, z, rot: opts.rot || 0 };
  state.items.push(it); selected = it.uid;
  await syncScene(); saveHash();
  track('builder_add', { id: pid });
}

function updateSelection() {
  const it = state.items.find(i => i.uid === selected);
  $('sel-tools').hidden = !it;
  if (!it) { selRing.visible = false; return; }
  const r = radius(it) * 1.08;
  selRing.visible = true; selRing.scale.set(r, r, 1); selRing.position.set(it.x, 0.002, it.z);
}

// ---------------- pointer: select & drag on the table plane ----------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let drag = null;
function setNdc(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
function hitItem() {
  const hits = ray.intersectObjects(itemsRoot.children, true);
  if (!hits.length) return null;
  let o = hits[0].object; while (o && o.userData.uid == null) o = o.parent;
  return o ? state.items.find(i => i.uid === o.userData.uid) : null;
}
// capture phase on the stage runs before OrbitControls' own listener on the canvas
stage.addEventListener('pointerdown', e => {
  if (e.target !== renderer.domElement) return;
  if (drag) { drag = null; controls.enabled = true; return; }   // second finger -> let OrbitControls pinch
  setNdc(e);
  const it = hitItem();
  if (!it) { if (selected != null) { selected = null; updateSelection(); renderList(); requestRender(); } return; }
  selected = it.uid; updateSelection(); renderList();
  const p = new THREE.Vector3(); ray.ray.intersectPlane(plane, p);
  drag = { it, id: e.pointerId, dx: it.x - p.x, dz: it.z - p.z, moved: false };
  controls.enabled = false;
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch {}
  requestRender();
}, true);
stage.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  setNdc(e);
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return;
  drag.it.x = p.x + drag.dx; drag.it.z = p.z + drag.dz; drag.moved = true;
  clampItem(drag.it);
  const n = nodes.get(drag.it.uid); n.position.set(drag.it.x, 0, drag.it.z);
  selRing.position.set(drag.it.x, 0.002, drag.it.z);
  requestRender();
});
const endDrag = e => { if (!drag || (e && e.pointerId !== drag.id)) return; const moved = drag.moved; drag = null; controls.enabled = true; if (moved) saveHash(); };
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);

$('sel-tools').onclick = async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const it = state.items.find(i => i.uid === selected); if (!it) return;
  const act = b.dataset.act;
  if (act === 'rotl') it.rot = (it.rot + 345) % 360;
  if (act === 'rotr') it.rot = (it.rot + 15) % 360;
  if (act === 'del') { state.items = state.items.filter(i => i !== it); selected = null; }
  if (act === 'dup') { await addItem(it.pid, { rot: it.rot }); return; }
  await syncScene(); saveHash();
};

// ---------------- panel ----------------
$('table').innerHTML = Object.entries(TABLES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
$('table').onchange = () => { setTable($('table').value); saveHash(); };
$('picker').innerHTML = cat.products.map(p => `<button class="pick" data-id="${esc(p.id)}"><img src="${esc(p.poster)}" alt="" loading="lazy">${esc(p.name)}</button>`).join('');
$('picker').onclick = e => { const b = e.target.closest('.pick'); if (b) addItem(b.dataset.id); };

function renderList() {
  const cur = cat.bakery.currency;
  $('items').innerHTML = state.items.map(it => {
    const p = cat.byId[it.pid];
    return `<li class="${it.uid === selected ? 'sel' : ''}" data-uid="${it.uid}">
      <span class="nm"><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.size)}${p.servings ? ' · serves ' + esc(p.servings) : ''} · ${money(p.price, cur)}</span></span>
      <a class="btn sm" href="${esc(orderUrl(cat, p))}" target="_blank" rel="noopener" data-order="${esc(p.id)}">Order</a>
      <button class="btn sm ghost" data-del="${it.uid}" aria-label="Remove">✕</button></li>`;
  }).join('') || '<li class="muted">Tap a cake above to put it on the table.</li>';
  let lo = 0, hi = 0, sum = 0;
  state.items.forEach(it => { const p = cat.byId[it.pid]; const [a, b] = servingsRange(p.servings); lo += a; hi += b; sum += +p.price || 0; });
  $('totals').textContent = state.items.length ? `${state.items.length} item(s) · serves about ${lo === hi ? lo : lo + '–' + hi} guests · est. ${money(sum, cur)}` : '';
}
$('items').onclick = async e => {
  const o = e.target.closest('[data-order]'); if (o) { track('order_click', { id: o.dataset.order, from: 'builder' }); return; }
  const d = e.target.closest('[data-del]');
  if (d) { state.items = state.items.filter(i => i.uid !== +d.dataset.del); if (selected === +d.dataset.del) selected = null; await syncScene(); saveHash(); return; }
  const li = e.target.closest('li[data-uid]'); if (li) { selected = +li.dataset.uid; updateSelection(); renderList(); requestRender(); }
};
$('clear').onclick = async () => { if (!state.items.length || confirm('Remove everything from the table?')) { state.items = []; selected = null; await syncScene(); saveHash(); } };

function toast(t) { const el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', 2200); }

$('share').onclick = async () => {
  saveHash(); const url = location.href;
  track('builder_share', { items: state.items.length });
  if (navigator.share && isMobile()) { try { await navigator.share({ title: 'Our event table', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
};

$('shot').onclick = () => {
  const ringWas = selRing.visible; selRing.visible = false; renderer.render(scene, camera);
  const src = renderer.domElement, pad = Math.round(90 * (src.width / stage.clientWidth));
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height + pad;
  const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
  const k = src.width / stage.clientWidth; g.fillStyle = '#2b2420';
  g.font = `600 ${Math.round(15 * k)}px system-ui, sans-serif`;
  g.fillText(cat.bakery.name + ' — event table', 12 * k, src.height + 28 * k);
  g.font = `${Math.round(13 * k)}px system-ui, sans-serif`;
  g.fillText($('totals').textContent || 'Empty table', 12 * k, src.height + 52 * k);
  g.fillText(TABLES[state.table].label, 12 * k, src.height + 74 * k);
  selRing.visible = ringWas; requestRender();
  c.toBlob(b => { download(b, 'event-table.png'); track('builder_picture', {}); }, 'image/png');
};

// ---------------- AR export ----------------
let arUrl = null, lastBuilt = null;
async function buildForAR() {
  const withTable = $('with-table').checked;
  const root = await buildArrangement(state.items, cat.byId, { table: state.table, withTable, center: true });
  return root;
}
async function prepareAR() {
  $('ar-go').disabled = true; $('ar-note').textContent = '';
  $('mv-holder').innerHTML = '<p class="muted">Preparing 3D…</p>';
  if (!state.items.length) { $('mv-holder').innerHTML = '<p class="muted">Put at least one cake on the table first.</p>'; return; }
  try {
    const [root] = await Promise.all([buildForAR(), loadModelViewer()]);
    lastBuilt = root;
    const blob = await toGLB(root);
    if (arUrl) URL.revokeObjectURL(arUrl);
    arUrl = URL.createObjectURL(blob);
    $('mv-holder').innerHTML = `<model-viewer id="ar-mv" src="${arUrl}" ar ar-modes="webxr quick-look" ar-scale="fixed" ar-placement="floor"
      camera-controls touch-action="pan-y" shadow-intensity="1" exposure="1.05" alt="Your arrangement"><button slot="ar-button" style="display:none"></button></model-viewer>`;
    const mv = $('ar-mv');
    mv.addEventListener('ar-status', e => {
      if (e.detail.status === 'session-started') track('ar_session_started', { from: 'builder' });
      if (e.detail.status === 'failed') $('ar-note').textContent = 'AR could not start on this phone. Try Chrome (Android) or Safari (iPhone).';
    });
    mv.addEventListener('load', () => {
      $('ar-go').disabled = false;
      if (!isMobile()) {
        $('ar-note').textContent = 'AR works on a phone: open the shared link on your phone (scan the code below).';
        saveHash(); qrSvg(location.href).then(s => { $('ar-note').insertAdjacentHTML('beforeend', `<div class="qr">${s}</div>`); }).catch(() => {});
      }
    }, { once: true });
    $('ar-note').textContent = `File size: ${(blob.size / 1048576).toFixed(1)} MB`;
  } catch (e) {
    console.error(e); $('mv-holder').innerHTML = `<p class="err">Could not prepare AR: ${esc(e.message)}</p>`;
  }
}
$('ar-open').onclick = () => { $('ar-modal').classList.add('open'); $('ar-modal').setAttribute('aria-hidden', 'false'); track('builder_ar_open', { items: state.items.length }); prepareAR(); };
$('ar-close').onclick = () => { $('ar-modal').classList.remove('open'); $('ar-modal').setAttribute('aria-hidden', 'true'); };
$('with-table').onchange = prepareAR;
$('ar-go').onclick = () => {
  const mv = $('ar-mv'); if (!mv) return;
  track('ar_click', { from: 'builder' });
  if (mv.canActivateAR) mv.activateAR();
  else $('ar-note').textContent = isMobile()
    ? 'This phone/browser does not support AR for a custom arrangement. Android: Chrome with Google Play Services for AR. iPhone: Safari.'
    : 'AR needs a phone. Use "Share link" and open it on your phone.';
};
$('dl-glb').onclick = async () => { if (!state.items.length) return; download(await toGLB(lastBuilt || await buildForAR()), 'event-table.glb'); };
$('dl-usdz').onclick = async () => { if (!state.items.length) return; download(await toUSDZ(lastBuilt || await buildForAR()), 'event-table.usdz'); };

// ---------------- start ----------------
async function fromHash() {
  const s = decodeState(location.hash);
  state.items = s.items; selected = null;
  $('table').value = s.table; setTable(s.table);
  await syncScene();
  state.items.forEach(clampItem); await syncScene();
  if (s.add && cat.byId[s.add]) await addItem(s.add);
  frameItems(); saveHash();
}
await fromHash();
addEventListener('hashchange', () => { if (location.hash.slice(1) !== encodeState()) fromHash(); });
window.__builder = { state, addItem, encodeState, toGLB, toUSDZ, buildForAR, scene, nodes, camera, renderer };   // for automated tests
