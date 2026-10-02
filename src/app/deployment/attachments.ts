/**
 * RG_36 / RG_37 / RT_45 / RT_46 — unités attachées et groupes de déploiement.
 *
 * Fonctions pures, sans dépendance Angular : contraintes structurelles d'un
 * attachement, lecture tolérante des attachements enregistrés, et dérivation
 * des groupes de déploiement que les règles de placement reçoivent à la place
 * des unités de la liste.
 */

import { ArmyUnit, AttachmentRole, UnitAttachment } from '../models/domain.models';

/** RG_36/RG_24: libellé du rôle, énoncé en toutes lettres. */
export const ATTACHMENT_ROLE_LABELS: Readonly<Record<AttachmentRole, string>> = {
  leader: 'meneur',
  support: 'soutien',
};

export function isAttachmentRole(value: unknown): value is AttachmentRole {
  return value === 'leader' || value === 'support';
}

/**
 * RG_36: contraintes structurelles d'un attachement de `characterId` à
 * `bodyguardId`, évaluées sur l'état courant des unités. Rend la raison du
 * refus, ou `null` si l'attachement est permis. Les règles du jeu sur qui
 * peut mener quoi, et le nombre de meneurs et de soutiens, ne sont pas
 * contrôlées : le joueur fait autorité sur sa liste.
 */
export function attachmentBlocker(
  units: readonly ArmyUnit[],
  characterId: string,
  bodyguardId: string,
): string | null {
  const character = units.find((unit) => unit.id === characterId);
  const bodyguard = units.find((unit) => unit.id === bodyguardId);
  if (!character || !bodyguard) return "l'une des deux unités est introuvable dans la liste.";
  // RG_36: une unité ne peut pas être attachée à elle-même.
  if (character.id === bodyguard.id) return 'une unité ne peut pas être attachée à elle-même.';
  // RG_36: un personnage est attaché à une seule unité escortée.
  if (character.attachment) {
    const current = units.find((unit) => unit.id === character.attachment!.bodyguardUnitId);
    return `« ${character.name} » est déjà attachée à « ${current?.name ?? 'une autre unité'} ».`;
  }
  // RG_36: les attachements ne s'enchaînent pas — ni l'unité escortée ne peut
  // être elle-même attachée, ni le personnage escorter déjà quelqu'un.
  if (bodyguard.attachment) return `« ${bodyguard.name} » est elle-même attachée à une autre unité.`;
  if (units.some((unit) => unit.attachment?.bodyguardUnitId === character.id)) {
    return `« ${character.name} » a déjà un personnage attaché et ne peut pas s'attacher à son tour.`;
  }
  return null;
}

/**
 * RT_45: lecture tolérante des attachements enregistrés. Un attachement qui ne
 * respecte plus les contraintes de RG_36 — unité escortée absente, elle-même
 * attachée, personnage attaché à lui-même ou escortant déjà une unité, rôle
 * inconnu — est ignoré sans erreur : le personnage redevient une unité
 * indépendante. Même principe que les identifiants orphelins de RT_35.
 */
export function validAttachments(units: readonly ArmyUnit[]): ReadonlyMap<string, UnitAttachment> {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const escorting = new Set(units.flatMap((unit) => (unit.attachment ? [unit.attachment.bodyguardUnitId] : [])));
  const valid = new Map<string, UnitAttachment>();
  for (const unit of units) {
    const attachment = unit.attachment;
    if (!attachment || !isAttachmentRole(attachment.role)) continue;
    const bodyguard = byId.get(attachment.bodyguardUnitId);
    if (!bodyguard || bodyguard.id === unit.id || bodyguard.attachment || escorting.has(unit.id)) continue;
    valid.set(unit.id, attachment);
  }
  return valid;
}

/** RG_36: attache un personnage ; rend les unités inchangées si c'est refusé. */
export function attachUnit(
  units: readonly ArmyUnit[],
  characterId: string,
  bodyguardId: string,
  role: AttachmentRole,
): ArmyUnit[] {
  if (attachmentBlocker(units, characterId, bodyguardId) !== null) return [...units];
  return units.map((unit) => (unit.id === characterId ? { ...unit, attachment: { bodyguardUnitId: bodyguardId, role } } : unit));
}

/** RG_36: défait l'attachement d'un personnage, qui redevient indépendant. */
export function detachUnit(units: readonly ArmyUnit[], characterId: string): ArmyUnit[] {
  return units.map((unit) => {
    if (unit.id !== characterId || !unit.attachment) return unit;
    const { attachment: _removed, ...independent } = unit;
    return independent;
  });
}

/**
 * RT_45/RG_21: après un changement d'identifiants d'unité (duplication d'une
 * liste), les `bodyguardUnitId` sont convertis vers les nouveaux identifiants
 * — une copie ne pointe jamais sur les unités de l'original.
 */
export function remapAttachments(units: readonly ArmyUnit[], newIdOf: ReadonlyMap<string, string>): ArmyUnit[] {
  return units.map((unit) => {
    if (!unit.attachment) return unit;
    const bodyguardUnitId = newIdOf.get(unit.attachment.bodyguardUnitId);
    if (bodyguardUnitId) return { ...unit, attachment: { ...unit.attachment, bodyguardUnitId } };
    const { attachment: _orphan, ...independent } = unit;
    return independent;
  });
}

// ---------------------------------------------------------------------------
// RT_46 — groupes de déploiement
// ---------------------------------------------------------------------------

/**
 * RT_46: une unité de déploiement — une unité attachée (RG_36), ou une unité
 * indépendante seule. Dérivée de la liste, ni persistée ni synchronisée.
 */
export interface DeploymentGroup {
  /** Identifiant de l'unité escortée, ou de l'unité indépendante. */
  readonly id: string;
  /** RG_37: nom composé — personnages d'abord, puis l'unité escortée. */
  readonly name: string;
  /** RT_46: meneurs, puis soutiens, puis l'unité escortée. */
  readonly units: readonly ArmyUnit[];
  readonly modelCount: number;
  /** RG_37/RG_24: rôle de chaque personnage du groupe, par identifiant d'unité. */
  readonly roles: ReadonlyMap<string, AttachmentRole>;
}

const NO_ROLES: ReadonlyMap<string, AttachmentRole> = new Map();

/** RT_46: le groupe d'une unité indépendante. */
export function singleUnitGroup(unit: ArmyUnit): DeploymentGroup {
  return { id: unit.id, name: unit.name, units: [unit], modelCount: unit.modelCount, roles: NO_ROLES };
}

const ROLE_ORDER: readonly AttachmentRole[] = ['leader', 'support'];

/**
 * RT_46: groupes de déploiement de la liste. Ils suivent l'ordre de la liste
 * à la première apparition de l'une de leurs unités ; au sein d'un groupe,
 * meneurs puis soutiens (dans l'ordre de la liste à rôle égal), puis l'unité
 * escortée. Une liste sans attachement donne un groupe par unité, dans
 * l'ordre de la liste — le déploiement d'avant RG_37.
 */
export function deploymentGroups(units: readonly ArmyUnit[]): DeploymentGroup[] {
  const attachments = validAttachments(units);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const groups: DeploymentGroup[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const groupId = attachments.get(unit.id)?.bodyguardUnitId ?? unit.id;
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    const bodyguard = byId.get(groupId)!;
    const characters = units.filter((candidate) => attachments.get(candidate.id)?.bodyguardUnitId === groupId);
    if (characters.length === 0) {
      groups.push(singleUnitGroup(bodyguard));
      continue;
    }
    const ordered = ROLE_ORDER.flatMap((role) => characters.filter((c) => attachments.get(c.id)!.role === role));
    const members = [...ordered, bodyguard];
    groups.push({
      id: groupId,
      name: members.map((member) => member.name).join(' + '),
      units: members,
      modelCount: members.reduce((sum, member) => sum + member.modelCount, 0),
      roles: new Map(ordered.map((c) => [c.id, attachments.get(c.id)!.role])),
    });
  }
  return groups;
}

/** RT_46: identifiant du groupe de chaque unité de la liste. */
export function groupIdByUnit(groups: readonly DeploymentGroup[]): ReadonlyMap<string, string> {
  return new Map(groups.flatMap((group) => group.units.map((unit) => [unit.id, group.id] as const)));
}

/**
 * RG_37/RG_24: nom accessible d'une composante — son nom et, pour un
 * personnage, son rôle. Une unité indépendante garde son seul nom.
 */
export function componentLabel(group: DeploymentGroup, unit: ArmyUnit): string {
  const role = group.roles.get(unit.id);
  return role ? `${unit.name} (${ATTACHMENT_ROLE_LABELS[role]})` : unit.name;
}
