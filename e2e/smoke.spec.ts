import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? process.env.ADMIN_EMAIL ?? ''
const password = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? ''

test('sign in, use the shell, manage users, sign out', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_EMAIL / E2E_PASSWORD (or apps/api/.env ADMIN_*)')

  await page.goto('/settings/users')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings%2Fusers/)

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/settings\/users$/)
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(page.getByRole('cell', { name: email })).toBeVisible()

  await page.getByRole('link', { name: /Crawl jobs/ }).click()
  await expect(page.getByText('Recent jobs')).toBeVisible()

  // Session survives a reload (cookie-based, not in-memory).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Crawl jobs' })).toBeVisible()

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: /Sign out/ }).click()
  await expect(page).toHaveURL(/\/login/)
})
