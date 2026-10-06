#!/usr/bin/env node
// RT_64: script d'ingestion du référentiel des missions primaires.
//
// Génère `src/assets/referentials/missions.json` + les images des cartes dans
// `src/assets/referentials/missions/`, à partir des pages et images statiques
// publiées sur gdmissions.app. Exécuté HORS-LIGNE, jamais par l'application
// (EX_05). RT_65: à l'exécution, l'application appelle directement les URLs
// distantes enregistrées ici (`remoteAsset`) ; les images écrites par ce
// script servent de version embarquée de dernier recours (RG_49).
//
// RT_64: gdmissions.app n'expose pas d'API stable -> ce script échoue
// explicitement (exit != 0) plutôt que de produire un référentiel partiel dès
// que la matrice 5 × 5 des cartes est incomplète ou ambiguë.
//
// Usage: node scripts/ingest-missions.mjs [--out-dir <dir>]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

const SITE = 'https://gdmissions.app';
const SOURCE = {
  name: 'gdmissions.app',
  // RG_49 / RT_20: l'attribution voyage DANS la donnée générée. Son texte
  // exact reste une décision ouverte (spec.md, « Suivi des décisions non
  // tranchées ») : celui-ci est provisoire.
  attribution: 'Primary mission cards (GDM 2026) via gdmissions.app',
  url: `${SITE}/11th/primary-missions`,
};

// RT_23 / RT_64: les 5 dispositions de force. Leur identifiant est aussi le
// segment d'URL gdmissions ; le libellé sert à lire la disposition adverse
// annoncée sur la page de chaque carte.
const DISPOSITIONS = [
  { id: 'take-and-hold', label: 'Take and Hold' },
  { id: 'purge-the-foe', label: 'Purge the Foe' },
  { id: 'reconnaissance', label: 'Reconnaissance' },
  { id: 'priority-assets', label: 'Priority Assets' },
  { id: 'disruption', label: 'Disruption' },
];

class IngestError extends Error {}

function fail(message) {
  throw new IngestError(message);
}

function parseArgs(argv) {
  const args = { outDir: join(PROJECT_ROOT, 'src/assets/referentials') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out-dir') args.outDir = resolve(argv[++i] ?? fail('--out-dir attend un chemin'));
    else fail(`Argument inconnu: ${argv[i]}`);
  }
  return args;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return res.text();
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** Texte visible d'une page : balises retirées, blancs ramenés à un espace. */
function visibleText(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** RT_64: les cartes d'un jeu, énumérées depuis la page du jeu. */
function cardSlugs(deckHtml, deck) {
  const pattern = new RegExp(`/11th/primary-missions/${deck}/([a-z0-9-]+)`, 'g');
  return [...new Set([...deckHtml.matchAll(pattern)].map((match) => match[1]))];
}

/**
 * RT_64: nom de la carte et disposition adverse visée, lus sur la page de la
 * carte — « Opponent · {disposition} », ou « Mirror · {disposition} » pour la
 * carte miroir.
 */
function parseCardPage(html, deck, slug) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const name = title ? decodeEntities(title).split(' - ')[0].trim() : '';
  if (!name) fail(`${deck}/${slug}: nom de carte introuvable`);

  const labels = DISPOSITIONS.map((d) => d.label).join('|');
  const match = visibleText(html).match(new RegExp(`\\b(Opponent|Mirror) · (${labels})\\b`));
  if (!match) fail(`${deck}/${slug}: disposition adverse non indiquée`);
  const opponent = DISPOSITIONS.find((d) => d.label === match[2]).id;
  if (match[1] === 'Mirror' && opponent !== deck) {
    fail(`${deck}/${slug}: carte miroir d'une autre disposition (${opponent})`);
  }
  return { name, opponent };
}

function pngDimensions(buffer, label) {
  const PNG_MAGIC = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== PNG_MAGIC) {
    fail(`${label}: contenu téléchargé non reconnu comme PNG`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assetDir = join(args.outDir, 'missions');
  const missions = [];
  const images = [];

  for (const { id: deck } of DISPOSITIONS) {
    const slugs = cardSlugs(await fetchText(`${SITE}/11th/primary-missions/${deck}`), deck);
    // RT_64: exactement une carte par disposition adverse possible.
    if (slugs.length !== DISPOSITIONS.length) {
      fail(`Jeu ${deck}: ${slugs.length} cartes, ${DISPOSITIONS.length} attendues`);
    }

    const opponents = new Set();
    for (const slug of slugs) {
      const { name, opponent } = parseCardPage(
        await fetchText(`${SITE}/11th/primary-missions/${deck}/${slug}`),
        deck,
        slug,
      );
      if (opponents.has(opponent)) fail(`Jeu ${deck}: deux cartes visent ${opponent}`);
      opponents.add(opponent);

      const remoteAsset = `${SITE}/assets/11th/primary-missions/${deck}/${slug}.png`;
      const res = await fetch(remoteAsset);
      if (!res.ok) fail(`${remoteAsset}: HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const { width, height } = pngDimensions(buffer, remoteAsset);

      images.push({ path: join(assetDir, deck, `${slug}.png`), buffer });
      missions.push({
        id: `${deck}/${slug}`,
        name,
        disposition: deck,
        opponent,
        // RT_65: une image distante n'est acceptée qu'à ces dimensions.
        width,
        height,
        asset: `assets/referentials/missions/${deck}/${slug}.png`,
        remoteAsset,
      });
    }
  }

  // Tout est vérifié avant la moindre écriture : jamais de référentiel partiel.
  for (const { path, buffer } of images) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
  }

  const referential = {
    // RT_20: attribution embarquée dans la donnée, énumérée telle quelle par
    // l'écran Réglages (RG_18).
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    missions,
  };
  const outFile = join(args.outDir, 'missions.json');
  writeFileSync(outFile, `${JSON.stringify(referential, null, 2)}\n`, 'utf8');

  console.log(`[ingest-missions] ${outFile}`);
  console.log(`[ingest-missions] ${missions.length} cartes, ${images.length} images écrites`);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    // RT_64: échec explicite, référentiel non généré.
    console.error(`[ingest-missions] ÉCHEC — référentiel non généré : ${err.message}`);
    process.exit(1);
  });
}
