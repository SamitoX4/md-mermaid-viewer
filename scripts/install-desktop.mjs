/* Instala la app en el menú del usuario:
 *  - ~/.local/share/applications/md-mermaid-viewer.desktop
 *  - ~/.local/share/icons/hicolor/<tamaño>/apps/md-mermaid-viewer.png
 * Usa el AppImage que haya en dist/ (el más reciente).
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const appimages = readdirSync(dist)
  .filter(f => f.endsWith('.AppImage'))
  .map(f => ({ f, t: statSync(path.join(dist, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
if (!appimages.length) {
  console.error('install-desktop: primero ejecuta `npm run dist` (no hay AppImage en dist/)');
  process.exit(1);
}
const appimage = path.join(dist, appimages[0].f);

const iconsSrc = path.join(root, 'build', 'icons');
const sizes = existsSync(iconsSrc)
  ? readdirSync(iconsSrc).filter(f => /^\d+x\d+\.png$/.test(f)).map(f => f.replace('.png', ''))
  : [];
if (!sizes.length) {
  console.error('install-desktop: faltan los iconos; ejecuta `npm run icons`');
  process.exit(1);
}

const dataHome = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
const appsDir = path.join(dataHome, 'applications');
const iconsDir = path.join(dataHome, 'icons', 'hicolor');
mkdirSync(appsDir, { recursive: true });

for (const size of sizes) {
  const destDir = path.join(iconsDir, size, 'apps');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(path.join(iconsSrc, `${size}.png`),
               path.join(destDir, 'md-mermaid-viewer.png'));
}

const desktop = `[Desktop Entry]
Type=Application
Version=1.0
Name=MD Mermaid Viewer
GenericName=Visor de Markdown
Comment=Visor de Markdown con diagramas Mermaid
Exec="${appimage}"
Icon=md-mermaid-viewer
Terminal=false
Categories=Office;Viewer;
MimeType=text/markdown;text/x-markdown;
Keywords=markdown;mermaid;diagramas;visor;
StartupNotify=true
StartupWMClass=MD Mermaid Viewer
`;

const desktopFile = path.join(appsDir, 'md-mermaid-viewer.desktop');
writeFileSync(desktopFile, desktop);
chmodSync(desktopFile, 0o755);

const run = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); } catch {} };
run('update-desktop-database', [appsDir]);
run('gtk-update-icon-cache', ['-f', '-t', iconsDir]);

console.log(`install-desktop: instalado ${desktopFile}`);
console.log(`install-desktop: ${sizes.length} tamaños de icono en ${path.join(iconsDir, '<n>', 'apps')}`);
console.log(`install-desktop: apunta a ${appimage}`);
