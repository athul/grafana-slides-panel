/**
 * Grafana has no setting to hide the kiosk "Powered by Grafana" footer (the slides shouldn't reveal
 * what they run on) or the controls bar, which is empty on a slides dashboard and leaves a grey strip
 * above the slide. Used for the slides page itself and for dashboards embedded live on a slide.
 * These selectors are Grafana internal, so if an upgrade renames them the elements simply reappear;
 * nothing else breaks.
 */
export const HIDE_CHROME_CSS = `
  [data-testid="public-dashboard-footer"],
  div:has(> [data-testid="data-testid dashboard controls"]) { display: none !important; }
`;
