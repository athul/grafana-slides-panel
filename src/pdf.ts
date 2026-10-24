import { config } from '@grafana/runtime';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

// Webpack emits the worker as its own file inside the plugin's dist folder and rewrites this URL to
// point at it, so the worker is served by Grafana itself (works offline and under a sub-path).
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export { pdfjs };

type PageViewport = ReturnType<PDFPageProxy['getViewport']>;

type NavAction = 'NextPage' | 'PrevPage' | 'FirstPage' | 'LastPage';

/** A box on the slide, in CSS pixels relative to the slide's top-left corner. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Something clickable (or live) on a slide, taken from the PDF's link annotations:
 * - `page`: a link to another slide in the deck
 * - `nav`: a named PDF action such as NextPage
 * - `url`: an ordinary web link
 * - `embed`: a link on this Grafana to a solo panel (`/d-solo/...`) or a dashboard (`/d/...`), shown
 *   live in place. `showChrome` marks a link to the deck's own dashboard: it is shown with Grafana's
 *   full UI, to reveal what the talk runs on.
 */
export type SlideLink =
  | { kind: 'page'; page: number; rect: Rect }
  | { kind: 'nav'; action: NavAction; rect: Rect }
  | { kind: 'url' | 'embed'; url: string; rect: Rect; showChrome?: boolean };

/** The subset of pdf.js's (untyped) annotation objects that we read. */
interface LinkAnnotation {
  subtype?: string;
  rect: number[];
  url?: string;
  dest?: string | unknown[];
  action?: string;
}

const NAV_ACTIONS: readonly string[] = ['NextPage', 'PrevPage', 'FirstPage', 'LastPage'];

function isNavAction(action: string | undefined): action is NavAction {
  return action !== undefined && NAV_ACTIONS.includes(action);
}

/**
 * Resolves a location from panel options or a PDF link. Absolute http(s) URLs pass through
 * untouched; anything else is treated as a path on this Grafana and prefixed with its sub-path
 * (e.g. `/grafana`), so the same option value works whether Grafana is served from `/` or not.
 */
export function resolveGrafanaUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `${config.appSubUrl}/${trimmed.replace(/^\/+/, '')}`;
}

/** The Grafana-relative path for a same-origin Grafana URL, or undefined for anything else. */
export function grafanaPath(url: string): string | undefined {
  const parsed = new URL(url, window.location.href);
  const prefix = `${config.appSubUrl}/`;
  if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith(prefix)) {
    return undefined;
  }
  return parsed.pathname.slice(config.appSubUrl.length) + parsed.search + parsed.hash;
}

/**
 * Only http(s) links are kept: a slide must never be able to run `javascript:` or similar.
 * Same-origin solo-panel and kiosk-dashboard links become live embeds; everything else stays a
 * plain link.
 */
function classifyUrl(raw: string): { kind: 'url' | 'embed'; url: string; showChrome?: boolean } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.href);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  const path = grafanaPath(parsed.toString());
  if (path?.startsWith('/d-solo/')) {
    // Solo panels carry their own "Powered by Grafana" badge; slides shouldn't show it.
    parsed.searchParams.set('hideLogo', 'true');
    return { kind: 'embed', url: parsed.toString() };
  }
  // Any dashboard on this Grafana is shown live, so deck authors can paste plain dashboard links.
  if (path?.startsWith('/d/')) {
    if (dashboardUid(path) === dashboardUid(grafanaPath(window.location.href))) {
      // The deck's own dashboard: shown out of kiosk mode, so the slide reveals the deck running
      // inside Grafana. The embedded deck doesn't sync with this one (see SlidesPanel), so it stays
      // on its own slide instead of following us here and nesting itself again.
      parsed.searchParams.delete('kiosk');
      // Fit the slides panel into the box; at its normal height the slide would be cut off.
      parsed.searchParams.set('autofitpanels', 'true');
      return { kind: 'embed', url: parsed.toString(), showChrome: true };
    }
    // Force kiosk mode (Grafana only accepts `kiosk` / `kiosk=true`; an empty `kiosk=` as some tools
    // write it would show the full Grafana UI inside the slide).
    parsed.searchParams.set('kiosk', 'true');
    return { kind: 'embed', url: parsed.toString() };
  }
  return { kind: 'url', url: parsed.toString() };
}

/** The dashboard uid in a Grafana path like `/d/<uid>/<slug>`, or undefined for any other path. */
function dashboardUid(path: string | undefined): string | undefined {
  return path?.startsWith('/d/') ? path.split(/[/?#]/)[2] : undefined;
}

/** Turns a PDF destination (named or explicit) into a 1-based page number. */
async function resolveDestination(doc: PDFDocumentProxy, dest: string | unknown[]): Promise<number | undefined> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const target = explicit?.[0];
    if (typeof target === 'number') {
      return target + 1;
    }
    if (target && typeof target === 'object') {
      return (await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1;
    }
  } catch {
    // A broken destination just means the link is skipped; the slide itself still renders.
  }
  return undefined;
}

/** Reads the links on a page and maps their boxes into the given (CSS-pixel) viewport. */
export async function getSlideLinks(
  doc: PDFDocumentProxy,
  pdfPage: PDFPageProxy,
  viewport: PageViewport
): Promise<SlideLink[]> {
  const annotations = (await pdfPage.getAnnotations({ intent: 'display' })) as LinkAnnotation[];
  const links: SlideLink[] = [];

  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link') {
      continue;
    }
    const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]) as number[];
    const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]) as number[];
    const rect = {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };

    if (annotation.url) {
      const target = classifyUrl(annotation.url);
      if (target) {
        links.push({ ...target, rect });
      }
    } else if (annotation.dest) {
      const page = await resolveDestination(doc, annotation.dest);
      if (page) {
        links.push({ kind: 'page', page, rect });
      }
    } else if (isNavAction(annotation.action)) {
      links.push({ kind: 'nav', action: annotation.action, rect });
    }
  }
  return links;
}
