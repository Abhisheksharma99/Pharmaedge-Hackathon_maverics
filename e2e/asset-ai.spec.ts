import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? process.env.ADMIN_EMAIL ?? ''
const password = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? ''
// An asset with collected data (the Treprostinil backfill) and a drug that isn't tracked yet.
const ASSET = process.env.E2E_ASSET ?? 'treprostinil'
const NEW_DRUG = process.env.E2E_NEW_DRUG ?? 'riociguat'

// Spec §9: login → asset page tabs → ask Asset AI a question with citations → add-asset flow up to job start.
// Uses the live model (OPENAI_API_KEY) and crawl service; the crawl itself is not started.
test('asset tabs, a cited Asset AI answer and the add-asset identity card', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_EMAIL / E2E_PASSWORD (or apps/api/.env ADMIN_*)')
  test.setTimeout(240_000)

  await page.goto(`/assets/${ASSET}/competitors`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Competitors', level: 2 })).toBeVisible()
  await page.getByRole('link', { name: 'Evidence', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Evidence sources' })).toBeVisible()

  // Asset AI in the asset panel: the answer cites records that open in the record sheet.
  const ask = page.getByRole('button', { name: /Ask Asset AI|Close Asset AI/ })
  if ((await ask.getAttribute('aria-pressed')) !== 'true') await ask.click()
  const composer = page.getByRole('textbox').last()
  const citationsBefore = await page.getByRole('button', { name: /^Source \d+:/ }).count()
  await composer.fill('Which phase 3 trials are active?')
  await composer.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop answering' })).toBeHidden({ timeout: 120_000 })
  await expect.poll(() => page.getByRole('button', { name: /^Source \d+:/ }).count(), { timeout: 30_000 }).toBeGreaterThan(citationsBefore)
  await page.getByRole('button', { name: /^Source \d+:/ }).nth(citationsBefore).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  // Add-asset: the model resolves the drug and shows the identity card; confirming is the user's click.
  await page.goto('/chat?intent=add')
  await expect(page.getByRole('textbox').last()).toHaveValue(/^Add/)
  await page.getByRole('textbox').last().fill(`Add ${NEW_DRUG}`)
  await page.getByRole('textbox').last().press('Enter')
  await expect(page).toHaveURL(/\/chat\/[\w-]+$/)
  await expect(page.getByRole('button', { name: /Confirm & start crawl|Track fully|Open asset/ })).toBeVisible({ timeout: 150_000 })
})
