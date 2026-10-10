import { expect, test } from '@playwright/test'
import { ASSET, email, open, password } from './journey-helpers'

test.skip(!email || !password, 'Set E2E_EMAIL / E2E_PASSWORD (or apps/api/.env ADMIN_*)')

// Phase 7: pin a card from "From your data", then Reset to the default set. Custom (Asset AI) builds are not started.
test('pin an analytics card from the library, then Reset', async ({ page }) => {
  await open(page, `/assets/${ASSET}/overview`)
  const pinned = page.getByRole('region', { name: 'Pinned analytics' })
  await expect(pinned.getByRole('button', { name: /^Remove / }).first()).toBeVisible({ timeout: 20_000 })
  const defaults = await pinned.getByRole('button', { name: /^Remove / }).count()

  // Free a slot: remove the first card, then pin it back from the library.
  const first = pinned.getByRole('button', { name: /^Remove / }).first()
  const title = (await first.getAttribute('aria-label'))!.replace(/^Remove /, '')
  await first.click()
  await expect(pinned.getByRole('button', { name: `Remove ${title}` })).toHaveCount(0)
  expect(await pinned.getByRole('button', { name: /^Remove / }).count()).toBe(defaults - 1)

  await pinned.getByRole('button', { name: 'Add analytics' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'From your data' }).click()
  const row = dialog.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) })
  await row.getByRole('button', { name: 'Add' }).click()
  await expect(row.getByRole('button', { name: 'Added' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(pinned.getByRole('button', { name: `Remove ${title}` })).toBeVisible()

  // Reset returns to the default set after a removal.
  await pinned.getByRole('button', { name: `Remove ${title}` }).click()
  await pinned.getByRole('button', { name: 'Reset' }).click()
  await expect(pinned.getByRole('button', { name: /^Remove / })).toHaveCount(defaults)
  await expect(pinned.getByRole('button', { name: `Remove ${title}` })).toBeVisible()
})
