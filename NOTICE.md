# Windfall Planner — licence et mentions

Copyright (C) 2026 Mathieu Rocher

Le **code source** de Windfall Planner est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la **GNU Affero General Public License** publiée par la Free Software Foundation, soit la version 3 de cette licence, soit (à votre choix) toute version ultérieure (`AGPL-3.0-or-later`). Le texte complet de la licence figure dans le fichier [LICENSE](LICENSE).

Ce programme est distribué dans l'espoir qu'il sera utile, mais **SANS AUCUNE GARANTIE**, sans même la garantie implicite de QUALITÉ MARCHANDE ou d'ADÉQUATION À UN USAGE PARTICULIER. Voir la GNU Affero General Public License pour plus de détails.

Quiconque reçoit l'application — APK Android ou version web — a droit à son code source complet, disponible à l'adresse <https://github.com/Cailloux22/40K-deployment-planner>.

## Ce que la licence ne couvre pas

La licence AGPL-3.0 porte sur le code écrit pour ce projet. Elle **ne s'applique pas** aux données et images de tiers embarquées dans `src/assets/referentials/`, qui restent la propriété de leurs auteurs et sont soumises à leurs propres conditions :

| Fichiers | Source | Mention requise |
|---|---|---|
| `bases.json` (référentiel des socles) | [Wahapedia](https://wahapedia.ru/wh40k11ed/the-rules/data-export) — export de données | « Powered by Wahapedia » |
| `boards.json`, `boards/`, `terrain.json` (plateaux et terrain extrait de leurs images) | [Battlemaster](https://battlemaster.online), via [gdmissions.app](https://gdmissions.app/11th/layouts) | « Deployment maps by Battlemaster (battlemaster.online), via gdmissions.app » |
| `missions.json`, `missions/` (cartes de mission primaire) | [gdmissions.app](https://gdmissions.app/11th/primary-missions) | « Primary mission cards (GDM 2026) via gdmissions.app » |

Ces mentions sont affichées dans l'écran Réglages de l'application, à partir du bloc `source` de chaque référentiel.

Windfall Planner est un projet de fans non officiel, sans lien avec Games Workshop. Warhammer 40,000 et les noms associés sont des marques de Games Workshop Limited.

## Dépendances

Les bibliothèques tierces utilisées par l'application gardent leur propre licence, reproduite dans leur paquet npm et rassemblée par le build de production dans `3rdpartylicenses.txt`. Elles sont compatibles avec l'AGPL-3.0, notamment :

- Angular, Ionic, Capacitor — licence MIT ;
- Shepherd.js (visite guidée, dès son implémentation) — licence AGPL-3.0.
