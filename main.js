const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const EXT = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx']);
const IGNORE = new Set(['node_modules', '.git', '.obsidian', '.vscode', 'dist', 'build', '.next', 'coverage']);
const MAX_DEPTH = 14;

/* En Linux el helper setuid no puede viajar dentro de un AppImage (ni de copias
   sin root), y las distros con AppArmor estricto (Ubuntu 24.04+) bloquean los
   user namespaces. En el AppImage lo resuelve scripts/patch-appimage.mjs; para
   copias sueltas del binario empaquetado nos relanzamos con --no-sandbox antes
   de que Chromium aborte. */
function sandboxUsable() {
  try {
    const st = fsSync.statSync(path.join(path.dirname(process.execPath), 'chrome-sandbox'));
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch { return false; }
}
const sandboxDisabled = process.argv.includes('--no-sandbox') || !!process.env.ELECTRON_DISABLE_SANDBOX;
if (process.platform === 'linux' && app.isPackaged && !process.env.APPIMAGE &&
    !sandboxDisabled && !sandboxUsable()) {
  app.relaunch({ args: process.argv.slice(1).concat('--no-sandbox') });
  app.exit(0);
}

let win = null;
let watcher = null;

/* Una sola instancia: al volver a abrir la app se enfoca la ventana existente.
   Además evita que dos ventanas compartan el localStorage y se pisen el estado
   guardado (tema, hoja, tamaño/bloqueo de lienzos, último archivo…).
   El hijo relanzado por el sandbox queda exento para no chocar con el padre
   que todavía se está cerrando. */
const relaunchedChild = process.platform === 'linux' && app.isPackaged &&
  !process.env.APPIMAGE && sandboxDisabled && !sandboxUsable();
const singleInstance = relaunchedChild || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

/* ─────────── árbol de directorios ─────────── */
async function walk(dir, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, 'es'));
  const out = [];
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const children = await walk(full, depth + 1);
      if (children.length) out.push({ type: 'dir', name: e.name, path: full, children });
    } else if (EXT.has(path.extname(e.name).toLowerCase())) {
      out.push({ type: 'file', name: e.name, path: full });
    }
  }
  return out;
}

function flattenFiles(nodes, acc = []) {
  for (const n of nodes) n.type === 'dir' ? flattenFiles(n.children, acc) : acc.push(n.path);
  return acc;
}

function pickFirst(tree) {
  const all = flattenFiles(tree);
  const byName = n => all.find(p => path.basename(p).toLowerCase() === n);
  return byName('readme.md') || byName('index.md') || byName('_index.md') || all[0] || null;
}

async function loadDir(dir) {
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) return { error: 'No es un directorio: ' + dir };
    const tree = await walk(dir);
    return { root: dir, tree, fileCount: flattenFiles(tree).length, first: pickFirst(tree) };
  } catch (e) { return { error: e.message }; }
}

/* ─────────── ventana ─────────── */
function createWindow() {
  win = new BrowserWindow({
    width: 1560, height: 980, minWidth: 900, minHeight: 600,
    title: 'MD Mermaid Viewer',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Necesario para que <img src="file:///..."> de rutas relativas del .md carguen.
      // Aceptable: la app solo abre contenido local elegido por el usuario.
      webSecurity: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('will-navigate', e => e.preventDefault());
}

function buildMenu() {
  const send = a => () => win && win.webContents.send('menu:action', a);
  const tpl = [
    { label: 'Archivo', submenu: [
      { label: 'Abrir carpeta…',  accelerator: 'CmdOrCtrl+O', click: send('openDir') },
      { label: 'Exportar PDF…',   accelerator: 'CmdOrCtrl+P', click: send('exportPdf') },
      { label: 'Exportar diagramas…', accelerator: 'CmdOrCtrl+Shift+E', click: send('exportAll') },
      { type: 'separator' },
      { role: 'quit', label: 'Salir' }
    ]},
    { label: 'Ver', submenu: [
      { label: 'Recargar documento', accelerator: 'F5', click: send('reload') },
      { role: 'togglefullscreen', label: 'Pantalla completa' },
      { role: 'resetZoom', label: 'Zoom de interfaz: normal' },
      { role: 'zoomIn', label: 'Zoom de interfaz: +' },
      { role: 'zoomOut', label: 'Zoom de interfaz: −' }
    ]},
    { label: 'Editar', submenu: [
      { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' },
      { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ─────────── IPC ─────────── */
ipcMain.handle('dir:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Selecciona la carpeta de documentación', properties: ['openDirectory'] });
  return r.canceled ? null : loadDir(r.filePaths[0]);
});
ipcMain.handle('dir:load', (_e, dir) => loadDir(dir));

ipcMain.handle('file:read', async (_e, p) => {
  try { return { path: p, content: await fs.readFile(p, 'utf8') }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle('path:resolve', (_e, base, rels) => {
  const out = {};
  for (const r of rels) out[r] = path.resolve(base, decodeURI(r.split('?')[0].split('#')[0]));
  return out;
});

ipcMain.handle('file:save', async (_e, { defaultPath, data, encoding = 'utf8', filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  if (r.canceled) return null;
  encoding === 'base64'
    ? await fs.writeFile(r.filePath, Buffer.from(data, 'base64'))
    : await fs.writeFile(r.filePath, data, 'utf8');
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

ipcMain.handle('doc:exportMany', async (_e, files) => {
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta destino para los diagramas', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  const dir = r.filePaths[0];
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) await fs.writeFile(path.join(dir, f.name), Buffer.from(f.data, 'base64'));
  shell.openPath(dir);
  return { dir, count: files.length };
});

ipcMain.handle('doc:exportPDF', async (_e, { defaultName = 'documento.pdf', pageSize = 'A4', landscape = false, scale = 1 } = {}) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return null;
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: false,
    pageSize, landscape, scale,
    margins: { marginType: 'custom', top: 0.6, bottom: 0.7, left: 0.6, right: 0.6 },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#999;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  });
  await fs.writeFile(r.filePath, pdf);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

ipcMain.handle('shell:open', (_e, url) => { if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url); });

/* ─────────── live reload ─────────── */
ipcMain.handle('dir:watch', (_e, dir) => {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  if (!dir) return false;
  let t = null;
  try {
    watcher = fsSync.watch(dir, { recursive: true }, (_ev, filename) => {
      if (!filename || !EXT.has(path.extname(filename).toLowerCase())) return;
      clearTimeout(t);
      t = setTimeout(() => win && win.webContents.send('file:changed', path.join(dir, filename)), 400);
    });
    return true;
  } catch { return false; }   // recursive watch no soportado en algunos Linux
});

ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));

/* ─────────── boot ─────────── */
app.whenReady().then(() => {
  if (!singleInstance) return;
  createWindow(); buildMenu();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (watcher) try { watcher.close(); } catch {} if (process.platform !== 'darwin') app.quit(); });