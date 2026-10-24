// Shared helpers: catalog loading, formatting, analytics hooks.
export const DRAFT_KEY = 'cakeCatalogDraft';

export async function loadCatalog() {
  const params = new URLSearchParams(location.search);
  if (params.get('draft') === '1') {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) return normalize(JSON.parse(d));
    } catch (e) { console.warn('draft not available', e); }
  }
  const r = await fetch('catalog.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('catalog.json: HTTP ' + r.status);
  return normalize(await r.json());
}

function normalize(cat) {
  cat.bakery = Object.assign({ name: 'Your Bakery', currency: 'USD', orderUrl: '' }, cat.bakery || {});
  cat.products = (cat.products || []).filter(p => p && p.id && p.glb);
  cat.byId = Object.fromEntries(cat.products.map(p => [p.id, p]));
  return cat;
}

export function money(n, cur = 'USD') {
  if (n === '' || n == null || isNaN(+n)) return '';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(+n); }
  catch { return '$' + (+n).toFixed(2); }
}

// "18-20" -> [18,20]; "1" -> [1,1]; "" -> [0,0]
export function servingsRange(s) {
  const m = String(s ?? '').match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
  if (!m) return [0, 0];
  return [+m[1], +(m[2] || m[1])];
}

export function orderUrl(cat, p) {
  return (p && p.orderUrl) || cat.bakery.orderUrl || '#';
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Analytics: everything goes through track(). Configure ids in catalog.json -> analytics.
export function initAnalytics(cat) {
  const a = cat.analytics || {};
  window.dataLayer = window.dataLayer || [];
  if (a.ga4Id) {
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(a.ga4Id);
    document.head.appendChild(s);
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', a.ga4Id);
  }
  if (a.plausibleDomain) {
    const s = document.createElement('script');
    s.defer = true; s.dataset.domain = a.plausibleDomain; s.src = 'https://plausible.io/js/script.js';
    document.head.appendChild(s);
  }
}

export function track(name, data = {}) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: name, ...data });
    if (window.gtag) window.gtag('event', name, data);
    if (window.plausible) window.plausible(name, { props: data });
    console.debug('[track]', name, data);
  } catch (e) { /* never break the page because of analytics */ }
}

let mvPromise;
export function loadModelViewer() {
  if (!mvPromise) mvPromise = import('https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js');
  return mvPromise;
}

// QR code for desktop visitors (qrcode-generator, pinned)
let qrPromise;
export function qrSvg(text) {
  if (!qrPromise) qrPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    s.onload = () => res(window.qrcode); s.onerror = rej; document.head.appendChild(s);
  });
  return qrPromise.then(qrcode => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); });
}

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
