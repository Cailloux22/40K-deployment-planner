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

This repository is currently the **unmodified Ionic "blank" starter** (`ionic start` output) — there is no app-specific code yet. `src/app/home` still renders the default "Ready to create an app?" placeholder. Treat any architectural decision (data model, state management, offline storage, sync backend, canvas/rendering approach for the map + tokens) as unmade; there is nothing existing to preserve in these areas beyond what's described below.

No git repository has been initialized in this directory.

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

### Offline + sync (not yet built)

The brief requires offline-first operation and cross-device sync via a user account. No storage layer, backend, or sync mechanism exists yet — there's no `src/app/services` or `src/app/models` directory in the current tree. When building this out, decide deliberately between local-only Capacitor/browser storage (e.g. `@capacitor/preferences`, IndexedDB) for the offline path and whatever backend is chosen for sync, and keep the two paths consistent (offline edits must reconcile once sync resumes).

### Map/token rendering (not yet built)

The deployment-map editor (unit base shapes sized/colored per unit, placed model-by-model, saved per list into a library) has no implementation yet — there's a stray [src/assets/shapes.svg](src/assets/shapes.svg) but nothing referencing it. This will likely need its own rendering approach (SVG/Canvas) and a data model for maps, units, bases, and placements; none of that exists to constrain the design yet.

### Base-size referential data source ([[RT_02]])

The unit → base-size referential ([RT_02](specification/spec.md)) is generated offline from Wahapedia's public CSV data export (`Datasheets_models.csv`, see [wahapedia.ru/wh40k11ed/the-rules/data-export](https://wahapedia.ru/wh40k11ed/the-rules/data-export)), not fetched live — Wahapedia does not offer a hosted API. Per that export's usage terms: **any public use of this data must credit "Powered by Wahapedia."** Attribution must appear wherever the app surfaces base-size/datasheet data derived from this source (e.g. an About/credits screen).
