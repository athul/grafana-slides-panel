# Slides

Present a PDF slide deck from inside Grafana, with live dashboards on your slides.

- Full-window presenting in kiosk mode (`/d/<uid>?kiosk`), on black, with Grafana's footer hidden
- Keyboard and clicker controls: arrows, Space, Home/End, a number then Enter, B to blank, F for fullscreen
- Presenter view (S) with the next slide, speaker notes, a timer and a clock
- Clickable PDF links; links to dashboards or panels on this Grafana are shown live on the slide
- Fade transitions, a progress bar and a slide counter

## Getting started

1. Export your slides as a PDF and serve it from Grafana, for example from a folder mounted at
   `/usr/share/grafana/public/slides`. Files there can be downloaded without logging in.
2. Add a **Slides** panel and set **PDF URL** to `public/slides/deck.pdf`.
3. Open the dashboard with `?kiosk` and present.

Speaker notes go in a plain-text file next to the PDF (`deck.md`), one section per slide separated
by a line containing only `---`.

Live dashboards need `allow_embedding = true` in the `[security]` section of Grafana's config.

Full documentation: https://github.com/athul/grafana-slides-panel
