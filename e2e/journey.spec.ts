import { expect, test } from '@playwright/test'
import { ASSET, email, open, password } from './journey-helpers'

test.skip(!email || !password, 'Set E2E_EMAIL / E2E_PASSWORD (or apps/api/.env ADMIN_*)')

// Phase 7: the Overview reads KPI strip → pinned analytics → journey; the horizontal track adds a note at the hovered
// date; ?focus=<eventId> opens that event's sheet. Nothing is saved: the composer is closed unsent.
test('Overview order, horizontal hover-to-add and the focus deep link', async ({ page }) => {
  await open(page, `/assets/${ASSET}/overview`)

  const kpis = page.getByRole('region', { name: 'Key metrics' })
  const analytics = page.getByRole('region', { name: 'Pinned analytics' })
  const journey = page.getByRole('region', { name: 'Asset journey' })
  await expect(kpis).toBeVisible()
  await expect(journey).toBeVisible()
  const y = async (l: typeof kpis) => (await l.boundingBox())!.y
  expect(await y(kpis)).toBeLessThan(await y(analytics))
  expect(await y(analytics)).toBeLessThan(await y(journey))

  // Horizontal is the default view. Hovering the lane shows the date pill; clicking opens the composer with that date.
  const track = page.getByTestId('journey-horizontal')
  await expect(track).toBeVisible()
  await track.scrollIntoViewIfNeeded()
  const band = track.locator('svg rect.cursor-copy')
  await expect(band).toBeAttached()
  const box = (await band.boundingBox())!
  const view = page.viewportSize()!
  const x = view.width * 0.6
  const yy = Math.min(Math.max(box.y + box.height / 2, 80), view.height - 80)
  await page.mouse.move(x - 40, yy)
  await page.mouse.move(x, yy)
  const pill = track.locator('[data-hover-pill]')
  await expect(pill).toBeVisible()
  await expect(pill).toContainText('Click to add a note')
  const pillText = (await pill.textContent())!
  await page.mouse.click(x, yy)

  const composer = page.getByRole('dialog', { name: 'Add to the journey' })
  await expect(composer).toBeVisible()
  const date = await composer.getByLabel('Date').inputValue()
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  // The pill's "May 21, 2002" is the composer's date.
  const shown = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  expect(pillText).toContain(shown)
  await composer.getByRole('button', { name: 'Close' }).click()
  await expect(composer).toBeHidden()

  // Deep link: ?focus=<eventId> scrolls to the event and opens its sheet, then drops the param.
  const timeline = await page.request.get(`/api/assets/${ASSET}/timeline?scope=all&limit=20`)
  expect(timeline.ok()).toBeTruthy()
  const target = ((await timeline.json()) as { events: { id: string; title: string; date: string | null }[] }).events.find((e) => e.date)!
  await page.goto(`/assets/${ASSET}/overview?focus=${encodeURIComponent(target.id)}`)
  const sheet = page.getByRole('dialog', { name: target.title })
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  await expect(page).not.toHaveURL(/focus=/)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})
