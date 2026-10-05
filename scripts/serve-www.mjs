// RT_59 — serveur statique local du build de production (`www/`).
//
// Reproduit ce que l'hébergement doit faire pour la version web installable :
// tout chemin inconnu est réécrit vers `index.html`, et seuls les bundles dont
// le nom porte une empreinte sont mis en cache longuement — tout le reste, dont
// les fichiers qui pilotent les mises à jour (`ngsw-worker.js`, `ngsw.json`,
// `index.html`, `manifest.webmanifest`), est servi en `no-cache`.
// `ng serve` n'active pas le service worker (RT_54) : ce serveur sert à le
// vérifier en local, où `localhost` dispense du HTTPS.
//
// Usage : ng build && node scripts/serve-www.mjs [port]   (8080 par défaut)

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'www');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Bundles nommés avec une empreinte de contenu (`outputHashing: all`). */
const HASHED = /^\/(?:chunk|main|polyfills|styles)-[\w-]+\.(?:js|css)$/;

async function resolveFile(pathname) {
  const target = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  const info = await stat(target).catch(() => null);
  return info?.isFile() ? target : null;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let file = await resolveFile(pathname);
  let served = pathname;
  // RT_59: lien profond — réécriture vers index.html.
  if (!file) {
    file = join(ROOT, 'index.html');
    served = '/index.html';
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.setHeader(
    'Cache-Control',
    HASHED.test(served) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`www/ servi sur http://localhost:${PORT}`);
});
