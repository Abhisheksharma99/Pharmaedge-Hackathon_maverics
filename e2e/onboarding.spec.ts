import { expect, test } from '@playwright/test'
import { ASSET, email, open, password } from './journey-helpers'

test.skip(!email || !password, 'Set E2E_EMAIL / E2E_PASSWORD (or apps/api/.env ADMIN_*)')

// Phase 7: ?build=1 shows the live build of an existing asset (no crawl is started); "Explore the journey" returns to
// the journey and drops the param. The add-asset → crawl leg is covered up to job start by asset-ai.spec.ts.
test('?build=1 shows the live build and Explore the journey returns to the journey', async ({ page }) => {
  await open(page, `/assets/${ASSET}/overview?build=1`)

  await expect(page.getByRole('region', { name: 'Live build' }).or(page.getByText('Live build', { exact: true }).first())).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Asset journey' })).toHaveCount(0)

  await page.getByRole('button', { name: /Explore the journey/ }).first().click()
  await expect(page).not.toHaveURL(/build=1/)
  await expect(page.getByRole('region', { name: 'Key metrics' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Asset journey' })).toBeVisible()
})
