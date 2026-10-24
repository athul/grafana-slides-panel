export interface SlidesOptions {
  /**
   * Where the PDF deck lives. Relative paths (e.g. `public/slides/deck.pdf`) are resolved against
   * Grafana's sub-path, so the same value works whether Grafana is served from `/` or `/grafana/`.
   * Absolute URLs work too, but the host must allow CORS requests from Grafana's origin.
   */
  pdfUrl: string;
  /**
   * Speaker notes for the presenter view: plain text, one section per slide, separated by lines
   * containing only `---`. Empty means "the PDF path with a .md extension".
   */
  notesUrl: string;
  /** Show a small "current / total" counter in the bottom-right corner. */
  showPageNumber: boolean;
  /** Show a thin progress bar along the bottom edge. */
  showProgress: boolean;
  transition: 'fade' | 'none';
}
