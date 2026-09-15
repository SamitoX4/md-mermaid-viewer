/* Parchea el AppImage generado por electron-builder:
 *
 * Los AppImage no pueden transportar el chrome-sandbox con setuid (root), y en
 * distros que restringen los user namespaces sin privilegios (Ubuntu 24.04+)
 * Electron aborta al arrancar con "The SUID sandbox helper binary was found,
 * but is not configured correctly". El .desktop interno ya usa --no-sandbox,
 * pero al ejecutar `./App.AppImage` desde la terminal no se aplica.
 *
 * Este script reempaqueta el squashfs con un AppRun que desactiva el sandbox
 * siempre (ELECTRON_DISABLE_SANDBOX lo lee Electron al arrancar y agrega
 * --no-sandbox antes de inicializar Chromium).
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync, closeSync, mkdtempSync, openSync, readFileSync, readSync,
  readdirSync, renameSync, rmSync, writeFileSync, writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dist = path.resolve('dist');
const appimageName = readdirSync(dist).find(f => f.endsWith('.AppImage'));
if (!appimageName) {
  console.log('patch-appimage: no hay AppImage en dist/, nada que hacer');
  process.exit(0);
}
const appimage = path.join(dist, appimageName);

const offset = Number(execFileSync(appimage, ['--appimage-offset']).toString().trim());
if (!Number.isFinite(offset) || offset <= 0) {
  console.error('patch-appimage: no se pudo obtener --appimage-offset');
  process.exit(1);
}

const PATCH = `
# Un AppImage no puede llevar chrome-sandbox con setuid y muchas distros
# (Ubuntu 24.04+) bloquean además el sandbox de user namespaces para apps sin
# perfil AppArmor. Electron lee ELECTRON_DISABLE_SANDBOX en BasicStartupComplete
# y agrega --no-sandbox antes de inicializar Chromium, así que arranca siempre.
export ELECTRON_DISABLE_SANDBOX=1`;

const work = mkdtempSync(path.join(tmpdir(), 'mdv-appimage-'));
try {
  execFileSync(appimage, ['--appimage-extract'], { cwd: work, stdio: 'ignore' });
  const root = path.join(work, 'squashfs-root');
  const apprun = path.join(root, 'AppRun');
  let sh = readFileSync(apprun, 'utf8');

  if (!sh.includes('ELECTRON_DISABLE_SANDBOX')) {
    const m = sh.match(/(BIN="[^"]+")/);
    if (m) {
      sh = sh.replace(m[1], `${m[1]}\n${PATCH}`);
      // refuerzo: que las dos líneas exec del template pasen --no-sandbox
      const withArgs = 'exec "$BIN" "${args[@]}"';
      if (sh.includes(withArgs)) {
        sh = sh.replace(withArgs, 'exec "$BIN" --no-sandbox "${args[@]}"')
               .replace('exec "$BIN"\n', 'exec "$BIN" --no-sandbox\n');
      } else {
        console.warn('patch-appimage: no se hallaron las líneas exec; ' +
                     'se usará solo ELECTRON_DISABLE_SANDBOX');
      }
    } else {
      // plantilla inesperada (AppRun symlink u otro): usamos un wrapper propio
      const isElf = p => {
        try {
          const fd = openSync(p, 'r');
          const b = Buffer.alloc(4);
          readSync(fd, b, 0, 4, 0);
          closeSync(fd);
          return b.toString() === '\x7fELF';
        } catch { return false; }
      };
      const exe = readdirSync(root, { withFileTypes: true })
        .find(e => e.isFile() && e.name !== 'AppRun' && e.name !== 'chrome-sandbox' &&
                   isElf(path.join(root, e.name)));
      if (!exe) throw new Error('no se encontró el ejecutable dentro del AppImage');
      sh = `#!/bin/bash\nAPP="$(dirname "$(readlink -f "$0")")/${exe.name}"\n${PATCH}\nexec "$APP" "$@"\n`;
    }
    writeFileSync(apprun, sh);
  }

  // copia el runtime ELF (todo lo anterior al squashfs) sin cargar 145 MB en RAM
  const runtime = path.join(work, 'runtime.bin');
  const inFd = openSync(appimage, 'r');
  const outFd = openSync(runtime, 'w');
  const buf = Buffer.alloc(1 << 20);
  for (let left = offset; left > 0;) {
    const n = readSync(inFd, buf, 0, Math.min(buf.length, left), null);
    writeSync(outFd, buf, 0, n);
    left -= n;
  }
  closeSync(inFd);
  closeSync(outFd);

  const sqfs = path.join(work, 'payload.sqfs');
  console.log('patch-appimage: recomprimiendo squashfs (puede tardar un poco)…');
  // el runtime de AppImage solo sabe montar squashfs en xz o gzip
  execFileSync('mksquashfs',
    [root, sqfs, '-root-owned', '-noappend', '-comp', 'gzip', '-no-progress', '-quiet'],
    { stdio: 'inherit' });

  execFileSync('sh', ['-c', 'cat "$1" "$2" > "$3.new"', 'sh', runtime, sqfs, appimage]);
  renameSync(appimage + '.new', appimage);
  chmodSync(appimage, 0o755);
  console.log(`patch-appimage: ${appimageName} listo para arrancar sin flags`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
