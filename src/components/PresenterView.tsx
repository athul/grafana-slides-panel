import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';

const GAP = 16;
const HEADER_HEIGHT = 48;
const LABEL_HEIGHT = 24;

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  pageCount: number;
  width: number;
  height: number;
  /** Notes for the current slide; undefined while loading or when the deck has no notes file. */
  notes?: string;
  notesSource: string;
  blank: boolean;
  onNext: () => void;
  onError: (message: string) => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: ${GAP}px;
    padding: ${GAP}px;
    color: ${theme.colors.text.primary};
    font-variant-numeric: tabular-nums;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(3)};
    height: ${HEADER_HEIGHT}px;
    font-size: ${theme.typography.h3.fontSize};
  `,
  timer: css`
    padding: ${theme.spacing(0.5, 1.5)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  `,
  muted: css`
    color: ${theme.colors.text.secondary};
  `,
  hint: css`
    margin-left: auto;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  body: css`
    display: flex;
    gap: ${GAP}px;
    min-height: 0;
  `,
  column: css`
    display: flex;
    flex-direction: column;
    gap: ${GAP / 2}px;
    min-width: 0;
  `,
  label: css`
    height: ${LABEL_HEIGHT}px;
    color: ${theme.colors.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  stage: css`
    display: flex;
    align-items: flex-start;
    justify-content: center;
    cursor: pointer;
  `,
  blankBadge: css`
    color: ${theme.colors.warning.text};
  `,
  notes: css`
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: ${theme.typography.h4.fontSize};
    line-height: 1.5;
  `,
});

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The speaker's window: current slide, next slide, notes, an elapsed timer (click to reset) and a
 * clock. It stays in sync with the audience window through the deck channel in SlidesPanel.
 * Thumbnails here are not interactive, so live panels are only queried in the audience window.
 */
export const PresenterView: React.FC<Props> = ({
  doc,
  page,
  pageCount,
  width,
  height,
  notes,
  notesSource,
  blank,
  onNext,
  onError,
}) => {
  const styles = useStyles2(getStyles);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const bodyHeight = Math.max(0, height - HEADER_HEIGHT - GAP * 3);
  const currentWidth = Math.floor((width - GAP * 3) * 0.62);
  const sideWidth = Math.max(0, width - GAP * 3 - currentWidth);
  const nextHeight = Math.floor(bodyHeight * 0.45);
  const notesHeight = Math.max(0, bodyHeight - nextHeight - LABEL_HEIGHT * 2 - GAP);
  const hasNext = page < pageCount;

  return (
    <div className={styles.root} style={{ width, height }}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.timer}
          title="Click to reset the timer"
          onClick={() => {
            setStartedAt(Date.now());
            setNow(Date.now());
          }}
        >
          {formatElapsed(now - startedAt)}
        </button>
        <span className={styles.muted}>
          {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span>
          Slide {page} / {pageCount}
        </span>
        {blank && <span className={styles.blankBadge}>Screen blanked (B)</span>}
        <span className={styles.hint}>→ / ← navigate · B blank · F fullscreen · number + Enter jump</span>
      </div>

      <div className={styles.body} style={{ height: bodyHeight }}>
        <div className={styles.column} style={{ width: currentWidth }}>
          <div className={styles.label}>Current</div>
          <div className={styles.stage} onClick={onNext}>
            <PdfPage doc={doc} page={page} width={currentWidth} height={bodyHeight - LABEL_HEIGHT} onError={onError} />
          </div>
        </div>

        <div className={styles.column} style={{ width: sideWidth }}>
          <div className={styles.label}>Next</div>
          <div className={styles.stage} style={{ height: nextHeight }}>
            {hasNext ? (
              <PdfPage doc={doc} page={page + 1} width={sideWidth} height={nextHeight} onError={onError} />
            ) : (
              <span className={styles.muted}>End of deck</span>
            )}
          </div>
          <div className={styles.label}>Notes</div>
          <div className={styles.notes} style={{ height: notesHeight }}>
            {notes ?? <span className={styles.muted}>No notes. Add them to {notesSource}, one section per slide separated by ---.</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
