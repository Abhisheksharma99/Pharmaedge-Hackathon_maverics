import { expect, test } from '@playwright/test'
import { ASSET, email, open, password } from './journey-helpers'

test.skip(!email || !password, 'Set E2E_EMAIL / E2E_PASSWORD (or apps/api/.env ADMIN_*)')

// Phase 7: ⌘K → "TETON" → an event opens its sheet.
test('⌘K finds a TETON event and opens its sheet', async ({ page }) => {
  await open(page, `/assets/${ASSET}/overview`)
  await expect(page.getByRole('region', { name: 'Key metrics' })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search PharmaEdge' })
  await expect(palette).toBeVisible()
  await palette.getByPlaceholder(/Search assets, events/).fill('TETON')
  // Event rows only (the palette also offers assets, pages and "Ask Asset AI" actions for the same term).
  const event = palette.locator('[cmdk-item][data-value^="event:" i]', { hasText: /TETON/i }).first()
  await expect(event).toBeVisible({ timeout: 15_000 })
  await event.click()

  await expect(palette).toBeHidden()
  const sheet = page.getByRole('dialog').filter({ hasText: /TETON/i })
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})
