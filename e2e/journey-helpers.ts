import { type Page } from '@playwright/test'

export const email = process.env.E2E_EMAIL ?? process.env.ADMIN_EMAIL ?? ''
export const password = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? ''
// An asset with collected data (the Treprostinil backfill).
export const ASSET = process.env.E2E_ASSET ?? 'treprostinil'

/** Open `path` and sign in with the seeded admin when the app sends us to the login page. */
export async function open(page: Page, path: string) {
  await page.goto(path)
  await page.waitForURL(/\/login/, { timeout: 5_000 }).catch(() => {}) // the guard redirects after the first paint
  if (new URL(page.url()).pathname === '/login') {
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
}
