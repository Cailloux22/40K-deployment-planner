import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import {
  DeploymentShareInfo,
  SHARE_BANNER_BACKGROUND,
  SHARE_BANNER_TEXT,
  SHARE_IMAGE_QUALITY,
  SHARE_IMAGE_TYPE,
  shareFileName,
  shareFooterLines,
  shareHeaderText,
  shareImageLayout,
  truncateToWidth,
} from '../deployment/share-image';
import { Board } from '../models/referential.models';
import { ReferentialService } from '../referentials/referential.service';

/** RT_75: issue d'un partage, pour le message à afficher (ou non). */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * EX_15 — partage d'un déploiement terminé en image JPG.
 *
 * RT_74: composition dans un canvas aux dimensions natives du plateau, plus
 * un bandeau d'en-tête et un bandeau de pied. RT_75: transmission à la feuille
 * de partage du système (plugins Capacitor en natif, Web Share API en web),
 * avec repli par téléchargement.
 */
@Injectable({ providedIn: 'root' })
export class DeploymentShareService {
  private readonly referential = inject(ReferentialService);

  /** RT_74 puis RT_75 : compose l'image et la transmet. */
  async share(
    board: Board,
    boardUrl: string,
    overlay: SVGSVGElement | null,
    info: DeploymentShareInfo,
  ): Promise<ShareOutcome> {
    const blob = await this.compose(board, boardUrl, overlay, info);
    return this.send(blob, shareFileName(info), shareHeaderText(info));
  }

  /** RT_74: image JPG du plateau, des tokens et des deux bandeaux. */
  async compose(
    board: Board,
    boardUrl: string,
    overlay: SVGSVGElement | null,
    info: DeploymentShareInfo,
  ): Promise<Blob> {
    const footer = shareFooterLines(info, await this.referential.shareImageAttributions());
    // RT_74: cadrage de l'éditeur de placement (RT_19) — le rectangle de jeu
    // mesuré seul, sans bandeau de titre, légende ni marges de l'image source.
    const crop = board.playArea;
    const layout = shareImageLayout(crop, footer.length);

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');

    // RT_74: fond opaque partout — le JPEG n'a pas de canal alpha.
    ctx.fillStyle = SHARE_BANNER_BACKGROUND;
    ctx.fillRect(0, 0, layout.width, layout.height);

    // RT_74: plateau rogné au rectangle de jeu, à l'échelle native (repère des
    // placements, RT_04), décalé de la hauteur de l'en-tête.
    const boardImage = await loadImage(boardUrl);
    drawCropped(ctx, boardImage, crop, layout.headerHeight);

    // RT_74: calque SVG des tokens du visualiseur, sérialisé plutôt que redessiné.
    if (overlay) {
      const tokensUrl = URL.createObjectURL(serializeOverlay(overlay, board));
      try {
        const tokens = await loadImage(tokensUrl);
        drawCropped(ctx, tokens, crop, layout.headerHeight);
      } finally {
        URL.revokeObjectURL(tokensUrl);
      }
    }

    const maxTextWidth = layout.width - 2 * layout.padding;
    ctx.fillStyle = SHARE_BANNER_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // RG_56: en-tête — dispositions, « Layout » et lettre.
    ctx.font = `700 ${layout.headerFontSize}px ${FONT_FAMILY}`;
    ctx.fillText(
      truncateToWidth(shareHeaderText(info), maxTextWidth, (text) => ctx.measureText(text).width),
      layout.width / 2,
      layout.headerHeight / 2,
    );

    // RG_56: pied — nom de la liste puis mentions de source (RT_20).
    ctx.font = `400 ${layout.footerFontSize}px ${FONT_FAMILY}`;
    const lineHeight = layout.footerFontSize * 1.4;
    const footerTop = layout.headerHeight + crop.height + layout.padding;
    footer.forEach((line, index) => {
      ctx.fillText(
        truncateToWidth(line, maxTextWidth, (text) => ctx.measureText(text).width),
        layout.width / 2,
        footerTop + lineHeight * (index + 0.5),
      );
    });

    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Export JPG impossible'))),
        SHARE_IMAGE_TYPE,
        SHARE_IMAGE_QUALITY,
      ),
    );
  }

  /** RT_75: feuille de partage du système, ou téléchargement en repli. */
  private async send(blob: Blob, fileName: string, title: string): Promise<ShareOutcome> {
    if (Capacitor.isNativePlatform()) return this.sendNative(blob, fileName, title);

    const file = new File([blob], fileName, { type: SHARE_IMAGE_TYPE });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (error) {
        if (isAbort(error)) return 'cancelled';
        // RT_75: activation utilisateur expirée pendant la composition.
        if (!(error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
      }
    }
    download(blob, fileName);
    return 'downloaded';
  }

  /** RT_75: fichier écrit dans le cache de l'application, puis partagé par son URI. */
  private async sendNative(blob: Blob, fileName: string, title: string): Promise<ShareOutcome> {
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: await toBase64(blob),
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title, files: [uri] });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      throw error;
    }
  }
}

/** RT_74: même rognage pour le plateau et le calque des tokens (repère de l'asset entier). */
function drawCropped(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: Board['playArea'],
  top: number,
): void {
  ctx.drawImage(image, crop.left, crop.top, crop.width, crop.height, 0, top, crop.width, crop.height);
}

/**
 * RT_74: copie autonome du calque des tokens — les couleurs portées par des
 * variables CSS de thème (RT_29) sont résolues en valeurs littérales, une
 * image SVG isolée ne recevant pas la feuille de style de l'application.
 */
function serializeOverlay(overlay: SVGSVGElement, board: Board): Blob {
  const clone = overlay.cloneNode(true) as SVGSVGElement;
  const originals = [overlay, ...Array.from(overlay.querySelectorAll('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((original, index) => {
    const copy = copies[index];
    for (const attribute of ['fill', 'stroke'] as const) {
      const value = copy.getAttribute(attribute);
      if (value?.includes('var(')) copy.setAttribute(attribute, getComputedStyle(original)[attribute]);
    }
  });
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(board.width));
  clone.setAttribute('height', String(board.height));
  clone.removeAttribute('class');
  const markup = new XMLSerializer().serializeToString(clone);
  return new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image illisible : ${url.slice(0, 60)}`));
    image.src = url;
  });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** RT_75: repli web — lien `<a download>` sur une URL d'objet révoquée aussitôt. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Laisse au navigateur le temps de lancer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** RT_75: annulation par le joueur — `AbortError` en web, « canceled » du plugin en natif. */
function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /cancel/i.test(message);
}
