import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { HIDE_CHROME_CSS } from '../chrome';
import { getSlideLinks, pdfjs, SlideLink } from '../pdf';

const FADE_MS = 300;

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  /** The box to fit the slide into; the slide keeps its own aspect ratio inside it. */
  width: number;
  height: number;
  /** Cross-fade from the previous slide (skipped when the OS asks for reduced motion). */
  fade?: boolean;
  /** Make PDF links clickable and show live panels. Off for presenter-view thumbnails. */
  interactive?: boolean;
  onLink?: (link: SlideLink) => void;
  /** Keys pressed inside a live panel, so navigation keeps working after clicking into one. */
  onFrameKeyDown?: (e: KeyboardEvent) => void;
  onError?: (message: string) => void;
  testId?: string;
}

const styles = {
  slide: css`
    position: relative;
    flex: none;
  `,
  layer: css`
    position: absolute;
    top: 0;
    left: 0;
  `,
  link: css`
    position: absolute;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  `,
  frame: css`
    position: absolute;
    border: 0;
  `,
};

/**
 * Draws one PDF page scaled to fit `width` x `height`.
 *
 * The page is rendered off-screen first and copied over in one step, so the visible canvas never goes
 * blank while the next slide is drawn. For fades, the previous image is kept on a canvas underneath
 * and the new one fades in on top.
 */
export const PdfPage: React.FC<Props> = ({
  doc,
  page,
  width,
  height,
  fade = false,
  interactive = false,
  onLink,
  onFrameKeyDown,
  onError,
  testId,
}) => {
  const frontRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState<{ width: number; height: number; links: SlideLink[] }>();

  useEffect(() => {
    if (width <= 0 || height <= 0) {
      return;
    }
    let cancelled = false;
    let renderTask: RenderTask | undefined;

    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) {
        return;
      }
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min(width / base.width, height / base.height);
      const dpr = window.devicePixelRatio || 1;
      const cssViewport = pdfPage.getViewport({ scale: fit });
      const viewport = pdfPage.getViewport({ scale: fit * dpr });

      const offscreen = document.createElement('canvas');
      offscreen.width = Math.floor(viewport.width);
      offscreen.height = Math.floor(viewport.height);
      renderTask = pdfPage.render({ canvas: offscreen, viewport });
      const links = interactive ? getSlideLinks(doc, pdfPage, cssViewport) : Promise.resolve([]);
      await renderTask.promise;
      const resolvedLinks = await links;

      const front = frontRef.current;
      const back = backRef.current;
      if (cancelled || !front || !back) {
        return;
      }

      const animate = fade && front.width > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (animate) {
        copyCanvas(front, back);
      }
      copyCanvas(offscreen, front);
      front.style.width = back.style.width = `${Math.floor(cssViewport.width)}px`;
      front.style.height = back.style.height = `${Math.floor(cssViewport.height)}px`;

      if (animate) {
        const animation = front.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
        animation.onfinish = () => (back.width = 0);
      } else {
        back.width = 0;
      }

      setRendered({
        width: Math.floor(cssViewport.width),
        height: Math.floor(cssViewport.height),
        links: resolvedLinks,
      });
    })().catch((err: Error) => {
      if (!cancelled && !(err instanceof pdfjs.RenderingCancelledException)) {
        onError?.(`Could not render slide ${page}: ${err.message}`);
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, page, width, height, fade, interactive, onError]);

  return (
    <div className={styles.slide} style={{ width: rendered?.width ?? 0, height: rendered?.height ?? 0 }}>
      <canvas ref={backRef} className={styles.layer} />
      <canvas ref={frontRef} className={styles.layer} data-testid={testId} />
      {rendered?.links.map((link, i) => {
        const box = { left: link.rect.left, top: link.rect.top, width: link.rect.width, height: link.rect.height };
        if (link.kind === 'embed') {
          return (
            <iframe
              key={`${page}-${i}`}
              className={styles.frame}
              style={box}
              src={link.url}
              title="Live Grafana panel"
              onLoad={(e) => !link.showChrome && prepareFrame(e.currentTarget, onFrameKeyDown)}
            />
          );
        }
        return (
          <button
            key={`${page}-${i}`}
            type="button"
            className={styles.link}
            style={box}
            aria-label={link.kind === 'url' ? `Open ${link.url}` : 'Go to slide'}
            onClick={(e) => {
              // Don't let the click also reach the "click anywhere to advance" handler.
              e.stopPropagation();
              onLink?.(link);
            }}
          />
        );
      })}
    </div>
  );
};

function copyCanvas(from: HTMLCanvasElement, to: HTMLCanvasElement) {
  to.width = from.width;
  to.height = from.height;
  to.getContext('2d')?.drawImage(from, 0, 0);
}

/**
 * Live panels are same-origin iframes, so we can reach into them (except the deck's own dashboard,
 * which keeps Grafana's UI and its own keys, so it can be clicked through as a demo):
 * - hide Grafana's footer and controls bar in embedded kiosk dashboards, as on the slides page
 * - forward key presses to the deck; otherwise clicking into a panel would swallow the
 *   clicker/arrow keys until you clicked back out
 */
function prepareFrame(frame: HTMLIFrameElement, onKeyDown?: (e: KeyboardEvent) => void) {
  try {
    const frameDocument = frame.contentDocument;
    if (frameDocument) {
      const style = frameDocument.createElement('style');
      style.textContent = HIDE_CHROME_CSS;
      frameDocument.head.appendChild(style);
    }
    if (onKeyDown) {
      frame.contentWindow?.addEventListener('keydown', onKeyDown);
    }
  } catch {
    // Cross-origin frame (shouldn't happen for Grafana links): it just shows as Grafana renders it.
  }
}
