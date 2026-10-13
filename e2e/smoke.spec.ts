import { expect, test } from '@playwright/test';

// End-to-end smoke test of the core loop on the deliberately bad preset:
// load → linter warnings → simulate → named bottleneck → advice → apply → measurable improvement.
test('bad design: lint, simulate, advise, apply fix', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Stress Test').first()).toBeVisible();

  await page.getByTestId('preset-select').selectOption('bad-design');
  await expect(page.getByTestId('node-db')).toBeVisible();

  // Linter: warnings on the canvas and in the Issues tab.
  await expect(page.getByTestId('node-issue-db')).toBeVisible();
  const issues = Number(await page.getByTestId('issues-count').innerText());
  expect(issues).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: /^issues/ }).click();
  await expect(page.getByTestId('finding-db-single-point-of-failure')).toBeVisible();
  await expect(page.getByTestId('finding-queue-no-consumers')).toBeVisible();

  // Simulation names the bottleneck.
  await page.getByTestId('run-sim').click();
  await expect(page.getByTestId('stat-bottleneck')).toHaveText('The One Database');
  await expect(page.getByTestId('stat-saturation')).toContainText('req/s');

  // Advice loop: analyze, apply the top suggestion, re-simulated result improves.
  await page.getByRole('button', { name: 'advice' }).click();
  await page.getByTestId('get-advice').click();
  await expect(page.getByTestId('recommendation').first()).toBeVisible();
  await page.getByTestId('apply-recommendation').first().click();
  const log = page.getByTestId('applied-log');
  await expect(log).toContainText('re-simulated');
  const text = await log.innerText();
  const factor = Number(/\((\d+(?:\.\d+)?)×/.exec(text)?.[1]);
  expect(factor).toBeGreaterThan(1.5);
});

test('estimator shows formulas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'estimator' }).click();
  await expect(page.getByTestId('est-avgQps')).toBeVisible();
  await expect(page.getByText('DAU × requests/user/day ÷ 86,400')).toBeVisible();
});
