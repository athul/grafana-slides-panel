# Grafana Slides Panel

Present a PDF slide deck from inside Grafana. Export your deck from Keynote, PowerPoint or Google
Slides as a PDF, put it on a dashboard, and give the talk from Grafana, with live dashboards on
your slides.

It started as the slides for a talk about Grafana, given in Grafana.

## Features

- **Full-window presenting**: in kiosk mode the slide fills the browser window on black, with
  Grafana's footer and controls bar hidden.
- **Keyboard and clicker friendly**: arrows, Page Up/Down, Space, Home/End, a slide number and then
  Enter to jump, B or `.` to blank the screen, F for fullscreen.
- **Presenter view** (S): current and next slide, speaker notes, a timer and a clock, kept in sync
  with the audience window.
- **Clickable PDF links**: links to other slides, web links and dashboard links all work.
- **Live dashboards on slides**: a link to a dashboard or panel on the same Grafana is shown live
  in place, in kiosk mode, filling the link's box.
- **Fade transitions, a progress bar and a slide counter**, each of which can be turned off.
- **Remembers your place**: the current slide is kept in the URL (`?slide=7`), so a refresh mid-talk
  doesn't lose it.

## Requirements

- Grafana 13.0.0 or later.
- The plugin isn't signed, so Grafana has to be allowed to load it (see below).

## Install

Build the plugin from source with [Bun](https://bun.sh):

```bash
bun install
bun run build
```

Copy the `dist` folder into Grafana's plugins directory as `athul-slides-panel` and allow it to load
unsigned:

```ini
# grafana.ini
[plugins]
allow_loading_unsigned_plugins = athul-slides-panel
```

or with Docker:

```yaml
services:
  grafana:
    image: grafana/grafana-oss
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: athul-slides-panel
    volumes:
      - ./dist:/var/lib/grafana/plugins/athul-slides-panel:ro
      - ./decks:/usr/share/grafana/public/slides:ro
```

Restart Grafana after installing or updating the plugin.

## Make a deck

1. Export your slides as a PDF. Links survive the export from Keynote, PowerPoint and Google Slides.
2. Put the PDF somewhere Grafana can fetch it. The simplest place is a folder mounted into Grafana's
   `public` directory, as in the Docker example above, which makes it available at
   `public/slides/deck.pdf`.
3. Add a **Slides** panel to a dashboard and set **PDF URL** to `public/slides/deck.pdf`.

> **Files in Grafana's `public` directory can be downloaded by anyone who can reach your Grafana,
> without logging in.** For a deck you don't want public, use a hard-to-guess file name.

The PDF URL can also be an absolute URL on another server, as long as that server allows
cross-origin (CORS) requests from your Grafana.

Large PDFs are slow to open, because the whole file loads before the first slide shows. Exporting
with a lower image quality helps. Opening the deck once before your talk caches it.

### Panel options

| Option | Default | Description |
| --- | --- | --- |
| PDF URL | `public/slides/deck.pdf` | Relative to Grafana, or an absolute URL that allows CORS |
| Speaker notes URL | the PDF path with `.md` | Plain-text notes, see [Speaker notes](#speaker-notes) |
| Transition | Fade | Fade or None; fades are skipped when the OS asks for reduced motion |
| Show progress bar | on | A thin bar along the bottom |
| Show slide number | on | `3 / 19` in the corner |

## Present

Open the dashboard in kiosk mode:

```
https://your-grafana/d/<dashboard-uid>?kiosk
```

Press F to go fullscreen. Esc leaves kiosk mode.

| Key | Action |
| --- | --- |
| → ↓ Page Down Space N, or click | Next slide |
| ← ↑ Page Up P | Previous slide |
| Home / End | First / last slide |
| a number, then Enter | Jump to that slide |
| B or `.` | Blank the screen (most clickers send `.`) |
| F | Toggle fullscreen |
| S | Open the presenter view |

### Speaker notes

Write the notes as a plain-text file, one section per slide in order, separated by a line
containing only `---`:

```
Welcome everyone.
---
Notes for slide 2.
---
---
Slide 4. The empty section above means slide 3 has no notes.
```

Save it next to the PDF with the same name and a `.md` extension (`deck.pdf` → `deck.md`), or set
**Speaker notes URL**. Notes are only loaded in the presenter view, but the file is served like the
PDF, so the same public-access warning applies.

Press S to open the presenter view in a new window. The two windows stay in sync, whichever one you
change slides in. Sync only works between windows of the same browser.

## Live dashboards on slides

Link a shape or image on a slide to a dashboard or panel on the same Grafana, and that link's box
shows it live:

| Link | Shows |
| --- | --- |
| `https://your-grafana/d-solo/<uid>/<slug>?panelId=4` | One panel, live |
| `https://your-grafana/d/<uid>/<slug>` | The whole dashboard, live, in kiosk mode |
| A link to the dashboard the deck is on | The deck itself inside Grafana's full UI ("it was Grafana all along") |
| Anything else | A normal link, opened on click |

Variables and time ranges in the link (`var-host=web-1`, `from=now-6h`) are kept. Arrow keys
still drive the deck after you click into a live dashboard.

Live dashboards are embedded in iframes, so Grafana must allow embedding:

```ini
[security]
allow_embedding = true
```

If a reverse proxy sits in front of Grafana, make sure it doesn't send `X-Frame-Options: DENY`. You
can limit framing to Grafana itself with `Content-Security-Policy: frame-ancestors 'self'`.

### Security notes

- Only `http:` and `https:` links in a PDF become clickable; `javascript:` and other schemes are
  ignored.
- Only links to the same Grafana (same origin and sub-path) are embedded. Links to other sites stay
  plain links.
- Embedded dashboards run with the viewer's Grafana session, exactly as if they had opened the link.

## Development

```bash
bun install
bun run dev        # build in watch mode
bun run server     # Grafana with the plugin at http://localhost:3000
bun run typecheck
bun run lint
bun run test:ci    # unit tests
bun run e2e        # Playwright tests against the running server
```

The plugin was scaffolded with [`@grafana/create-plugin`](https://grafana.com/developers/plugin-tools/).
Don't edit files in `.config`; they're managed by that tool. Bump the version in `package.json`
when you change the plugin, or browsers keep loading the old cached `module.js`.

PDF rendering uses [pdf.js](https://mozilla.github.io/pdf.js/). Its worker ships inside the plugin,
so no CDN is involved.

## License

[Apache-2.0](LICENSE)
