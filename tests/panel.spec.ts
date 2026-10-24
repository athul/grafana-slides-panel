import { test, expect } from '@grafana/plugin-e2e';

test('should show an error when the PDF cannot be loaded', async ({ panelEditPage, page }) => {
  await panelEditPage.setVisualization('Slides');
  const options = panelEditPage.getCustomOptions('Slides');
  await options.getTextInput('PDF URL').fill('public/slides/does-not-exist.pdf');
  await options.getTextInput('PDF URL').blur();
  await expect(page.getByText(/Could not load/)).toBeVisible();
});
