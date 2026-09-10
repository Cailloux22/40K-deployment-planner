/**
 * RT_13 — parseur du format « roster JSON » BattleScribe / NewRecruit.
 *
 * Fonction pure, sans dépendance Angular ni réseau : elle ne consomme que
 * `roster.name`, le nœud « Force Disposition » et les champs
 * `name`/`number`/`type` des sélections de premier niveau, de leurs enfants
 * directs de `type = "model"` et des `type = "upgrade"` que ces modèles
 * portent (l'équipement, dont dépendent certains socles — RG_02). Tout le
 * reste de l'arborescence (`rules`, `profiles`, `categories`, coûts) est
 * ignoré.
 *
 * RG_01: un import qui ne peut pas être interprété est rejeté avec un message
 * explicite — jamais interprété partiellement.
 */

/** Profil de modèle d'une unité : un nom et un nombre de modèles. */
export interface ParsedModelProfile {
  readonly name: string;
  readonly count: number;
  /**
   * RG_02: noms des équipements portés par le profil (`type = "upgrade"`
   * sous le modèle). Le socle en dépend parfois — « 60 x 35mm if equipped
   * with transuranic arquebus » (RT_02) — et le nom du profil ne cite pas
   * toujours l'arme qui le déclenche.
   */
  readonly equipment: readonly string[];
}

export interface ParsedUnit {
  readonly name: string;
  /** RT_13: somme des `number` des profils, ou `number` d'une entrée `model`. */
  readonly modelCount: number;
  readonly modelProfiles: readonly ParsedModelProfile[];
}

export interface ParsedRoster {
  /** `roster.name` — pré-remplissage éditable du récapitulatif (RG_22). */
  readonly name: string;
  /** Libellé de la disposition choisie, à rapprocher de RT_23. */
  readonly forceDispositionName: string;
  readonly units: readonly ParsedUnit[];
}

/** RG_01: erreur d'import porteuse d'un message affichable au joueur. */
export class RosterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterParseError';
  }
}

const FORCE_DISPOSITION = 'Force Disposition';
/** RT_13: les catégories de configuration sont de `type = "upgrade"`. */
const UNIT_TYPES = ['unit', 'model'];

interface RawSelection {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly number?: unknown;
  readonly from?: unknown;
  readonly group?: unknown;
  readonly selections?: unknown;
}

function asArray(value: unknown): RawSelection[] {
  return Array.isArray(value) ? (value as RawSelection[]) : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `number` peut arriver en entier ou en chaîne selon le list-builder. */
function asCount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(asString(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * RT_13: équipement d'un modèle — les `type = "upgrade"` situés sous lui, à
 * tout niveau (certains list-builders les regroupent sous un nœud
 * intermédiaire du type « Ranged weapons »).
 */
function collectEquipment(selection: RawSelection, into: string[] = []): string[] {
  for (const child of asArray(selection.selections)) {
    if (asString(child.type) === 'upgrade') {
      const name = asString(child.name);
      if (name) into.push(name);
    }
    collectEquipment(child, into);
  }
  return into;
}

/**
 * RT_13: la disposition de force est portée par la sous-sélection du nœud
 * « Force Disposition » dont `from = "group"` et `group = "Force Disposition"`.
 */
function extractForceDisposition(selections: readonly RawSelection[]): string {
  const node = selections.find(
    (s) => asString(s.type) === 'upgrade' && asString(s.name) === FORCE_DISPOSITION,
  );
  if (!node) {
    throw new RosterParseError(
      `Nœud « ${FORCE_DISPOSITION} » absent du roster : la disposition de force du joueur ` +
        `est indispensable pour proposer les plateaux de jeu.`,
    );
  }

  const choice = asArray(node.selections).find(
    (s) => asString(s.from) === 'group' && asString(s.group) === FORCE_DISPOSITION,
  );
  const name = asString(choice?.name);
  if (!name) {
    throw new RosterParseError(
      `Aucune disposition de force sélectionnée dans le nœud « ${FORCE_DISPOSITION} » du roster.`,
    );
  }
  return name;
}

/**
 * RT_13: profils de modèle d'une unité. Ils sont le plus souvent enfants
 * directs de l'unité, mais le list-builder peut les regrouper sous un nœud
 * `type = "upgrade"` portant l'option choisie — « 8 chainblades » →
 * `model` « Jakhal » ×8. La recherche traverse donc ces nœuds, dont le nom
 * est joint à l'équipement du modèle (il décrit son armement).
 *
 * Le sous-arbre d'un `model`, lui, n'est pas exploré à la recherche d'autres
 * modèles : ce qui s'y trouve est son propre équipement.
 */
function collectModelProfiles(
  selection: RawSelection,
  unitName: string,
  enclosing: readonly string[] = [],
  into: ParsedModelProfile[] = [],
): ParsedModelProfile[] {
  for (const child of asArray(selection.selections)) {
    const childName = asString(child.name);
    if (asString(child.type) === 'model') {
      const count = asCount(child.number);
      if (count === null) {
        throw new RosterParseError(
          `Nombre de modèles illisible pour le profil « ${childName} » de l'unité ` +
            `« ${unitName} ».`,
        );
      }
      into.push({
        name: childName || unitName,
        count,
        equipment: [...enclosing, ...collectEquipment(child)],
      });
      continue;
    }
    collectModelProfiles(child, unitName, childName ? [...enclosing, childName] : enclosing, into);
  }
  return into;
}

/**
 * RT_13: pour une entrée `model`, son propre `number` est le compte de
 * modèles. Pour une entrée `unit`, le compte est la somme des `number` des
 * entrées `model` de son arborescence, chaque profil de modèle distinct
 * étant une entrée séparée.
 */
function parseUnit(selection: RawSelection): ParsedUnit {
  const name = asString(selection.name);
  const type = asString(selection.type);

  if (type === 'model') {
    const count = asCount(selection.number);
    if (count === null) {
      throw new RosterParseError(`Nombre de modèles illisible pour l'unité « ${name} ».`);
    }
    return {
      name,
      modelCount: count,
      modelProfiles: [{ name, count, equipment: collectEquipment(selection) }],
    };
  }

  const profiles = collectModelProfiles(selection, name);

  if (profiles.length === 0) {
    throw new RosterParseError(
      `L'unité « ${name} » ne déclare aucun profil de modèle : impossible de savoir ` +
        `combien de socles déployer.`,
    );
  }

  return {
    name,
    modelCount: profiles.reduce((sum, p) => sum + p.count, 0),
    modelProfiles: profiles,
  };
}

/** Interprète le contenu JSON d'un roster exporté. RG_01: tout ou rien. */
export function parseRosterJson(raw: unknown): ParsedRoster {
  if (raw === null || typeof raw !== 'object') {
    throw new RosterParseError('Le fichier fourni ne contient pas un objet JSON.');
  }

  const roster = (raw as { roster?: unknown }).roster;
  if (roster === null || typeof roster !== 'object') {
    throw new RosterParseError(
      'Racine « roster » absente : ce fichier ne semble pas être un export de ' +
        'list-builder BattleScribe / NewRecruit.',
    );
  }

  const name = asString((roster as { name?: unknown }).name);
  if (!name) {
    throw new RosterParseError('Le roster ne porte pas de nom (« roster.name »).');
  }

  const forces = asArray((roster as { forces?: unknown }).forces);
  if (forces.length === 0) {
    throw new RosterParseError('Le roster ne contient aucune force (« roster.forces »).');
  }

  // Toutes les forces du roster contribuent à la liste déployée ; la
  // disposition de force, elle, est déclarée une seule fois.
  const allSelections = forces.flatMap((force) => asArray(force.selections));
  const forceDispositionName = extractForceDisposition(allSelections);

  const units = allSelections
    .filter((selection) => UNIT_TYPES.includes(asString(selection.type)))
    .filter((selection) => asString(selection.name) !== '')
    .map(parseUnit);

  if (units.length === 0) {
    throw new RosterParseError(
      'Aucune unité déployable trouvée dans le roster (sélections de type « unit » ou « model »).',
    );
  }

  return { name, forceDispositionName, units };
}

/** Interprète le texte d'un fichier importé. RG_01: message explicite. */
export function parseRosterJsonText(text: string): ParsedRoster {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new RosterParseError(
      `Fichier JSON illisible : ${err instanceof Error ? err.message : 'format invalide'}.`,
    );
  }
  return parseRosterJson(parsed);
}
