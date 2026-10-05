/**
 * RT_54/RT_56 — disponibilité d'un asset servi par le service worker.
 *
 * Un chemin d'asset relatif (`assets/…`) est résolu contre le `base href` du
 * document, comme le fait le service worker pour ranger ses entrées.
 */
export function absoluteAssetUrl(path: string): string {
  return new URL(path, globalThis.document?.baseURI ?? globalThis.location?.href).href;
}

/**
 * Demande l'asset en passant par le service worker. Celui-ci le sert depuis le
 * cache de SA version active, ou le télécharge et l'y range avant de répondre ;
 * hors-ligne, un asset absent rend une erreur 504. Le corps n'est pas lu :
 * seule la disponibilité compte.
 *
 * C'est plus juste que `caches.match`, qui parcourt aussi les caches d'une
 * version précédente que le service worker ne sert plus.
 */
export async function fetchAsset(path: string): Promise<boolean> {
  try {
    const res = await fetch(absoluteAssetUrl(path));
    void res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Présence approchée dans un cache de l'origine, sans aucune requête : sert
 * seulement à compter les plateaux quand le téléchargement attend l'accord du
 * joueur (RG_42, économie de données).
 */
export async function isAssetCached(path: string): Promise<boolean> {
  const caches = globalThis.caches;
  if (!caches) return false;
  try {
    return (await caches.match(absoluteAssetUrl(path))) !== undefined;
  } catch {
    return false;
  }
}
