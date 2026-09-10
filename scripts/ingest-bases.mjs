#!/usr/bin/env node
// RT_02: script d'ingestion du référentiel unité -> socle.
//
// Génère `src/assets/referentials/bases.json` à partir de l'export CSV public
// de Wahapedia. Exécuté HORS-LIGNE (build / mise à jour du référentiel), jamais
// à l'exécution de l'application (EX_05) : le fichier produit est versionné
// avec l'application et rechargeable indépendamment du code.
//
// RT_02: l'export Wahapedia n'est pas une API garantie -> ce script échoue
// explicitement (exit != 0, aucun fichier écrit) plutôt que de produire un
// référentiel partiel en cas d'anomalie de format.
//
// Usage: node scripts/ingest-bases.mjs [--out <path>] [--from-dir <dir>]

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

const SOURCE = {
  name: 'Wahapedia',
  // RT_02 / CLAUDE.md: toute utilisation publique de cette donnée doit
  // mentionner « Powered by Wahapedia ». L'attribution voyage DANS la donnée
  // générée (RT_20) pour que l'écran Réglages n'ait rien à coder en dur.
  attribution: 'Powered by Wahapedia',
  url: 'https://wahapedia.ru/wh40k11ed/the-rules/data-export',
  baseUrl: 'https://wahapedia.ru/wh40k11ed',
  files: ['Datasheets.csv', 'Datasheets_models.csv'],
};

/** Colonnes minimales attendues : toute absence est une anomalie de format. */
const REQUIRED_COLUMNS = {
  'Datasheets.csv': ['id', 'name'],
  'Datasheets_models.csv': ['datasheet_id', 'line', 'name', 'base_size', 'base_size_descr'],
};

/** Garde-fous de volume : sous ces seuils, l'export est jugé anormal. */
const MIN_DATASHEETS = 500;
const MIN_MODEL_LINES = 500;
const MIN_RESOLVED_RATIO = 0.5;
/**
 * RT_02: quelques lignes de `Datasheets_models.csv` référencent un
 * `datasheet_id` absent de `Datasheets.csv` (entrées génériques du type
 * « Greater Daemon » — 4 lignes sur ~1765 au 2026-09-10). C'est un trou
 * d'intégrité de la source, pas un changement de format : ces lignes sont
 * écartées et comptées. Au-delà de ce seuil en revanche, les deux exports
 * sont structurellement désynchronisés et l'ingestion échoue explicitement.
 */
const MAX_ORPHAN_MODEL_RATIO = 0.01;

class IngestError extends Error {}

function fail(message) {
  throw new IngestError(message);
}

function parseArgs(argv) {
  const args = { out: join(PROJECT_ROOT, 'src/assets/referentials/bases.json'), fromDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = resolve(argv[++i] ?? fail('--out attend un chemin'));
    else if (argv[i] === '--from-dir') args.fromDir = resolve(argv[++i] ?? fail('--from-dir attend un chemin'));
    else fail(`Argument inconnu: ${argv[i]}`);
  }
  return args;
}

async function loadCsv(fileName, fromDir) {
  if (fromDir) {
    const path = join(fromDir, fileName);
    if (!existsSync(path)) fail(`Fichier source absent: ${path}`);
    return readFileSync(path, 'utf8');
  }
  const url = `${SOURCE.baseUrl}/${fileName}`;
  const res = await fetch(url);
  if (!res.ok) fail(`Téléchargement de ${url} en échec: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) fail(`Réponse vide pour ${url}`);
  return text;
}

/**
 * L'export Wahapedia est délimité par `|` sans échappement ni guillemets.
 * Toute ligne dont le nombre de colonnes ne correspond pas à l'en-tête est
 * une anomalie de format (RT_02) et interrompt l'ingestion.
 */
function parsePipeCsv(text, fileName) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) fail(`${fileName}: aucune ligne de données`);

  const header = lines[0].split('|').map((h) => h.trim());
  const missing = (REQUIRED_COLUMNS[fileName] ?? []).filter((c) => !header.includes(c));
  if (missing.length) {
    fail(
      `${fileName}: colonnes attendues absentes (${missing.join(', ')}). ` +
        `En-tête reçu: ${header.join(', ')}`,
    );
  }

  return lines.slice(1).map((line, idx) => {
    const cells = line.split('|');
    // L'export termine chaque ligne par un `|` -> une cellule vide finale,
    // déjà comptée dans l'en-tête. Tout autre écart est une anomalie.
    if (cells.length !== header.length) {
      fail(`${fileName}: ligne ${idx + 2} a ${cells.length} colonnes, ${header.length} attendues`);
    }
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/** Clé de rapprochement nom d'unité importée <-> nom de datasheet (RG_02). */
export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bw\/\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ROUND_RE = /^(\d+(?:\.\d+)?)\s*mm$/i;
const OVAL_RE = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm$/i;
/** Valeurs qui signifient explicitement « pas de socle officiel connu ». */
const UNRESOLVED_VALUES = ['', 'use model', 'no official base size'];

/**
 * RT_02 / RG_02: traduit la valeur brute `base_size` en forme + dimensions.
 * Renvoie `null` quand l'export ne porte pas de socle exploitable : l'unité
 * sera signalée au joueur pour assignation manuelle (RG_02), jamais devinée.
 */
export function parseBaseSize(raw) {
  const value = String(raw ?? '').trim();
  if (UNRESOLVED_VALUES.includes(value.toLowerCase())) return null;

  const flying = /flying base/i.test(value);
  const dims = value.replace(/flying base/i, '').trim();

  const oval = OVAL_RE.exec(dims);
  if (oval) {
    const [, a, b] = oval;
    return { shape: 'oval', widthMm: Number(b), lengthMm: Number(a), flying, raw: value };
  }

  const round = ROUND_RE.exec(dims);
  if (round) {
    const d = Number(round[1]);
    return { shape: 'round', widthMm: d, lengthMm: d, flying, raw: value };
  }

  // Format inconnu : ni rond, ni ovale, ni « pas de socle ». On ne devine pas.
  return null;
}

/**
 * RT_02: mots vides et radical — dupliqués de
 * `src/app/referentials/base-matching.ts`. Les termes produits ici sont
 * comparés token pour token, à l'exécution, à ceux d'un profil importé : les
 * deux découpages doivent rester identiques.
 */
const STOP_WORDS = new Set(['and', 'the', 'of', 'with', 'or', 'a']);

function stem(token) {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}

export function nameTokens(name) {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t && !STOP_WORDS.has(t))
    .map(stem);
}

/** Une taille de socle citée au fil du texte de `base_size_descr`. */
const SIZE_IN_NOTE_RE = /\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*mm|\d+(?:\.\d+)?\s*mm/gi;
/** Le texte qui suit la taille ne peut être qu'une condition d'équipement. */
const CONDITION_LEAD_RE = /^(?:if|when|whilst|with)\b/i;
const CONDITION_FILLER_RE =
  /^(?:(?:if|when|whilst|equipped|armed|using|carrying|has|have|is|are|it|they|with)\b\s*)+/i;

/**
 * RG_02/RT_02: interprète `base_size_descr`, qui porte en texte libre les
 * exceptions au `base_size` de la ligne de modèle. Deux tournures couvrent
 * l'intégralité du corpus :
 *
 * - « <sujet> <taille> » — un modèle nommé de la ligne prend un autre socle
 *   (« Gun servitors 32mm », « Cyber-mastiff 25mm ») ;
 * - « <taille> if/with <équipement> » — l'équipement déclenche un autre socle
 *   (« 60 x 35mm if equipped with transuranic arquebus »), éventuellement
 *   combiné à un sujet (« Navis Armsman 28mm if armed with meltagun or
 *   plasmagun »).
 *
 * Renvoie `{ variant, base }` pour une note exploitable, `{ variant: null }`
 * pour une note présente mais non interprétable — la ligne part alors en
 * assignation manuelle (RG_02) plutôt que de voir son socle par défaut
 * appliqué à des modèles que la note en exclut peut-être — et `null` quand
 * il n'y a pas de note du tout.
 */
export function parseBaseSizeNote(note, datasheetName) {
  const raw = String(note ?? '').trim();
  if (!raw) return null;
  // La source elle-même hésite (« ...(60 x 35mm)? ») : on ne tranche pas.
  if (raw.includes('?')) return { variant: null };

  const sizes = raw.match(SIZE_IN_NOTE_RE);
  if (!sizes || sizes.length !== 1) return { variant: null };
  const base = parseBaseSize(sizes[0]);
  if (!base) return { variant: null };

  const at = raw.indexOf(sizes[0]);
  const before = raw.slice(0, at).trim();
  const after = raw.slice(at + sizes[0].length).trim();

  let conditions = [];
  if (after) {
    if (!CONDITION_LEAD_RE.test(after)) return { variant: null };
    const text = after.replace(CONDITION_FILLER_RE, '').trim();
    if (!text) return { variant: null };
    // « meltagun or plasmagun » : chaque alternative suffit à elle seule.
    conditions = text
      .split(/\bor\b/i)
      .map(nameTokens)
      .filter((terms) => terms.length > 0);
    if (conditions.length === 0) return { variant: null };
  }

  // Les mots que le nom de la datasheet porte déjà ne discriminent pas les
  // profils entre eux : « Gun servitors » dans « Servitor Battleclade » se
  // réduit à « gun », et « Kill Team Infiltrators... » dans « Spectrus Kill
  // Team » à « infiltrator bolt sniper rifle ».
  // « Dishonoured model 40mm » : le roster nomme le profil « Dishonoured »,
  // pas « Dishonoured model » — ce mot générique ne discrimine rien.
  const sheetTerms = new Set([...nameTokens(datasheetName), 'model']);
  const subject = nameTokens(before).filter((term) => !sheetTerms.has(term));

  // Ni sujet ni condition : la note ne dit pas à quels modèles de la ligne
  // elle s'applique.
  if (subject.length === 0 && conditions.length === 0) return { variant: null };

  return {
    base,
    variant: {
      baseShapeId: baseShapeId(base),
      rawBaseSize: base.raw,
      subject,
      conditions,
      raw,
    },
  };
}

/** Identifiant stable de socle, réutilisé comme `baseShapeId` (RG_02/RT_04). */
export function baseShapeId(base) {
  if (!base) return null;
  const dims = base.shape === 'oval' ? `${base.lengthMm}x${base.widthMm}` : `${base.widthMm}`;
  return `${base.shape}-${dims}${base.flying ? '-flying' : ''}`.replace(/\./g, '_');
}

function build(datasheetRows, modelRows) {
  if (datasheetRows.length < MIN_DATASHEETS) {
    fail(`Datasheets.csv: ${datasheetRows.length} datasheets (< ${MIN_DATASHEETS} attendus)`);
  }
  if (modelRows.length < MIN_MODEL_LINES) {
    fail(`Datasheets_models.csv: ${modelRows.length} lignes (< ${MIN_MODEL_LINES} attendues)`);
  }

  const namesById = new Map();
  for (const row of datasheetRows) {
    if (!row.id) fail('Datasheets.csv: une ligne sans `id`');
    if (!row.name) fail(`Datasheets.csv: datasheet ${row.id} sans \`name\``);
    namesById.set(row.id, row.name);
  }

  const byDatasheet = new Map();
  const shapes = new Map();
  const orphanDatasheetIds = new Set();
  let orphanLines = 0;
  let resolvedLines = 0;
  let notedLines = 0;
  let variantLines = 0;
  const unparsedNotes = new Set();

  /** Toute forme citée — par `base_size` ou par une note — doit être publiée. */
  const registerShape = (base) => {
    const id = baseShapeId(base);
    if (id && !shapes.has(id)) {
      shapes.set(id, {
        id,
        shape: base.shape,
        widthMm: base.widthMm,
        lengthMm: base.lengthMm,
        flying: base.flying,
        label: base.raw,
      });
    }
    return id;
  };

  for (const row of modelRows) {
    const datasheetName = namesById.get(row.datasheet_id);
    // Ligne de modèle orpheline : tolérée jusqu'au seuil défini plus haut,
    // puis vérifiée après la boucle (MAX_ORPHAN_MODEL_RATIO).
    if (!datasheetName) {
      orphanDatasheetIds.add(row.datasheet_id);
      orphanLines += 1;
      continue;
    }

    const base = parseBaseSize(row.base_size);
    const id = base ? registerShape(base) : null;
    if (base) resolvedLines += 1;

    // RG_02: exceptions portées en texte libre par `base_size_descr`.
    const note = row.base_size_descr || undefined;
    const parsedNote = parseBaseSizeNote(note, datasheetName);
    if (parsedNote) notedLines += 1;
    if (parsedNote?.variant) {
      variantLines += 1;
      registerShape(parsedNote.base);
    } else if (parsedNote) {
      unparsedNotes.add(note);
    }

    if (!byDatasheet.has(row.datasheet_id)) {
      byDatasheet.set(row.datasheet_id, {
        name: datasheetName,
        key: normalizeName(datasheetName),
        models: [],
      });
    }
    byDatasheet.get(row.datasheet_id).models.push({
      name: row.name,
      key: normalizeName(row.name),
      baseShapeId: id,
      // Conservé tel quel : sert à expliquer au joueur pourquoi une unité
      // reste non résolue (RG_02) et à tracer les cas « Use model ».
      rawBaseSize: row.base_size,
      baseSizeNote: note,
      // RG_02: socles conditionnels applicables à une partie des modèles de
      // la ligne, dérivés de la note ci-dessus.
      baseVariants: parsedNote?.variant ? [parsedNote.variant] : undefined,
      // Note présente mais non interprétable : le socle par défaut ne peut
      // pas être appliqué en confiance -> assignation manuelle (RG_02).
      baseNoteUnresolved: parsedNote && !parsedNote.variant ? true : undefined,
    });
  }

  const orphanRatio = orphanLines / modelRows.length;
  if (orphanRatio > MAX_ORPHAN_MODEL_RATIO) {
    fail(
      `${orphanLines} lignes de modèle (${(orphanRatio * 100).toFixed(1)}%) référencent un ` +
        `datasheet_id absent de Datasheets.csv (> ${MAX_ORPHAN_MODEL_RATIO * 100}%) : ` +
        `les deux exports sont désynchronisés`,
    );
  }

  const ratio = resolvedLines / modelRows.length;
  if (ratio < MIN_RESOLVED_RATIO) {
    fail(
      `Seulement ${(ratio * 100).toFixed(1)}% des lignes de modèle ont un socle exploitable ` +
        `(< ${MIN_RESOLVED_RATIO * 100}%) : format de \`base_size\` probablement modifié`,
    );
  }

  const datasheets = [...byDatasheet.values()].sort((a, b) => a.name.localeCompare(b.name));

  const seen = new Set();
  const duplicateKeys = new Set();
  for (const ds of datasheets) {
    if (seen.has(ds.key)) duplicateKeys.add(ds.key);
    seen.add(ds.key);
  }

  return {
    // RT_20: l'attribution est embarquée dans la donnée elle-même, pas dans
    // l'écran Réglages qui se contente d'énumérer les référentiels présents.
    source: {
      name: SOURCE.name,
      attribution: SOURCE.attribution,
      url: SOURCE.url,
      files: SOURCE.files,
    },
    generatedAt: new Date().toISOString(),
    stats: {
      datasheets: datasheets.length,
      modelLines: modelRows.length,
      resolvedModelLines: resolvedLines,
      baseShapes: shapes.size,
      orphanModelLines: orphanLines,
      orphanDatasheetIds: [...orphanDatasheetIds].sort(),
      // RG_02: lignes portant une note `base_size_descr`, et celles dont la
      // note a pu être traduite en socle conditionnel.
      notedModelLines: notedLines,
      variantModelLines: variantLines,
      // Notes non interprétables : matière à revoir la grammaire de
      // `parseBaseSizeNote` si la liste s'allonge d'une tournure récurrente.
      unparsedBaseNotes: [...unparsedNotes].sort(),
      // Noms de datasheet homonymes : le rapprochement RG_02 reste ambigu
      // pour ceux-là, l'unité passera par l'assignation manuelle.
      ambiguousNames: [...duplicateKeys].sort(),
    },
    baseShapes: [...shapes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    datasheets,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [datasheetsCsv, modelsCsv] = await Promise.all([
    loadCsv('Datasheets.csv', args.fromDir),
    loadCsv('Datasheets_models.csv', args.fromDir),
  ]);

  const referential = build(
    parsePipeCsv(datasheetsCsv, 'Datasheets.csv'),
    parsePipeCsv(modelsCsv, 'Datasheets_models.csv'),
  );

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(referential)}\n`, 'utf8');

  const { stats } = referential;
  console.log(`[ingest-bases] ${args.out}`);
  console.log(
    `[ingest-bases] ${stats.datasheets} datasheets, ${stats.modelLines} lignes de modèle, ` +
      `${stats.resolvedModelLines} avec socle, ${stats.baseShapes} socles distincts`,
  );
  console.log(
    `[ingest-bases] ${stats.notedModelLines} ligne(s) avec note de socle, ` +
      `${stats.variantModelLines} traduite(s) en socle conditionnel, ` +
      `${stats.unparsedBaseNotes.length} note(s) non interprétable(s)`,
  );
  for (const note of stats.unparsedBaseNotes) {
    console.log(`[ingest-bases]   note non interprétée: « ${note} »`);
  }
  if (stats.ambiguousNames.length) {
    console.log(`[ingest-bases] ${stats.ambiguousNames.length} nom(s) de datasheet homonyme(s)`);
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    // RT_02: échec explicite, aucun fichier écrit.
    console.error(`[ingest-bases] ÉCHEC — référentiel non généré : ${err.message}`);
    process.exit(1);
  });
}
