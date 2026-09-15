import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import mermaid from 'mermaid';
import 'highlight.js/styles/github.css';

/* ═══════════ helpers ═══════════ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const baseName = p => String(p).split(/[\\/]/).pop();
const slug = p => baseName(p).replace(/\.[^.]+$/, '');

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function bufToB64(u8) {
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(bin);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ═══════════ estado ═══════════ */
let rootDir = null, currentPath = null, currentDoc = 'documento';
let diagrams = [];          // { n, kind, svg, box }
let uid = 0;

/* tamaño de las hojas en px CSS (96 dpi), igual que usa el PDF */
const PAGE_PX = { A4: [794, 1123], A3: [1123, 1587], Letter: [816, 1056], Legal: [816, 1344] };

/* ═══════════ markdown-it ═══════════ */
const mdi = new MarkdownIt({
  html: true, linkify: true, breaks: false,
  highlight: (str, lang) => {
    if (lang === 'mermaid') return '';                       // lo procesamos aparte
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch {}
    }
    return '';
  }
});

/* ═══════════ mermaid ═══════════ */
function initMermaid(theme = 'neutral') {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    // CLAVE para poder ampliar sin perder calidad: el SVG conserva su tamaño real
    flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis', padding: 12 },
    sequence : { useMaxWidth: false, mirrorActors: false },
    gantt    : { useMaxWidth: false },
    journey  : { useMaxWidth: false },
    mindmap  : { useMaxWidth: false },
    timeline : { useMaxWidth: false },
    er       : { useMaxWidth: false },
    pie      : { useMaxWidth: false },
    gitGraph : { useMaxWidth: false },
    class    : { useMaxWidth: false },
    state    : { useMaxWidth: false }
  });
}

/* tema claro/oscuro de toda la interfaz (el tema mermaid "dark" activa el modo oscuro) */
function applyTheme(name) {
  const dark = name === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('mdv:theme', name); } catch {}
}

/* vista de hoja: Papel + Horizontal también cambian la vista, no solo el PDF */
function applyPage() {
  const page = $('#pageSize').value;
  const land = $('#landscape').checked;
  const [w, h] = PAGE_PX[page] || PAGE_PX.A4;
  const s = document.documentElement.style;
  s.setProperty('--page-w', (land ? h : w) + 'px');
  s.setProperty('--page-h', (land ? w : h) + 'px');
  try {
    localStorage.setItem('mdv:pageSize', page);
    localStorage.setItem('mdv:landscape', land ? '1' : '0');
  } catch {}
}

(() => {
  let saved = '';
  try {
    saved = localStorage.getItem('mdv:theme') || '';
    const page = localStorage.getItem('mdv:pageSize') || '';
    if (page && [...$('#pageSize').options].some(o => o.value === page)) $('#pageSize').value = page;
    $('#landscape').checked = localStorage.getItem('mdv:landscape') === '1';
  } catch {}
  if (saved && $('#theme').querySelector(`option[value="${saved}"]`)) $('#theme').value = saved;
  applyTheme($('#theme').value);
  initMermaid($('#theme').value);
  applyPage();
})();

/* ═══════════ pan & zoom ═══════════ */
function naturalSize(svg) {
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (vb && vb.width) return { w: vb.width, h: vb.height };
  return { w: parseFloat(svg.getAttribute('width')) || 800,
           h: parseFloat(svg.getAttribute('height')) || 600 };
}

function makeZoomable(viewport, svg) {
  let s = 1, tx = 0, ty = 0, dragging = false, px = 0, py = 0, locked = false;
  const apply = () => { svg.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };

  function fit() {
    const { w, h } = naturalSize(svg);
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!w || !h || !vw || !vh) return;
    s = Math.min(vw / w, vh / h) * 0.94;
    tx = (vw - w * s) / 2;
    ty = (vh - h * s) / 2;
    apply();
  }
  function zoomAt(mx, my, factor) {
    const ns = Math.min(40, Math.max(0.03, s * factor));
    tx = mx - (mx - tx) * (ns / s);
    ty = my - (my - ty) * (ns / s);
    s = ns; apply();
  }
  function zoomBy(f) { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, f); }

  viewport.addEventListener('wheel', e => {
    if (locked) return;                 // sin bloquear: zoom; bloqueado: scrollea el documento
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  viewport.addEventListener('pointerdown', e => {
    if (locked || e.button !== 0) return;
    dragging = true; px = e.clientX - tx; py = e.clientY - ty;
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('grabbing');
  });
  viewport.addEventListener('pointermove', e => {
    if (!dragging) return;
    tx = e.clientX - px; ty = e.clientY - py; apply();
  });
  const stop = () => { dragging = false; viewport.classList.remove('grabbing'); };
  viewport.addEventListener('pointerup', stop);
  viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('dblclick', () => { if (!locked) fit(); });

  requestAnimationFrame(fit);
  return {
    fit, zoomBy,
    get scale() { return s; },
    setLocked(v) {
      locked = !!v;
      if (locked) { dragging = false; viewport.classList.remove('grabbing'); }
    }
  };
}

/* ═══════════ tamaño del lienzo de cada diagrama ═══════════ */
const VIEW_MIN = { w: 240, h: 150 };
const VIEW_MAX = { w: 4000, h: 1600 };
let viewportSizes = (() => {
  try { return JSON.parse(localStorage.getItem('mdv:viewports') || '{}') || {}; }
  catch { return {}; }
})();
try { localStorage.removeItem('mdv:viewport'); } catch {}   // preferencia global antigua

const viewportKey = n => `${currentPath || 'documento'}#${n}`;

let viewportLocks = (() => {
  try { return JSON.parse(localStorage.getItem('mdv:locks') || '{}') || {}; }
  catch { return {}; }
})();

function saveViewportLocks() {
  try { localStorage.setItem('mdv:locks', JSON.stringify(viewportLocks)); } catch {}
}

function applyViewportSize(el, size) {
  if (!size) return;
  el.style.width = size.w + 'px';
  el.style.height = size.h + 'px';
}

function saveViewportSizes() {
  try { localStorage.setItem('mdv:viewports', JSON.stringify(viewportSizes)); } catch {}
}

function makeResizable(box, vp, ctrl, key) {
  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = 'Arrastra para cambiar el tamaño de este lienzo · doble clic = restablecer';

  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
    grip.classList.add('active');
    try { grip.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      const maxW = Math.max(VIEW_MIN.w, box.clientWidth);
      const w = Math.min(maxW, Math.max(VIEW_MIN.w, sw + ev.clientX - sx));
      const h = Math.min(VIEW_MAX.h, Math.max(VIEW_MIN.h, sh + ev.clientY - sy));
      applyViewportSize(vp, { w: Math.round(w), h: Math.round(h) });
    };
    const up = () => {
      grip.classList.remove('active');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const cur = vp.getBoundingClientRect();
      viewportSizes[key] = { w: Math.round(cur.width), h: Math.round(cur.height) };
      saveViewportSizes();
      ctrl.fit();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  grip.addEventListener('dblclick', () => {
    delete viewportSizes[key];
    saveViewportSizes();
    vp.style.width = ''; vp.style.height = '';
    ctrl.fit();
  });

  box.append(grip);
  return grip;
}

/* ═══════════ export de diagramas ═══════════ */
function svgSource(svg) {
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');                       // quita el transform del pan/zoom
  const { w, h } = naturalSize(svg);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', Math.round(w));
  clone.setAttribute('height', Math.round(h));
  clone.setAttribute('viewBox', `0 0 ${Math.round(w)} ${Math.round(h)}`);
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
         new XMLSerializer().serializeToString(clone);
}

async function svgToPng(svg, scale = 3) {
  const { w, h } = naturalSize(svg);
  // Chromium limita el canvas a ~16384 px por lado
  const maxSide = Math.max(w, h);
  const s = Math.min(scale, Math.max(1, 16000 / maxSide));
  const src = svgSource(svg);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('No se pudo rasterizar el SVG'));
    img.src = 'data:image/svg+xml;base64,' + utf8ToB64(src);
  });
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--diagram-bg').trim() || '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { blob, scale: s };
}

async function saveText(text, name, ext) {
  return window.api.save({
    defaultPath: name, data: text, encoding: 'utf8',
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
}
async function saveBlob(blob, name, ext) {
  return window.api.save({
    defaultPath: name, data: bufToB64(new Uint8Array(await blob.arrayBuffer())),
    encoding: 'base64', filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
}

async function exportDiagram(d, fmt) {
  const base = `${slug(currentPath || 'doc')}-${String(d.n).padStart(2, '0')}-${d.kind}`;
  if (fmt === 'svg') { const p = await saveText(svgSource(d.svg), base + '.svg', 'svg'); if (p) status('SVG → ' + p); return; }
  const { blob, scale } = await svgToPng(d.svg, 3);
  const p = await saveBlob(blob, base + '.png', 'png');
  if (p) status(`PNG (${scale}×) → ${p}`);
}

async function exportAllDiagrams(fmt = 'png') {
  if (!diagrams.length) return status('⚠ No hay diagramas en este documento');
  status(`Exportando ${diagrams.length} diagrama(s)…`);
  const files = [];
  for (const d of diagrams) {
    const base = `${slug(currentPath || 'doc')}-${String(d.n).padStart(2, '0')}-${d.kind}`;
    if (fmt === 'svg') {
      files.push({ name: base + '.svg', data: utf8ToB64(svgSource(d.svg)) });
    } else {
      const { blob } = await svgToPng(d.svg, 3);
      files.push({ name: base + '.png', data: bufToB64(new Uint8Array(await blob.arrayBuffer())) });
    }
  }
  const r = await window.api.exportMany(files);
  status(r ? `✔ ${r.count} archivo(s) en ${r.dir}` : 'Exportación cancelada');
}

/* ═══════════ render ═══════════ */
async function absolutize(html, baseDir) {
  const rels = new Set();
  const re = /\b(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/^(https?:|data:|file:|blob:|mailto:|#|\/)/i.test(u)) continue;
    rels.add(u);
  }
  if (!rels.size) return html;
  const map = await window.api.resolvePaths(baseDir, [...rels]);
  for (const [rel, abs] of Object.entries(map)) {
    const url = 'file:///' + abs.replace(/\\/g, '/').replace(/^\/+/, '');
    html = html.replace(new RegExp(`(src|href)="${escapeRe(rel)}"`, 'g'), `$1="${url}"`);
  }
  return html;
}

async function renderMarkdown(text) {
  const content = $('#content');
  diagrams = [];
  content.innerHTML = '';

  const baseDir = currentPath ? currentPath.replace(/[\\/][^\\/]+$/, '') : (rootDir || '.');
  const paper = document.createElement('div');
  paper.className = 'paper';
  content.append(paper);
  paper.innerHTML = await absolutize(mdi.render(text), baseDir);

  decorateLinks(paper);

  const codes = [...paper.querySelectorAll('code.language-mermaid')];
  status(codes.length ? `Renderizando ${codes.length} diagrama(s)…` : 'Renderizando…');
  await sleep(0);

  let ok = 0, fail = 0;
  for (const code of codes) {
    const pre = code.closest('pre');
    const id = `mmd-${++uid}`;
    const box = document.createElement('div');
    const src = code.textContent;

    try {
      const { svg } = await mermaid.render(id, src);
      const kind = (src.trim().split(/[\s\n]+/)[0] || 'diagrama').toLowerCase();

      const n = diagrams.length + 1;
      const vp = document.createElement('div');
      vp.className = 'viewport';
      applyViewportSize(vp, viewportSizes[viewportKey(n)]);
      vp.innerHTML = svg;
      const svgEl = vp.firstElementChild;

      const bar = document.createElement('div');
      bar.className = 'toolbar';
      bar.innerHTML =
        `<span class="tag">${esc(kind)}</span>` +
        `<button data-a="in"   title="Acercar">＋</button>` +
        `<button data-a="out"  title="Alejar">－</button>` +
        `<button data-a="fit"  title="Ajustar (doble clic)">⤢</button>` +
        `<button data-a="full" title="Pantalla completa">⛶</button>` +
        `<button data-a="lock" title="Bloquear interacción">🔓</button>` +
        `<button data-a="svg"  title="Exportar SVG">SVG</button>` +
        `<button data-a="png"  title="Exportar PNG 3×">PNG</button>`;

      box.className = 'diagram';
      box.append(bar, vp);
      pre.replaceWith(box);

      const key = viewportKey(n);
      const d = { n, kind, svg: svgEl, box };
      const ctrl = makeZoomable(vp, svgEl);
      d.ctrl = ctrl;
      const grip = makeResizable(box, vp, ctrl, key);

      const lockBtn = bar.querySelector('button[data-a="lock"]');
      const setLocked = on => {
        if (on) viewportLocks[key] = 1; else delete viewportLocks[key];
        saveViewportLocks();
        vp.classList.toggle('locked', on);
        grip.style.display = on ? 'none' : '';
        lockBtn.classList.toggle('on', on);
        lockBtn.textContent = on ? '🔒' : '🔓';
        lockBtn.title = on
          ? 'Lienzo bloqueado: la rueda hace scroll del documento · clic para desbloquear'
          : 'Bloquear interacción (la rueda hará scroll del documento)';
        ctrl.setLocked(on);
      };
      setLocked(!!viewportLocks[key]);
      diagrams.push(d);

      bar.addEventListener('click', e => {
        const a = e.target.dataset.a;
        if (!a) return;
        if (a === 'in')   ctrl.zoomBy(1.25);
        if (a === 'out')  ctrl.zoomBy(0.8);
        if (a === 'fit')  ctrl.fit();
        if (a === 'full') openModal(d);
        if (a === 'lock') setLocked(!viewportLocks[key]);
        if (a === 'svg')  exportDiagram(d, 'svg');
        if (a === 'png')  exportDiagram(d, 'png');
      });
      ok++;
    } catch (err) {
      // mermaid puede dejar un nodo temporal colgado tras un fallo
      document.getElementById('d' + id)?.remove();
      box.className = 'diagram error';
      box.innerHTML =
        `<div class="err-head">⚠ Error de sintaxis Mermaid (bloque ${uid})</div>` +
        `<pre class="err-msg">${esc(err?.str || err?.message || err)}</pre>` +
        `<pre class="err-src">${esc(src)}</pre>`;
      pre.replaceWith(box);
      fail++;
    }
  }
  status(fail ? `Listo · ${ok} correcto(s), ${fail} con error` : `Listo · ${ok} diagrama(s)`);
}

function decorateLinks(root) {
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    a.addEventListener('click', async e => {
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) return window.api.openExternal(href);
      const base = currentPath ? currentPath.replace(/[\\/][^\\/]+$/, '') : rootDir;
      const map = await window.api.resolvePaths(base, [href]);
      const target = map[href];
      if (/\.(md|markdown|mdown|mkd|mdx)$/i.test(target)) await openFile(target);
      else window.api.openExternal('file:///' + target.replace(/\\/g, '/'));
    });
  });
}

/* ═══════════ modal ═══════════ */
let modalCtrl = null;
function openModal(d) {
  const m = $('#modal'), vp = $('#modalViewport');
  $('#modalTitle').textContent = `${baseName(currentPath || '')} · diagrama ${d.n} (${d.kind}) · ${Math.round(modalCtrl?.scale*100 || 100)}%`;
  vp.innerHTML = '';
  const svg = d.svg.cloneNode(true);
  svg.removeAttribute('style');
  vp.appendChild(svg);
  m.hidden = false;
  modalCtrl = makeZoomable(vp, svg);
  m.querySelector('.modal-bar').onclick = e => {
    const a = e.target.dataset.a;
    if (!a) return;
    if (a === 'in')    modalCtrl.zoomBy(1.25);
    if (a === 'out')   modalCtrl.zoomBy(0.8);
    if (a === 'fit')   modalCtrl.fit();
    if (a === 'svg')   exportDiagram(d, 'svg');
    if (a === 'png')   exportDiagram(d, 'png');
    if (a === 'close') closeModal();
  };
  setTimeout(() => { $('#modalTitle').textContent =
    `${baseName(currentPath || '')} · diagrama ${d.n} (${d.kind})`; }, 60);
}
function closeModal() { $('#modal').hidden = true; $('#modalViewport').innerHTML = ''; modalCtrl = null; }

/* ═══════════ PDF ═══════════ */
async function exportPDF() {
  if (!currentPath) return status('⚠ Abre un documento primero');
  status('Generando PDF…');
  await sleep(80);                       // deja asentar el layout tras el @media print
  const out = await window.api.exportPDF({
    defaultName: slug(currentPath) + '.pdf',
    pageSize : $('#pageSize').value,
    landscape: $('#landscape').checked
  });
  status(out ? '✔ PDF → ' + out : 'Exportación cancelada');
}

/* ═══════════ árbol ═══════════ */
function renderTree(nodes) {
  const nav = $('#tree');
  nav.innerHTML = '';
  const build = list => {
    const ul = document.createElement('ul');
    for (const n of list) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'row';
      if (n.type === 'dir') {
        li.className = 'dir';
        row.innerHTML = `<span class="chev">▶</span><span>🗀</span><span class="lbl">${esc(n.name)}</span>`;
        row.onclick = () => li.classList.toggle('open');
        li.append(row, build(n.children));
      } else {
        li.className = 'file';
        row.dataset.path = n.path;
        row.title = n.path;
        row.innerHTML = `<span class="chev"></span><span>🗎</span><span class="lbl">${esc(n.name)}</span>`;
        row.onclick = () => openFile(n.path);
        li.append(row);
      }
      ul.append(li);
    }
    return ul;
  };
  nav.append(build(nodes));
  nav.querySelector('li.dir')?.classList.add('open');
}

function markActive(p) {
  document.querySelectorAll('#tree .row.active').forEach(r => r.classList.remove('active'));
  const row = document.querySelector(`#tree .row[data-path="${CSS.escape(p)}"]`);
  if (row) { row.classList.add('active'); row.scrollIntoView({ block: 'nearest' }); }
}

function filterTree(q) {
  q = q.trim().toLowerCase();
  const items = [...document.querySelectorAll('#tree li')];
  items.forEach(li => li.classList.remove('hide'));
  if (!q) return;
  items.filter(li => li.classList.contains('file'))
       .forEach(li => { if (!li.textContent.toLowerCase().includes(q)) li.classList.add('hide'); });
  [...document.querySelectorAll('#tree li.dir')].reverse().forEach(dir => {
    const visible = [...dir.querySelectorAll(':scope > ul > li')].some(li => !li.classList.contains('hide'));
    if (!visible) dir.classList.add('hide'); else dir.classList.add('open');
  });
}

/* ═══════════ carga ═══════════ */
async function openFile(p) {
  const res = await window.api.openFile(p);
  if (res.error) return status('⚠ ' + res.error);
  currentPath = res.path;
  currentDoc = slug(res.path);
  try { localStorage.setItem('mdv:lastFile', res.path); } catch {}
  $('#docTitle').textContent = res.path;
  $('#docTitle').title = res.path;
  document.title = `${baseName(res.path)} · MD Mermaid Viewer`;
  markActive(res.path);
  $('#content').scrollTop = 0;
  try { await renderMarkdown(res.content); }
  catch (e) { $('#content').innerHTML = `<pre class="err-msg">${esc(e.stack || e)}</pre>`; status('⚠ ' + e.message); }
}

async function loadDirectory(dir) {
  const res = dir ? await window.api.loadDirectory(dir) : await window.api.openDirectory();
  if (!res) return;
  if (res.error) {
    if (dir) { try { localStorage.removeItem('mdv:lastDir'); } catch {} }
    return status('⚠ ' + res.error);
  }
  rootDir = res.root;
  try { localStorage.setItem('mdv:lastDir', res.root); } catch {}
  renderTree(res.tree);
  $('#count').textContent = `${res.fileCount} archivo(s) · ${res.root}`;
  status(`Carpeta abierta: ${res.root}`);
  window.api.watch(res.root);
  if (res.first) await openFile(res.first);
}

/* ═══════════ status ═══════════ */
let statusTimer;
function status(msg) {
  $('#status-text').textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { if ($('#status-text').textContent === msg) $('#status-text').textContent = 'Listo'; }, 6000);
}

/* ═══════════ wiring ═══════════ */
$('#btnOpen').onclick = () => loadDirectory();
$('#btnPDF').onclick = exportPDF;
$('#btnExportAll').onclick = () => exportAllDiagrams('png');
$('#filter').oninput = e => filterTree(e.target.value);
$('#theme').onchange = async e => {
  applyTheme(e.target.value);
  initMermaid(e.target.value);
  if (currentPath) openFile(currentPath);
};
$('#pageSize').onchange = applyPage;
$('#landscape').onchange = applyPage;

// redimensionar sidebar
(() => {
  const r = $('#resizer'), sb = $('#sidebar');
  let on = false;
  r.addEventListener('pointerdown', e => { on = true; r.setPointerCapture(e.pointerId); });
  r.addEventListener('pointermove', e => { if (on) sb.style.width = Math.max(160, e.clientX) + 'px'; });
  r.addEventListener('pointerup', () => { on = false; diagrams.forEach(d => {}); });
})();

// drag & drop de carpeta
document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
document.addEventListener('dragleave', e => { if (e.target === document.body) document.body.classList.remove('dropping'); });
document.addEventListener('drop', e => {
  e.preventDefault(); document.body.classList.remove('dropping');
  const f = e.dataTransfer.files[0]; if (!f) return;
  const p = window.api.dropPath(f); if (p) loadDirectory(p);
});

// menú + atajos
window.api.onMenu(a => {
  if (a === 'openDir')   loadDirectory();
  if (a === 'exportPdf') exportPDF();
  if (a === 'exportAll') exportAllDiagrams('png');
  if (a === 'reload' && currentPath) openFile(currentPath);
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) return closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#filter').focus(); }
  if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '0'].includes(e.key)) {
    if (!modalCtrl) return;
    e.preventDefault();
    e.key === '0' ? modalCtrl.fit() : modalCtrl.zoomBy(e.key === '-' ? 0.8 : 1.25);
  }
});

// live reload
window.api.onFileChanged(async p => {
  if (!rootDir) return;
  // el árbol puede haber cambiado
  const res = await window.api.loadDirectory(rootDir);
  if (!res.error) { renderTree(res.tree); $('#count').textContent = `${res.fileCount} archivo(s) · ${res.root}`; markActive(currentPath); }
  if (p === currentPath) { status('↻ Archivo modificado, recargando…'); await openFile(p); }
});

window.api.info().then(i => { if (i.platform === 'linux') console.log('live reload recursivo puede no estar soportado'); });

// restaurar la última carpeta (y el último archivo) abiertos
(() => {
  let last = '', lastFile = '';
  try {
    last = localStorage.getItem('mdv:lastDir') || '';
    lastFile = localStorage.getItem('mdv:lastFile') || '';
  } catch {}
  if (!last) return;
  loadDirectory(last).then(() => {
    if (!lastFile || !rootDir || lastFile === currentPath) return;
    const inRoot = lastFile === rootDir || lastFile.startsWith(rootDir + '/') || lastFile.startsWith(rootDir + '\\');
    if (inRoot) openFile(lastFile);
  });
})();