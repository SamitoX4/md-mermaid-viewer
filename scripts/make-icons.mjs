/* Rasteriza build/icon.svg a build/icons/NxN.png usando Electron (Chromium),
 * que respeta gradientes y transformaciones SVG. */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'make-icons-electron.cjs');

execFileSync(electron, ['--no-sandbox', script], { stdio: 'inherit' });
