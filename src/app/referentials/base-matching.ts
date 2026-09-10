/**
 * RG_02 — rapprochement d'un nom importé (RT_13) avec le référentiel de
 * socles (RT_02). Fonctions pures, sans dépendance Angular, pour rester
 * testables isolément et réutilisables par le script d'ingestion.
 */

import {
  ReferentialBaseVariant,
  ReferentialDatasheet,
  ReferentialModelLine,
} from '../models/referential.models';

/**
 * Normalisation identique à celle du script d'ingestion
 * (`scripts/ingest-bases.mjs`) : les clés du référentiel généré et celles
 * calculées ici doivent coïncider exactement.
 */
export function normalizeName(name: string): string {
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

/** Mots vides du domaine : ils ne discriminent pas deux profils de modèle. */
const STOP_WORDS = new Set(['and', 'the', 'of', 'with', 'or', 'a']);

/** Radical grossier : neutralise le seul pluriel, suffisant pour ce corpus. */
function stem(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}

function tokens(key: string): string[] {
  return key
    .split(' ')
    .filter((t) => t && !STOP_WORDS.has(t))
    .map(stem);
}

/** Nombre de mots significatifs partagés par deux noms normalisés. */
export function tokenOverlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  let shared = 0;
  for (const token of new Set(tokens(b))) {
    if (left.has(token)) shared += 1;
  }
  return shared;
}

/**
 * RG_02: sélectionne la datasheet correspondant à un nom d'unité importé.
 *
 * Plusieurs datasheets peuvent porter le même nom (homonymes inter-factions).
 * Tant qu'elles décrivent les mêmes socles, le choix est indifférent ; si
 * elles divergent, on refuse de deviner et l'unité part en assignation
 * manuelle (`null`).
 */
export function findDatasheet(
  datasheets: readonly ReferentialDatasheet[],
  unitName: string,
): ReferentialDatasheet | null {
  const key = normalizeName(unitName);
  const matches = datasheets.filter((d) => d.key === key);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Seul le socle compte : des homonymes qui n'en décrivent qu'un seul, le
  // même, sont interchangeables même si leurs lignes portent des noms
  // différents (« Chaos Terminators » / « Terminator Squad », 40 mm dans les
  // deux cas).
  const bases = new Set(
    matches.flatMap((d) =>
      d.models.flatMap((m) => [m.baseShapeId, ...(m.baseVariants ?? []).map((v) => v.baseShapeId)]),
    ),
  );
  if (bases.size === 1) return matches[0];

  const signature = (d: ReferentialDatasheet) =>
    JSON.stringify(
      d.models
        .map((m) => [m.key, m.baseShapeId] as const)
        .slice()
        .sort((x, y) => x[0].localeCompare(y[0])),
    );
  const reference = signature(matches[0]);
  return matches.every((d) => signature(d) === reference) ? matches[0] : null;
}

/**
 * RG_02: choisit la ligne de modèle d'une datasheet correspondant à un profil
 * importé. Les noms importés portent le détail d'équipement (« Skitarii
 * Ranger w/ arc rifle ») alors que le référentiel reste généraliste
 * (« Skitarii Rangers ») : on tente donc, dans l'ordre, l'égalité exacte,
 * l'inclusion, puis le recouvrement de mots.
 *
 * Renvoie `null` quand la datasheet décrit plusieurs socles différents et
 * qu'aucun rapprochement ne se dégage : le socle est alors assigné à la main
 * par le joueur plutôt que deviné.
 */
export function findModelLine(
  datasheet: ReferentialDatasheet,
  modelName: string,
): ReferentialModelLine | null {
  const lines = datasheet.models;
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0];

  const key = normalizeName(modelName);

  const exact = lines.find((l) => l.key === key);
  if (exact) return exact;

  const contained = lines.filter((l) => l.key && (key.includes(l.key) || l.key.includes(key)));
  if (contained.length === 1) return contained[0];

  let best: ReferentialModelLine | null = null;
  let bestScore = 0;
  let tied = false;
  for (const line of lines) {
    const score = tokenOverlap(key, line.key);
    if (score > bestScore) {
      best = line;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  if (best && bestScore > 0 && !tied) return best;

  // Aucun rapprochement fiable : si toutes les lignes partagent le même
  // socle, le choix est sans conséquence ; sinon on ne devine pas.
  const uniqueBases = new Set(lines.map((l) => l.baseShapeId));
  return uniqueBases.size === 1 ? lines[0] : null;
}

/**
 * RG_02: applique les socles conditionnels d'une ligne de modèle (RT_02,
 * dérivés de `base_size_descr`) à un profil importé.
 *
 * Une ligne du référentiel peut couvrir plusieurs modèles aux socles
 * différents — « Combat Servitors and Gun Servitors » : 25 mm, mais 32 mm
 * pour les Gun Servitors ; « Skitarii Rangers » : 25 mm, mais 60 × 35 mm
 * pour le porteur d'arquebuse transuranique. La variante retenue est celle
 * dont la désignation et, le cas échéant, l'équipement déclencheur se
 * retrouvent dans le nom du profil ou dans son équipement (RT_13). À défaut,
 * `null` : le socle par défaut de la ligne s'applique.
 */
export function matchBaseVariant(
  line: ReferentialModelLine,
  modelName: string,
  equipment: readonly string[] = [],
): ReferentialBaseVariant | null {
  const variants = line.baseVariants ?? [];
  if (variants.length === 0) return null;

  const terms = new Set<string>();
  for (const name of [modelName, ...equipment]) {
    for (const token of tokens(normalizeName(name))) terms.add(token);
  }
  const holds = (required: readonly string[]) => required.every((term) => terms.has(term));

  return (
    variants.find(
      (variant) =>
        holds(variant.subject) &&
        (variant.conditions.length === 0 || variant.conditions.some(holds)),
    ) ?? null
  );
}
