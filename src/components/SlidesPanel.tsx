import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { Alert, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { SlidesOptions } from 'types';
import { HIDE_CHROME_CSS } from '../chrome';
import { grafanaPath, pdfjs, resolveGrafanaUrl, SlideLink } from '../pdf';
import { PdfPage } from './PdfPage';
import { PresenterView } from './PresenterView';

/** Query param holding the current slide, so a browser refresh mid-talk keeps your place. */
const SLIDE_PARAM = 'slide';
/** Query param that turns a window into the presenter view (opened with the S key). */
const PRESENTER_PARAM = 'presenter';

const SLIDE_BACKGROUND = '#000';

/**
 * Kiosk mode's "Powered by Grafana" footer. It's normally hidden, but if a Grafana upgrade stops the
 * hiding from working, the full-window slide leaves room for it rather than covering it.
 */
const FOOTER_SELECTOR = '[data-testid="public-dashboard-footer"]';
const WINDOW_POLL_MS = 500;

const NEXT_KEYS =new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'p']);
/** `.` is what most clickers send for their "blank screen" button. */
const BLANK_KEYS = new Set(['b', 'B', '.']);
const GOTO_TIMEOUT_MS = 3000;
/** True when this deck is itself shown live on a slide (inside an iframe). */
const EMBEDDED = window.self !== window.top;

/**
 * Messages between the audience and presenter windows. They share a BroadcastChannel named after
 * the PDF URL, so only windows showing the same deck (in the same browser) stay in sync.
 *
 * `at` is when that state was last changed by a person. Several windows may answer a `hello`, and a
 * forgotten or throttled one can be behind, so a window only accepts state newer than its own.
 */
type DeckMessage =
  | { type: 'hello' }
  | { type: 'page'; page: number; at: number }
  | { type: 'blank'; blank: boolean; at: number };

interface Props extends PanelProps<SlidesOptions> {}

function readSlideFromUrl(): number {
  const value = Number(locationService.getSearchObject()[SLIDE_PARAM]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** Ignore keys typed into inputs (panel editor, search box) so they don't flip slides. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Channel messages come from our own origin, but are still checked before use. */
function parseMessage(data: unknown): DeckMessage | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const message = data as Record<string, unknown>;
  if (message.type === 'hello') {
    return { type: 'hello' };
  }
  if (typeof message.at !== 'number') {
    return undefined;
  }
  if (message.type === 'page' && typeof message.page === 'number' && Number.isInteger(message.page)) {
    return { type: 'page', page: message.page, at: message.at };
  }
  if (message.type === 'blank' && typeof message.blank === 'boolean') {
    return { type: 'blank', blank: message.blank, at: message.at };
  }
  return undefined;
}

function isKiosk(): boolean {
  return locationService.getSearchObject().kiosk !== undefined;
}

/** Tracks kiosk mode, which can be left with Esc while the panel stays mounted. */
function useKioskMode(): boolean {
  const [kiosk, setKiosk] = useState(isKiosk);
  useEffect(() => locationService.getHistory().listen(() => setKiosk(isKiosk())), []);
  return kiosk;
}

/**
 * The space a full-window slide gets: the browser window minus the kiosk footer. Polled rather than
 * event-driven because the footer appears after load and fullscreen/resizes come from several places;
 * state only changes when the size actually does.
 */
function useWindowBox(enabled: boolean): { width: number; height: number; bottom: number } | undefined {
  const [box, setBox] = useState<{ width: number; height: number; bottom: number }>();
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const measure = () => {
      const bottom = Math.ceil(document.querySelector(FOOTER_SELECTOR)?.getBoundingClientRect().height ?? 0);
      const next = { width: window.innerWidth, height: window.innerHeight - bottom, bottom };
      setBox((prev) =>
        prev && prev.width === next.width && prev.height === next.height && prev.bottom === next.bottom ? prev : next
      );
    };
    measure();
    const timer = window.setInterval(measure, WINDOW_POLL_MS);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [enabled]);
  return enabled ? box : undefined;
}

function resolveNotesUrl(options: SlidesOptions): string {
  const raw = options.notesUrl?.trim() || `${options.pdfUrl.trim().replace(/\.pdf$/i, '')}.md`;
  return resolveGrafanaUrl(raw);
}

function toggleFullscreen() {
  const request = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
  request.catch(() => {
    // The browser refused (e.g. fullscreen disabled by policy); the deck keeps working without it.
  });
}

function openPresenterWindow(page: number) {
  const url = new URL(window.location.href);
  url.searchParams.set(PRESENTER_PARAM, '1');
  url.searchParams.set(SLIDE_PARAM, String(page));
  window.open(url.toString(), 'athul-slides-presenter', 'popup,width=1280,height=800');
}

const getStyles = (theme: GrafanaTheme2) => {
  const badge = css`
    position: absolute;
    padding: ${theme.spacing(0.25, 1)};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    opacity: 0.8;
  `;
  return {
    wrapper: css`
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
    `,
    counter: css`
      right: ${theme.spacing(1)};
      bottom: ${theme.spacing(1)};
    `,
    goto: css`
      top: ${theme.spacing(1)};
      right: ${theme.spacing(1)};
      font-size: ${theme.typography.h4.fontSize};
    `,
    badge,
    progress: css`
      position: absolute;
      left: 0;
      bottom: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.6);
      transition: width 300ms ease-out;
    `,
    blank: css`
      position: absolute;
      inset: 0;
      z-index: 1;
      background: ${SLIDE_BACKGROUND};
      cursor: default;
    `,
    message: css`
      padding: ${theme.spacing(2)};
      cursor: default;
    `,
    fullWindow: css`
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: ${theme.zIndex.modal};
      background: ${SLIDE_BACKGROUND};
    `,
  };
};

/**
 * Presents a PDF deck one page at a time, scaled to fit the panel.
 *
 * Keys (listened for on the window so they work in kiosk mode without focusing the panel):
 * - Right/Down/PageDown/Space/N next, Left/Up/PageUp/P previous, Home/End first/last
 * - a number then Enter jumps to that slide
 * - B or . blanks the screen, F toggles fullscreen, S opens the presenter view
 *
 * Clicking the slide advances; PDF links are clickable, and links to Grafana panels (`/d-solo/...`)
 * and dashboards (`/d/...`) on this Grafana are shown live in place.
 */
export const SlidesPanel: React.FC<Props> = ({ options, width, height }) => {
  const styles = useStyles2(getStyles);
  const rootRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<BroadcastChannel | undefined>(undefined);
  const [loaded, setLoaded] = useState<{ url: string; doc?: PDFDocumentProxy; error?: string }>();
  const [renderError, setRenderError] = useState<string>();
  const [requestedPage, setPage] = useState(readSlideFromUrl);
  const [blank, setBlank] = useState(false);
  const [gotoBuffer, setGotoBuffer] = useState('');
  const [notes, setNotes] = useState<{ url: string; sections: string[] }>();
  const [presenter] = useState(() => locationService.getSearchObject()[PRESENTER_PARAM] !== undefined);
  // In kiosk mode the slide fills the browser window (not just the panel), so the dashboard doesn't
  // need ?autofitpanels, which delays plugin loading by several seconds on Grafana 13.
  const kiosk = useKioskMode();
  const windowBox = useWindowBox(kiosk);
  const boxWidth = windowBox?.width ?? width;
  const boxHeight = windowBox?.height ?? height;

  const url = options.pdfUrl?.trim() ? resolveGrafanaUrl(options.pdfUrl) : undefined;

  // Load (or reload) the PDF whenever the URL option changes.
  useEffect(() => {
    if (!url) {
      return;
    }
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (doc) => setLoaded({ url, doc }),
      (err: Error) => {
        // destroy() during unmount rejects the promise too; that isn't a real failure.
        if (!task.destroyed) {
          setLoaded({ url, error: `Could not load ${url}: ${err.message}` });
        }
      }
    );
    return () => {
      task.destroy();
    };
  }, [url]);

  // Results from a previous URL are stale until the new one finishes loading.
  const current = loaded?.url === url ? loaded : undefined;
  const doc = current?.doc;
  const error = !url ? 'Set a PDF URL in the panel options.' : (current?.error ?? renderError);

  const pageCount = doc?.numPages ?? 0;
  // Keep the page in range once we know how many there are (e.g. ?slide=99 on a 10-page deck).
  const page = pageCount > 0 ? Math.min(Math.max(requestedPage, 1), pageCount) : requestedPage;

  // Mirror the page into the URL. `replace` avoids filling browser history with every slide.
  useEffect(() => {
    if (pageCount > 0) {
      locationService.partial({ [SLIDE_PARAM]: page }, true);
    }
  }, [page, pageCount]);

  // Speaker notes are only needed in the presenter window. A missing file just means "no notes".
  const notesUrl = presenter && url ? resolveNotesUrl(options) : undefined;
  useEffect(() => {
    if (!notesUrl) {
      return;
    }
    const controller = new AbortController();
    fetch(notesUrl, { signal: controller.signal })
      .then((response) =>
        // Guard against an HTML error/fallback page being shown as notes.
        response.ok && !(response.headers.get('content-type') ?? '').includes('text/html') ? response.text() : ''
      )
      .then((text) => setNotes({ url: notesUrl, sections: text ? text.split(/^\s*---\s*$/m).map((s) => s.trim()) : [] }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setNotes({ url: notesUrl, sections: [] });
        }
      });
    return () => controller.abort();
  }, [notesUrl]);
  const currentNotes = (notes?.url === notesUrl && notes?.sections[page - 1]) || undefined;

  const post = useCallback((message: DeckMessage) => channelRef.current?.postMessage(message), []);
  // When this window's page / blank state last changed (0 = never, e.g. just opened).
  const pageAtRef = useRef(0);
  const blankAtRef = useRef(0);

  const go = useCallback(
    (target: number) => {
      if (pageCount === 0) {
        return;
      }
      const next = Math.min(Math.max(target, 1), pageCount);
      const at = Date.now();
      pageAtRef.current = at;
      setPage(next);
      post({ type: 'page', page: next, at });
    },
    [pageCount, post]
  );

  const shareBlank = useCallback(
    (value: boolean) => {
      const at = Date.now();
      blankAtRef.current = at;
      setBlank(value);
      post({ type: 'blank', blank: value, at });
    },
    [post]
  );

  // Keep the audience and presenter windows in sync. A window that (re)opens says hello and the
  // others answer with where the talk is; the newest answer wins.
  const onMessageRef = useRef<(message: DeckMessage) => void>(() => {});
  useEffect(() => {
    onMessageRef.current = (message) => {
      if (message.type === 'hello') {
        if (pageAtRef.current > 0) {
          post({ type: 'page', page, at: pageAtRef.current });
        }
        if (blankAtRef.current > 0) {
          post({ type: 'blank', blank, at: blankAtRef.current });
        }
      } else if (message.type === 'page' && message.at > pageAtRef.current) {
        pageAtRef.current = message.at;
        setPage(message.page);
      } else if (message.type === 'blank' && message.at > blankAtRef.current) {
        blankAtRef.current = message.at;
        setBlank(message.blank);
      }
    };
  });
  useEffect(() => {
    // A deck embedded on a slide (the "it's Grafana" reveal) must not join in: it would follow the
    // outer deck to the slide that embeds it and nest itself again.
    if (!url || typeof BroadcastChannel === 'undefined' || EMBEDDED) {
      return;
    }
    const channel = new BroadcastChannel(`athul-slides:${url}`);
    channel.onmessage = (event) => {
      const message = parseMessage(event.data);
      if (message) {
        onMessageRef.current(message);
      }
    };
    channelRef.current = channel;
    channel.postMessage({ type: 'hello' } satisfies DeckMessage);
    return () => {
      channel.close();
      channelRef.current = undefined;
    };
  }, [url]);

  const onLink = useCallback(
    (link: SlideLink) => {
      if (link.kind === 'page') {
        go(link.page);
      } else if (link.kind === 'nav') {
        const targets = { NextPage: page + 1, PrevPage: page - 1, FirstPage: 1, LastPage: pageCount };
        go(targets[link.action]);
      } else {
        // Grafana links navigate inside Grafana (fast, and Back returns to this slide).
        const path = grafanaPath(link.url);
        if (path) {
          locationService.push(path);
        } else {
          window.location.assign(link.url);
        }
      }
    },
    [go, page, pageCount]
  );

  // A typed slide number is forgotten if Enter doesn't follow soon.
  useEffect(() => {
    if (!gotoBuffer) {
      return;
    }
    const timer = window.setTimeout(() => setGotoBuffer(''), GOTO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [gotoBuffer]);

  const handleKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) {
      return;
    }
    const key = e.key;
    if (/^[0-9]$/.test(key)) {
      setGotoBuffer((buffer) => (buffer + key).slice(-4));
    } else if (key === 'Enter' && gotoBuffer) {
      go(Number(gotoBuffer));
      setGotoBuffer('');
    } else if (NEXT_KEYS.has(key)) {
      go(page + 1);
    } else if (PREV_KEYS.has(key)) {
      go(page - 1);
    } else if (key === 'Home') {
      go(1);
    } else if (key === 'End') {
      go(pageCount);
    } else if (BLANK_KEYS.has(key)) {
      shareBlank(!blank);
    } else if (key === 'f' || key === 'F') {
      toggleFullscreen();
    } else if ((key === 's' || key === 'S') && !presenter) {
      openPresenterWindow(page);
    } else {
      return;
    }
    // Stop Space/PageDown/arrows from also scrolling the dashboard.
    e.preventDefault();
  };

  // One stable listener that always calls the latest handler; it's also handed to live-panel
  // iframes so keys pressed inside them still drive the deck.
  const keyHandlerRef = useRef(handleKey);
  useEffect(() => {
    keyHandlerRef.current = handleKey;
  });
  const dispatchKey = useCallback((e: KeyboardEvent) => keyHandlerRef.current(e), []);
  useEffect(() => {
    window.addEventListener('keydown', dispatchKey);
    return () => window.removeEventListener('keydown', dispatchKey);
  }, [dispatchKey]);

  // Hide the footer and empty controls bar only while a slides panel is on screen, so other dashboards keep it.
  // An embedded deck keeps them: there, showing Grafana is the point.
  useEffect(() => {
    if (EMBEDDED) {
      return;
    }
    const style = document.createElement('style');
    style.textContent = HIDE_CHROME_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // In kiosk mode, paint everything behind the slide black so Grafana's grey page padding and the
  // letterbox bars blend into the slides. Walking our own ancestors avoids depending on Grafana's
  // internal class names; the previous values are restored when the panel goes away.
  useEffect(() => {
    if (!kiosk) {
      return;
    }
    const restore: Array<[HTMLElement, string]> = [];
    for (let el: HTMLElement | null = rootRef.current; el; el = el.parentElement) {
      restore.push([el, el.style.background]);
      el.style.background = SLIDE_BACKGROUND;
    }
    return () => restore.forEach(([el, background]) => (el.style.background = background));
  }, [kiosk]);

  if (error) {
    return (
      <div className={styles.message} ref={rootRef}>
        <Alert severity="error" title="Slides">
          {error}
        </Alert>
      </div>
    );
  }

  // Rendered into <body> in kiosk mode so no Grafana layout wrapper can clip or offset the slide.
  const place = (content: React.ReactElement) =>
    windowBox ? createPortal(<div className={styles.fullWindow} style={{ bottom: windowBox.bottom }}>{content}</div>, document.body) : content;

  if (presenter && doc) {
    return place(
      <div ref={rootRef}>
        <PresenterView
          doc={doc}
          page={page}
          pageCount={pageCount}
          width={boxWidth}
          height={boxHeight}
          notes={currentNotes}
          notesSource={notesUrl ?? ''}
          blank={blank}
          onNext={() => go(page + 1)}
          onError={setRenderError}
        />
      </div>
    );
  }

  return place(
    <div className={styles.wrapper} ref={rootRef} style={{ width: boxWidth, height: boxHeight }} onClick={() => go(page + 1)}>
      {!doc && <LoadingPlaceholder text="Loading slides…" />}
      {doc && (
        <PdfPage
          doc={doc}
          page={page}
          width={boxWidth}
          height={boxHeight}
          fade={options.transition !== 'none'}
          interactive
          onLink={onLink}
          onFrameKeyDown={dispatchKey}
          onError={setRenderError}
          testId="slides-canvas"
        />
      )}
      {doc && options.showProgress && (
        <div className={styles.progress} style={{ width: `${(page / pageCount) * 100}%` }} data-testid="slides-progress" />
      )}
      {doc && options.showPageNumber && (
        <div className={`${styles.badge} ${styles.counter}`} data-testid="slides-counter">
          {page} / {pageCount}
        </div>
      )}
      {gotoBuffer && <div className={`${styles.badge} ${styles.goto}`}>Go to {gotoBuffer}</div>}
      {blank && (
        <div
          className={styles.blank}
          data-testid="slides-blank"
          onClick={(e) => {
            e.stopPropagation();
            shareBlank(false);
          }}
        />
      )}
    </div>
  );
};
