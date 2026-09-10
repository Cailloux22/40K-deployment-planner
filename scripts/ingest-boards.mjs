#!/usr/bin/env node
// RT_12: script d'ingestion du référentiel des plateaux.
//
// Génère `src/assets/referentials/boards.json` + les images de plateaux dans
// `src/assets/referentials/boards/`, à partir des images statiques publiées
// sur gdmissions.app. Exécuté HORS-LIGNE (build / mise à jour du référentiel),
// jamais à l'exécution de l'application (EX_05) : le résultat est versionné
// avec l'application pour que la planification reste utilisable sans réseau.
//
// RT_12: gdmissions.app n'expose pas d'API stable -> ce script échoue
// explicitement (exit != 0) plutôt que de produire un référentiel partiel dès
// qu'une combinaison de dispositions ou une variante manque.
//
// Usage: node scripts/ingest-boards.mjs [--out-dir <dir>] [--metadata-only]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOARD_HEIGHT_INCHES,
  BOARD_WIDTH_INCHES,
  decodePng,
  detectPlayArea,
} from './lib/board-play-area.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

const SOURCE = {
  name: 'Battlemaster',
  // RT_12 / CLAUDE.md: toute utilisation publique de ces plateaux doit créditer
  // Battlemaster. L'attribution voyage DANS la donnée générée (RT_20).
  attribution: 'Deployment maps by Battlemaster (battlemaster.online), via gdmissions.app',
  url: 'https://battlemaster.online',
  via: 'https://gdmissions.app/11th/layouts',
  baseUrl: 'https://gdmissions.app/assets/11th/layouts',
};

// RT_23: les 5 dispositions de force. Ce script n'utilise que leur `slug`
// gdmissions ; le référentiel applicatif (libellés, icônes) vit à part dans
// `src/assets/referentials/dispositions.json`.
const DISPOSITION_SLUGS = [
  'take-and-hold',
  'purge-the-foe',
  'reconnaissance',
  'priority-assets',
  'disruption',
];

const VARIANTS = ['no-measurements', 'with-measurements'];
const LAYOUT_INDEXES = [1, 2, 3];

// RT_19: tous les assets du référentiel sont livrés aux mêmes dimensions, ce
// qui autorise un facteur d'échelle unique sur l'écran de placement. Le script
// le vérifie sur chaque image téléchargée plutôt que de le supposer.
const EXPECTED_WIDTH = 1653;
const EXPECTED_HEIGHT = 2833;

class IngestError extends Error {}

function fail(message) {
  throw new IngestError(message);
}

function parseArgs(argv) {
  const args = {
    outDir: join(PROJECT_ROOT, 'src/assets/referentials'),
    metadataOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out-dir') args.outDir = resolve(argv[++i] ?? fail('--out-dir attend un chemin'));
    else if (argv[i] === '--metadata-only') args.metadataOnly = true;
    else fail(`Argument inconnu: ${argv[i]}`);
  }
  return args;
}

/**
 * Le nom de fichier d'un plateau n'encode pas « joueur vs adversaire » mais un
 * couple NON ORDONNÉ, publié dans un seul des deux ordres possibles (et
 * `{disposition}-mirror-{n}` quand les deux dispositions sont identiques). Le
 * suffixe `-portrait` est présent sur certains assets seulement.
 *
 * Plutôt que de coder en dur l'ordre retenu par le site — qui changerait sans
 * préavis — on énumère les noms candidats et on retient celui qui répond.
 */
function candidateFileNames(a, b, index) {
  const pairs = a === b ? [`${a}-mirror-${index}`] : [`${a}-vs-${b}-${index}`, `${b}-vs-${a}-${index}`];
  return pairs.flatMap((stem) => [`${stem}.png`, `${stem}-portrait.png`]);
}

/** Clé de référentiel indépendante de l'ordre du couple de dispositions. */
export function pairKey(a, b) {
  return [a, b].sort().join('__');
}

/** Identifiant stable de plateau (RG_14/RT_04 : sert de `boardId`). */
export function boardId(a, b, index) {
  return `${pairKey(a, b)}__${index}`;
}

function pngDimensions(buffer) {
  const PNG_MAGIC = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== PNG_MAGIC) {
    fail('Contenu téléchargé non reconnu comme PNG');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Écart maximal toléré entre les zones de jeu des deux variantes d'un plateau. */
const PLAY_AREA_TOLERANCE_PX = 3;

/**
 * RT_05: mesure le rectangle du plateau dans l'image, seule façon d'obtenir
 * l'échelle mm <-> pixels — l'image porte aussi un bandeau de titre et une
 * légende, donc ses dimensions ne suffisent pas.
 */
function measure(fileName, variant, buffer) {
  try {
    return detectPlayArea(decodePng({ buffer, path: `${variant}/${fileName}` }));
  } catch (err) {
    fail(`${variant}/${fileName}: zone de jeu non mesurable — ${err.message}`);
  }
}

function assertSamePlayArea(fileName, reference, other) {
  for (const key of ['left', 'top', 'right', 'bottom']) {
    if (Math.abs(reference[key] - other[key]) > PLAY_AREA_TOLERANCE_PX) {
      fail(
        `${fileName}: les deux variantes ne cadrent pas le plateau au même endroit ` +
          `(${key}: ${reference[key]} vs ${other[key]})`,
      );
    }
  }
}

async function fetchAsset(variant, fileName) {
  const url = `${SOURCE.baseUrl}/${variant}/${fileName}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { url, fileName, buffer };
}

/** Résout le nom d'asset réellement publié pour un triplet (a, b, index). */
async function resolveFileName(a, b, index) {
  const tried = [];
  for (const fileName of candidateFileNames(a, b, index)) {
    tried.push(fileName);
    // La variante `no-measurements` fait référence : `with-measurements`
    // réutilise exactement le même nom de fichier (vérifié ci-dessous).
    const asset = await fetchAsset('no-measurements', fileName);
    if (asset) return { fileName, asset };
  }
  fail(
    `Aucun asset publié pour (${a}, ${b}) plateau ${index}. Noms essayés: ${tried.join(', ')}. ` +
      `La convention de nommage de gdmissions.app a probablement changé.`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assetDir = join(args.outDir, 'boards');
  if (!args.metadataOnly) mkdirSync(assetDir, { recursive: true });

  const combinations = [];
  for (let i = 0; i < DISPOSITION_SLUGS.length; i += 1) {
    for (let j = i; j < DISPOSITION_SLUGS.length; j += 1) {
      combinations.push([DISPOSITION_SLUGS[i], DISPOSITION_SLUGS[j]]);
    }
  }

  const boards = [];
  let downloaded = 0;

  for (const [a, b] of combinations) {
    for (const index of LAYOUT_INDEXES) {
      const { fileName, asset } = await resolveFileName(a, b, index);
      const variantFiles = {};
      let playArea = null;

      for (const variant of VARIANTS) {
        const fetched = variant === 'no-measurements' ? asset : await fetchAsset(variant, fileName);
        if (!fetched) {
          fail(`Variante ${variant} absente pour ${fileName} : référentiel incomplet`);
        }

        const { width, height } = pngDimensions(fetched.buffer);
        // RT_19: le zoom fixe de l'écran de placement suppose des dimensions
        // identiques sur tout le référentiel. On échoue si ce n'est plus vrai.
        if (width !== EXPECTED_WIDTH || height !== EXPECTED_HEIGHT) {
          fail(
            `${variant}/${fileName}: dimensions ${width}x${height}, ` +
              `${EXPECTED_WIDTH}x${EXPECTED_HEIGHT} attendues (hypothèse RT_19 invalidée)`,
          );
        }

        // RT_05: les deux variantes d'un même plateau doivent cadrer le
        // plateau identiquement, sinon les tokens ne seraient pas placés au
        // même endroit selon la vue.
        const measured = measure(fileName, variant, fetched.buffer);
        if (playArea) assertSamePlayArea(fileName, playArea, measured);
        else playArea = measured;

        const localName = `${variant}/${fileName}`;
        variantFiles[variant] = `assets/referentials/boards/${localName}`;

        if (!args.metadataOnly) {
          mkdirSync(join(assetDir, variant), { recursive: true });
          writeFileSync(join(assetDir, localName), fetched.buffer);
          downloaded += 1;
        }
      }

      boards.push({
        id: boardId(a, b, index),
        pairKey: pairKey(a, b),
        dispositions: [a, b].sort(),
        mirror: a === b,
        index,
        sourceFileName: fileName,
        width: EXPECTED_WIDTH,
        height: EXPECTED_HEIGHT,
        // RT_05: rectangle du plateau dans l'image, et sa taille physique —
        // ensemble, ils donnent l'échelle mm -> pixels des tokens.
        playArea,
        // RT_16: variante `with-measurements` pour la consultation du plateau
        // seul, `no-measurements` pour la consultation d'un déploiement.
        assets: variantFiles,
      });
    }
  }

  // RG_03 étape 2: exactement 3 plateaux pour chaque couple de dispositions.
  const perPair = new Map();
  for (const board of boards) {
    perPair.set(board.pairKey, (perPair.get(board.pairKey) ?? 0) + 1);
  }
  const expectedPairs = (DISPOSITION_SLUGS.length * (DISPOSITION_SLUGS.length + 1)) / 2;
  if (perPair.size !== expectedPairs) {
    fail(`${perPair.size} couples de dispositions générés, ${expectedPairs} attendus`);
  }
  for (const [key, count] of perPair) {
    if (count !== LAYOUT_INDEXES.length) {
      fail(`Couple ${key}: ${count} plateaux, ${LAYOUT_INDEXES.length} attendus (RG_03 étape 2)`);
    }
  }

  const referential = {
    // RT_20: attribution embarquée dans la donnée, énumérée telle quelle par
    // l'écran Réglages (RG_18).
    source: {
      name: SOURCE.name,
      attribution: SOURCE.attribution,
      url: SOURCE.url,
      via: SOURCE.via,
    },
    generatedAt: new Date().toISOString(),
    // RT_19: dimensions communes à tous les assets, consommées telles quelles
    // par le calcul de zoom « contain-fit » de l'écran de placement.
    assetSize: { width: EXPECTED_WIDTH, height: EXPECTED_HEIGHT },
    // RT_05: dimensions physiques du plateau représenté, communes à tous les
    // assets ; combinées au `playArea` de chaque plateau, elles fixent
    // l'échelle de rendu des tokens.
    boardInches: { width: BOARD_WIDTH_INCHES, height: BOARD_HEIGHT_INCHES },
    variants: VARIANTS,
    stats: { pairs: perPair.size, boards: boards.length, files: boards.length * VARIANTS.length },
    boards,
  };

  const outFile = join(args.outDir, 'boards.json');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(referential)}\n`, 'utf8');

  console.log(`[ingest-boards] ${outFile}`);
  console.log(
    `[ingest-boards] ${perPair.size} couples, ${boards.length} plateaux, ` +
      `${args.metadataOnly ? 'aucune image écrite (--metadata-only)' : `${downloaded} images écrites`}`,
  );
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    // RT_12: échec explicite, référentiel non généré.
    console.error(`[ingest-boards] ÉCHEC — référentiel non généré : ${err.message}`);
    process.exit(1);
  });
}
