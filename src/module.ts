import { PanelPlugin } from '@grafana/data';
import { SlidesOptions } from './types';
import { SlidesPanel } from './components/SlidesPanel';

export const plugin = new PanelPlugin<SlidesOptions>(SlidesPanel).setNoPadding().setPanelOptions((builder) => {
  return builder
    .addTextInput({
      path: 'pdfUrl',
      name: 'PDF URL',
      description: 'Relative to Grafana (e.g. public/slides/deck.pdf) or an absolute URL that allows CORS.',
      defaultValue: 'public/slides/deck.pdf',
    })
    .addTextInput({
      path: 'notesUrl',
      name: 'Speaker notes URL',
      description: 'Plain text, one section per slide separated by ---. Empty uses the PDF path with .md.',
      defaultValue: '',
    })
    .addRadio({
      path: 'transition',
      name: 'Transition',
      defaultValue: 'fade',
      settings: {
        options: [
          { value: 'fade', label: 'Fade' },
          { value: 'none', label: 'None' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'showProgress',
      name: 'Show progress bar',
      defaultValue: true,
    })
    .addBooleanSwitch({
      path: 'showPageNumber',
      name: 'Show slide number',
      defaultValue: true,
    });
});
