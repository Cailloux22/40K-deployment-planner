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

**Mandatory version bump rule (`RG_47`/`RT_63`):** every commit that changes code — anything under `src/`, `scripts/`, `android/`, `cypress/`, build/tooling config (`package.json` dependencies, `angular.json`, `tsconfig*.json`, `ngsw-config.json`, …) or a generated referential — MUST increment the patch version in that same commit: run `npm run version:patch` (= `npm version patch --no-git-tag-version`, updates `package.json` and `package-lock.json`, creates no tag) and stage both files with the change. A commit that only touches `specification/` or documentation (`CLAUDE.md`, `*.md`) does NOT bump the version — so the pre-modification spec commits above never bump it. Minor/major bumps are the product owner's call; never make them unprompted. The `version` field of `package.json` is the single source of truth: the app imports it (`src/app/app-version.ts`, shown at the bottom of the Settings screen) and `android/app/build.gradle` derives `versionName`/`versionCode` from it — never hard-code a version anywhere else.

## Current state

The client application is implemented against [specification/spec.md](specification/spec.md): all 9 screens of [specification/sitemap.md](specification/sitemap.md) except the two full-screen viewers, which share one component (`src/app/shared/board-viewer.component.ts`), and the conflict screen, which is a component surfaced on the home and settings screens rather than a route.

Layout of the app-specific code:

- `src/app/models/` — domain, referential and sync types.
- `src/app/referentials/` — access to the embedded referentials, the `RG_02` name/base matching, `remote-image.service.ts` (`RT_12`/`RT_27`/`RT_65`: the network → cache → bundled chain shared by images), which `board-image.service.ts` (`RG_23`) and `mission-image.service.ts` (`RG_49`) parameterize, and `missions.ts` (`RT_64`/`RG_48`: the two primary-mission cards of an ordered disposition pair).
- `src/app/data/` — IndexedDB store (`RT_08`) and the library of lists/deployments (`RT_06`).
- `src/app/import/` — `RT_01` format layer, `RT_13` roster JSON parser, `RG_06` colours, splitting a unit of 10+ models in two at the import summary (`RG_40`/`RT_50`/`RT_52`, `unit-split.ts`; its drag-and-drop editor is `src/app/pages/import/unit-split-editor.component.ts`, `RT_51`).
- `src/app/deployment/` — pure status/grouping logic (`RT_11`, `RT_18`), token geometry (`RT_05`, `RT_19`), shared plane geometry and the ruler measure (`geometry.ts`, `RG_33`/`RT_42`), unit coherency (`RG_26`/`RT_36`), multi-token selection (`RG_30`/`RG_31`/`RT_40`, `selection.ts`), the compact cluster for a grouped drop from the band (`RG_32`/`RT_41`, `cluster.ts`), attached units and the deployment groups the placement rules operate on (`RG_36`/`RG_37`/`RT_45`/`RT_46`, `attachments.ts` — a leader/support and its bodyguard form one group; placements still carry the component's `idUnite`) and the zone visible from a model (`RG_27`/`RG_28`/`RT_38`).
- `src/app/net/` — connectivity (`RT_14`), auth (`RT_21`), delta sync (`RT_09`/`RT_10`/`RT_15`).
- `src/app/pwa/` — the installable web version (`EX_12`): install context and prompt (`RT_55`), background board download (`RT_56`), update announcement (`RT_57`), persistent storage (`RT_58`). The service worker itself is Angular's (`ngsw-config.json`, `RT_54`).
- `src/app/pages/` + `src/app/home/` — the screens; `src/app/shared/` — cross-screen components.
- `scripts/` — the four offline referential ingestion scripts (see below), the app icon generator and a local server for the production build (PWA, see below).

**The sync backend itself does not exist.** The contract is specified in [specification/openapi.yml](specification/openapi.yml) and the client implements it fully, but no server serves it, so `EX_06` is not satisfied end-to-end. This is tracked in spec.md under "Suivi des écarts entre spécification et implémentation"; per `RG_09`/`RG_10` it is non-blocking — the app is fully usable locally. The contract is now v1.0.0 (account management, connected devices, first-connection merge/replace choice, versioned deletions, paginated pull — `RG_50`–`RG_53`, `RT_67`–`RT_69`), but the client still implements v0.1; the list of differences is under the `RT_09` entry of "Suivi des écarts" and must be closed before any server goes live.

Architectural decisions previously marked unmade are now taken and recorded in spec.md (`RT_06`/`RT_08` storage, `RT_16` pan/zoom). Do not treat them as open.

The Android platform has been added (`android/`, debug APK builds); iOS has not. On iPhone/iPad the app is meant to be installed as a PWA from the website (`EX_12`) — but no hosting is chosen yet (`RT_59`, listed as unmade in spec.md), so the web version is not published anywhere.

## Stack

- Angular 22 + Ionic Angular 9, packaged for mobile via Capacitor 8 (`@capacitor/core`, `@capacitor/app`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/status-bar`), and installable from the browser as a PWA via `@angular/service-worker` (production build only, disabled inside the APK).
- Capacitor `appId` in [capacitor.config.ts](capacitor.config.ts) is `fr.rocher.deploymentplanner` — it is baked into `android/` (package name), so changing it later means editing the Gradle/manifest files too, and it cannot change once published on the Play Store.
- `android/` exists (`@capacitor/android`, checked in); `ios/` has not been added. Release signing (keystore, `assembleRelease`) is not set up — only debug APKs are built.

## Commands

```bash
npm start        # ng serve — dev server
ng build          # production build, outputs to www/ (see angular.json outputPath)
ng build --watch --configuration development
ng test           # runs the unit tests
ng lint
npm run version:patch  # RT_63 — bump the patch version; required in every code commit (see Specification)
```

To run a single test file/spec, pass it through the Angular CLI test builder, e.g. `ng test -- --project src/app/home/home.page.spec.ts` (this project uses Vitest under the hood — see Testing below — so Vitest's own filtering flags also apply once you're through the builder).

End-to-end tests (Cypress, see Testing below):

```bash
npm run e2e                                    # starts ng serve, runs every spec headless, stops the server
npm run e2e:open                               # same, with the interactive Cypress runner
npm run cy:run -- --spec cypress/e2e/home.cy.ts # one spec, against an already-running ng serve
```

Android APK (needs a JDK and the Android SDK via `ANDROID_HOME`; output at `android/app/build/outputs/apk/debug/app-debug.apk`):

```bash
ng build && npx cap sync android   # rebuild www/ and copy it into android/
cd android && ./gradlew assembleDebug
npx cap open android               # open in Android Studio
```

PWA (`EX_12`) — `ng serve` never registers the service worker, so check offline behaviour, installation and updates against the production build:

```bash
ng build && npm run serve:pwa      # www/ on http://localhost:8080 (SPA rewrite + RT_59 cache headers); also the "pwa" entry of .claude/launch.json
node scripts/generate-icons.mjs    # RT_53 — from resources/icon.png (1024 px master): src/assets/icon/*.png (manifest, iOS, favicon) + Android launcher mipmaps and adaptive background colour
```

The production build enforces a per-component style budget (`anyComponentStyle` in `angular.json`, 6 kB warning / 12 kB error); `placement.page.scss` is already over the warning threshold.

Referential regeneration — run offline, never at app runtime (`EX_05`); all but `ingest-terrain.mjs` require network access to their source and fail explicitly rather than emitting a partial referential:

```bash
node scripts/ingest-bases.mjs                  # RT_02 — src/assets/referentials/bases.json
node scripts/ingest-boards.mjs                 # RT_12 — boards.json + 90 board PNGs (~34 MB)
node scripts/ingest-boards.mjs --metadata-only  # boards.json only, no image download
node scripts/ingest-terrain.mjs                # RT_37 — terrain.json, from the bundled board PNGs
node scripts/ingest-terrain.mjs --preview <dir> # + one control PNG per board (one colour per baseplate)
node scripts/ingest-missions.mjs               # RT_64 — missions.json + 25 primary-mission card PNGs and their 11 backs (~7 MB)
```

`ingest-terrain.mjs` needs no network: it reads the `no-measurements` board images already in the repo. Re-run it whenever the board images change, and review the control PNGs — the extraction is heuristic (see `RT_37` and its entries under "Suivi des écarts" in spec.md).

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

End-to-end tests run on **Cypress** against the running dev server (phone-sized viewport): with no `baseUrl` given (`--config baseUrl=…` / `CYPRESS_BASE_URL`), it uses `http://localhost:8100` (`ionic serve`, with or without `--external`) if it answers, else `http://localhost:4200` (`ng serve`, used by `npm run e2e`), configured in [cypress.config.ts](cypress.config.ts); specs are `cypress/e2e/**/*.cy.ts`, with their own [cypress/tsconfig.json](cypress/tsconfig.json) (TypeScript 6 requires its explicit `rootDir`). Two Ionic-specific points:
- `includeShadowDom: true` — Ionic moves `aria-label` and the native `<button>` into each component's shadow DOM, so query `button[aria-label="…"]`, not `ion-button[aria-label="…"]`.
- Start a test with `cy.visitFresh(path)` ([cypress/support/commands.ts](cypress/support/commands.ts)) rather than `cy.visit`: it deletes the app's IndexedDB (which Cypress's test isolation does not clear) and waits for the Ionic page's entry transition, which otherwise re-renders and detaches elements mid-click.

### Styling

Global styles in [src/global.scss](src/global.scss), Ionic theme variables/tokens in [src/theme/variables.scss](src/theme/variables.scss). Both are registered as global styles in `angular.json` (`architect.build.options.styles`) rather than imported per-component.

### Offline + sync

Offline-first is implemented: everything except importing a new list (`RG_13`, a deliberate restriction) works without network. Records live in IndexedDB (`src/app/data/local-store.service.ts`), light config (session, sync token) behind `getConfig`/`setConfig` in the same service — that pair is the single substitution point for `@capacitor/preferences` on native. Referentials are read as asset files, not copied into the database, so an errata update can replace them without a code release.

Board images are the exception (`RT_12`/`RT_27`/`RG_23`): when online, `BoardImageService` fetches each image directly from its gdmissions.app URL (`remoteAssets` in `boards.json`, CORS is `*`), accepts it only if it is a PNG with the referential's exact dimensions (placements, `playArea` and terrain are in that pixel space), and stores it as a blob in the IndexedDB store `boardImages`. Primary-mission cards (`RT_65`) follow the same chain through `MissionImageService`, store `missionImages`, pipe `card | missionImage: face | async` (`'front'` or `'back'`, back cached as `{id}#back`). Offline or on failure it serves that cached copy, then the bundled `assets` image. One network call per image per app session. Templates use `board | boardImage: variant | async` (pipe in `SharedModule`), never `board.assets[...]` directly. Only images refresh: `playArea`, terrain and the list of boards still come from the offline ingestion, so a board newly published upstream needs `ingest-boards.mjs` (+ `ingest-terrain.mjs`) to be re-run.

In the browser, offline relies on the service worker (`RT_54`): app shell and JSON referentials are precached; the 90 board PNGs and the 36 mission-card images (25 fronts, 11 backs) are cached lazily (groups `boards`, `missions`) and filled in the background by `BoardPrefetchService` (`RT_56`, cards after boards). `BoardImageService`'s "bundled" step therefore checks, offline, that the service worker can actually serve the image, and otherwise returns an SVG "Plateau non disponible hors-ligne" placeholder (`RG_42`). Ionicons' `svg/` folder is **not** cached: every `<ion-icon name="…">` must be registered in `src/app/icons.ts`, or it will be missing offline.

The sync client (`src/app/net/sync.service.ts`) pulls then pushes a delta, never overwrites a locally-modified record, and queues genuine conflicts for the player to arbitrate (`RG_11`) instead of resolving them. All failures are swallowed into a visible-but-non-blocking state (`RG_09`). No server implements the contract yet — see "Current state".

### Map/token rendering

The placement editor (`src/app/pages/placement/`) renders the board image with an SVG token layer on top, at a contain-fit base zoom (`RG_17`/`RT_19`) that the player can only toggle to a single ×2 (`RG_38`); once enlarged, the view pans in the « Déplacement » mode or while the middle mouse button is held (`RG_39`/`RT_48`). The display scale is base × zoom and the surface is offset by a CSS translate (`RT_47`); screen→asset conversion reads the surface's rendered rect, so gestures need no zoom-specific maths. Drag, drop, rotation and view panning run on Pointer events. Selecting a placed token draws the zone it can see (`RG_29`) as one SVG path under the tokens: the union of per-sample visibility polygons computed by `src/app/deployment/visibility.ts` against the board's terrain (`terrain.json`, `RT_37`). It is hidden during a gesture and recomputed on release, never on every pointer move. The full-screen viewers (`src/app/shared/board-viewer.component.ts`) do the opposite: pinch/pan, read-only. Their pan/zoom is `src/app/shared/pan-zoom.component.ts` (`RT_16`), also used by the primary-missions window (`mission-cards.component.ts`, `RT_66`).

Placement coordinates are stored in the **board asset's own pixel space**, not screen space, so a deployment survives any device, zoom or orientation. Converting a real base size in mm to that space needs the board rectangle measured inside the image (the assets also carry a title banner and a legend) — that measurement is done at ingestion time and stored per board (`RT_05`); do not try to derive it from the image dimensions.

[src/assets/shapes.svg](src/assets/shapes.svg) is a leftover from the Ionic starter (random coloured shapes) and is referenced by nothing. Base shapes are drawn from the referential's own geometry (round → circle, oval → ellipse); the file can be deleted.

### Base-size referential data source ([[RT_02]])

The unit → base-size referential ([RT_02](specification/spec.md)) is generated offline by `scripts/ingest-bases.mjs` from Wahapedia's public CSV data export (`Datasheets_models.csv` joined to `Datasheets.csv`, see [wahapedia.ru/wh40k11ed/the-rules/data-export](https://wahapedia.ru/wh40k11ed/the-rules/data-export)), not fetched live — Wahapedia does not offer a hosted API. Per that export's usage terms: **any public use of this data must credit "Powered by Wahapedia."**

The board referential ([RT_12](specification/spec.md)) is likewise generated offline by `scripts/ingest-boards.mjs` from the static images on [gdmissions.app](https://gdmissions.app/11th/layouts), which sources them from **Battlemaster** (battlemaster.online) — **that credit is equally required**. The primary-mission referential ([RT_64](specification/spec.md)) comes from the same site (`scripts/ingest-missions.mjs`); its attribution text is provisional until the decision listed open in spec.md is made.

Attribution is **not hard-coded in any screen** ([RT_20](specification/spec.md)): each generated referential embeds its own source name and attribution text, and the Settings screen simply enumerates the referentials present in the build. A new third-party referential therefore shows up in the credits without touching screen code — provided its ingestion writes a `source` block and it is added to the enumeration in `src/app/referentials/referential.service.ts`.
