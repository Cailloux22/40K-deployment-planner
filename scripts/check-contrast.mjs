#!/usr/bin/env node
/**
 * RT_29 — contrôle des couples de contraste déclarés par le système de tokens.
 *
 * Lit `src/theme/variables.scss`, résout les tokens des deux thèmes, et vérifie
 * chaque couple déclaré dans le fichier sous la forme :
 *
 *     // @contrast <token-texte> on <token-fond> >= <ratio>
 *
 * Sort en code 1 à la première violation. RT_29 exige que ce contrôle soit
 * scripté et non laissé à la relecture visuelle : une valeur de token modifiée
 * sans que le couple correspondant reste au-dessus du seuil doit échouer ici.
 *
 * Usage : node scripts/check-contrast.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VARIABLES = join(ROOT, 'src', 'theme', 'variables.scss');

/** RT_32: même définition de la luminance relative que celle employée à l'exécution. */
function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(value) {
  const text = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];
    const n = parseInt(digits, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }

  return null;
}

/** Extrait `--token: valeur;` du corps d'un mixin, en résolvant les variables SCSS. */
function parseMixin(source, name, scssVars) {
  const start = source.indexOf(`@mixin ${name}`);
  if (start === -1) throw new Error(`mixin introuvable : ${name}`);

  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = source.slice(start, end);
  const tokens = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    // Résout l'interpolation SCSS `#{$rampe}` vers la valeur de la variable.
    const raw = match[2].trim().replace(/^#\{(\$[\w-]+)\}$/, (_, name) => scssVars.get(name) ?? _);
    tokens.set(match[1], scssVars.get(raw) ?? raw);
  }
  return tokens;
}

function main() {
  const source = readFileSync(VARIABLES, 'utf8');

  // Variables SCSS privées ($ramp-…), partagées entre familles de statut.
  const scssVars = new Map();
  for (const match of source.matchAll(/^\$([\w-]+)\s*:\s*([^;]+);/gm)) {
    scssVars.set(`$${match[1]}`, match[2].trim());
  }

  const themes = {
    clair: parseMixin(source, 'app-light-tokens', scssVars),
    sombre: parseMixin(source, 'app-dark-tokens', scssVars),
  };

  const pairs = [...source.matchAll(/@contrast\s+(--[\w-]+)\s+on\s+(--[\w-]+)\s*>=\s*([\d.]+)/g)];
  if (pairs.length === 0) {
    console.error('Aucun couple @contrast déclaré — RT_29 en exige.');
    process.exit(1);
  }

  const failures = [];
  let checked = 0;

  for (const [, fgToken, bgToken, threshold] of pairs) {
    for (const [themeName, tokens] of Object.entries(themes)) {
      const fgRaw = tokens.get(fgToken);
      const bgRaw = tokens.get(bgToken);

      if (fgRaw === undefined || bgRaw === undefined) {
        failures.push(
          `[${themeName}] token non défini : ${fgRaw === undefined ? fgToken : bgToken}`,
        );
        continue;
      }

      const fg = parseColor(fgRaw);
      const bg = parseColor(bgRaw);
      if (!fg || !bg) {
        failures.push(`[${themeName}] couleur non interprétable : ${fgRaw} / ${bgRaw}`);
        continue;
      }

      const ratio = contrastRatio(fg, bg);
      checked += 1;
      if (ratio < Number(threshold)) {
        failures.push(
          `[${themeName}] ${fgToken} sur ${bgToken} : ${ratio.toFixed(2)}:1 ` +
            `< ${threshold}:1 requis (${fgRaw} sur ${bgRaw})`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(`RT_29 — ${failures.length} couple(s) en échec sur ${pairs.length * 2} :\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }

  console.log(`RT_29 — ${checked} couples vérifiés dans les deux thèmes, tous conformes.`);
}

main();
