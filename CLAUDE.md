# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project brief

Mobile-first app for Warhammer 40k players to plan deployment on the tabletop. Core features (per the product owner, none implemented yet — see "Current state" below):

- Import an army list.
- Plan deployment on different maps/boards according to the player's force disposition.
- Provide base-shape tokens sized to match each unit's model base, colored to distinguish units, placeable one at a time on the map (e.g. a 10-model unit gets placed model by model, not as one blob).
- A library of saved/filled-in deployment maps, linked to the list they belong to, viewable later.
- Must work offline.
- Must support a user account to sync changes made across devices (desktop + phone).

## Specification

[specification/spec.md](specification/spec.md) formalizes the brief above into three levels of traceability: `EX_XX` (requirements), `RG_XX` (business rules), `RT_XX` (technical rules implementing those business rules/non-functional constraints).

**Mandatory traceability rule:** any feature implementation MUST reference the business rules (`RG_XX`) and technical rules (`RT_XX`) it satisfies. Before writing the code, identify which `RG_XX`/`RT_XX` entries in spec.md apply; while writing it, tag the code with `// RG_XX: ...` / `// RT_XX: ...` comments at the exact point each rule is applied. If a feature is being implemented but no matching rule exists yet in spec.md, add it there first (or flag the gap to the user) rather than implementing untraced behavior. Update spec.md whenever an architectural decision listed there as unmade gets made.

**Mandatory pre-modification commit rule:** before making any change to [specification/spec.md](specification/spec.md), first commit the file's current state on its own, with a commit message that details its content (e.g. the `EX_XX`/`RG_XX`/`RT_XX` entries present, and which decisions are still marked as unmade) — so the prior version of the spec is always recoverable independently of the change about to be made to it.

## Current state

The client application is implemented against [specification/spec.md](specification/spec.md): all 9 screens of [specification/sitemap.md](specification/sitemap.md) except the two full-screen viewers, which share one component (`src/app/shared/board-viewer.component.ts`), and the conflict screen, which is a component surfaced on the home and settings screens rather than a route.

Layout of the app-specific code:

- `src/app/models/` — domain, referential and sync types.
- `src/app/referentials/` — access to the three embedded referentials + the `RG_02` name/base matching.
- `src/app/data/` — IndexedDB store (`RT_08`) and the library of lists/deployments (`RT_06`).
- `src/app/import/` — `RT_01` format layer, `RT_13` roster JSON parser, `RG_06` colours.
- `src/app/deployment/` — pure status/grouping logic (`RT_11`, `RT_18`) and token geometry (`RT_05`, `RT_19`).
- `src/app/net/` — connectivity (`RT_14`), auth (`RT_21`), delta sync (`RT_09`/`RT_10`/`RT_15`).
- `src/app/pages/` + `src/app/home/` — the screens; `src/app/shared/` — cross-screen components.
- `scripts/` — the two offline referential ingestion scripts (see below).

**The sync backend itself does not exist.** The contract is specified in [specification/openapi.yml](specification/openapi.yml) and the client implements it fully, but no server serves it, so `EX_06` is not satisfied end-to-end. This is tracked in spec.md under "Suivi des écarts entre spécification et implémentation"; per `RG_09`/`RG_10` it is non-blocking — the app is fully usable locally.

Architectural decisions previously marked unmade are now taken and recorded in spec.md (`RT_06`/`RT_08` storage, `RT_16` pan/zoom). Do not treat them as open.

No native platforms have been added; `capacitor.config.ts` still carries the placeholder `appId`.

## Stack

- Angular 22 + Ionic Angular 9, packaged for mobile via Capacitor 8 (`@capacitor/core`, `@capacitor/app`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/status-bar`).
- Capacitor `appId` in [capacitor.config.ts](capacitor.config.ts) is still the placeholder `io.ionic.starter` — update before any real device build/release.
- No native platforms (`ios/`, `android/`) have been added yet (`npx cap add ...` has not been run).

## Commands

```bash
npm start        # ng serve — dev server
ng build          # production build, outputs to www/ (see angular.json outputPath)
ng build --watch --configuration development
ng test           # runs the unit tests
ng lint
```

To run a single test file/spec, pass it through the Angular CLI test builder, e.g. `ng test -- --project src/app/home/home.page.spec.ts` (this project uses Vitest under the hood — see Testing below — so Vitest's own filtering flags also apply once you're through the builder).

Capacitor (once native platforms exist): `npx cap sync`, `npx cap open ios`, `npx cap open android`.

Referential regeneration — run offline, never at app runtime (`EX_05`); both require network access to their source and fail explicitly rather than emitting a partial referential:

```bash
node scripts/ingest-bases.mjs                  # RT_02 — src/assets/referentials/bases.json
node scripts/ingest-boards.mjs                 # RT_12 — boards.json + 90 board PNGs (~34 MB)
node scripts/ingest-boards.mjs --metadata-only  # boards.json only, no image download
```

## Architecture

### Module style — NgModules, not standalone

Despite standalone components being Angular's current default, **this project's schematics are explicitly configured for NgModule-based generation**:

- [ionic.config.json](ionic.config.json) sets `standalone: false` for both `@ionic/angular-toolkit:component` and `:page` schematics.
- [eslint.config.js](eslint.config.js) explicitly disables `@angular-eslint/prefer-standalone`.
- The existing `HomePage` (`src/app/home/home.page.ts`) is declared with `standalone: false` and lives inside `HomePageModule`.

So `ng generate component`/`ng generate page` will produce NgModule-declared components by default, matching the existing `home` feature's pattern: a `<feature>.page.ts`/`.module.ts`/`-routing.module.ts` triplet, lazy-loaded from [app-routing.module.ts](src/app/app-routing.module.ts) via `loadChildren`. Follow this pattern for new feature pages unless you deliberately change the schematics config. `inject()`, Signals, and `OnPush` are independent of standalone vs. NgModule and can still be used inside NgModule-declared components.

Lint conventions enforced (see [eslint.config.js](eslint.config.js)):
- Component/page classes must end in `Component` or `Page`.
- Component selectors: `app-` prefix, kebab-case.
- Directive selectors: `app` prefix, camelCase.

### Testing

Despite the generic convention "Karma", this project actually runs on **Vitest**, wired through Angular's own test builder (`@angular/build:unit-test`, see `architect.test` in [angular.json](angular.json)) with a jsdom environment. [src/test-setup.ts](src/test-setup.ts) polyfills `window.matchMedia`, which Ionic components (`ion-menu`, `ion-split-pane`, etc.) query and jsdom doesn't implement — extend this file if new Ionic components hit similar jsdom gaps.

### Styling

Global styles in [src/global.scss](src/global.scss), Ionic theme variables/tokens in [src/theme/variables.scss](src/theme/variables.scss). Both are registered as global styles in `angular.json` (`architect.build.options.styles`) rather than imported per-component.

### Offline + sync

Offline-first is implemented: everything except importing a new list (`RG_13`, a deliberate restriction) works without network. Records live in IndexedDB (`src/app/data/local-store.service.ts`), light config (session, sync token) behind `getConfig`/`setConfig` in the same service — that pair is the single substitution point for `@capacitor/preferences` on native. Referentials are read as asset files, not copied into the database, so an errata update can replace them without a code release.

The sync client (`src/app/net/sync.service.ts`) pulls then pushes a delta, never overwrites a locally-modified record, and queues genuine conflicts for the player to arbitrate (`RG_11`) instead of resolving them. All failures are swallowed into a visible-but-non-blocking state (`RG_09`). No server implements the contract yet — see "Current state".

### Map/token rendering

The placement editor (`src/app/pages/placement/`) renders the board image with an SVG token layer on top, at a fixed contain-fit zoom with no player-driven zoom/pan (`RG_17`/`RT_19`); drag, drop and rotation run on Pointer events. The full-screen viewers (`src/app/shared/board-viewer.component.ts`) do the opposite: pinch/pan, read-only.

Placement coordinates are stored in the **board asset's own pixel space**, not screen space, so a deployment survives any device, zoom or orientation. Converting a real base size in mm to that space needs the board rectangle measured inside the image (the assets also carry a title banner and a legend) — that measurement is done at ingestion time and stored per board (`RT_05`); do not try to derive it from the image dimensions.

[src/assets/shapes.svg](src/assets/shapes.svg) is a leftover from the Ionic starter (random coloured shapes) and is referenced by nothing. Base shapes are drawn from the referential's own geometry (round → circle, oval → ellipse); the file can be deleted.

### Base-size referential data source ([[RT_02]])

The unit → base-size referential ([RT_02](specification/spec.md)) is generated offline by `scripts/ingest-bases.mjs` from Wahapedia's public CSV data export (`Datasheets_models.csv` joined to `Datasheets.csv`, see [wahapedia.ru/wh40k11ed/the-rules/data-export](https://wahapedia.ru/wh40k11ed/the-rules/data-export)), not fetched live — Wahapedia does not offer a hosted API. Per that export's usage terms: **any public use of this data must credit "Powered by Wahapedia."**

The board referential ([RT_12](specification/spec.md)) is likewise generated offline by `scripts/ingest-boards.mjs` from the static images on [gdmissions.app](https://gdmissions.app/11th/layouts), which sources them from **Battlemaster** (battlemaster.online) — **that credit is equally required**.

Attribution is **not hard-coded in any screen** ([RT_20](specification/spec.md)): each generated referential embeds its own source name and attribution text, and the Settings screen simply enumerates the referentials present in the build. A new third-party referential therefore shows up in the credits without touching screen code — provided its ingestion writes a `source` block and it is added to the enumeration in `src/app/referentials/referential.service.ts`.
