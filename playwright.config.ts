import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// Sign in with the seeded admin from apps/api/.env unless E2E_EMAIL/E2E_PASSWORD are set.
if (existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env')

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    // Full stack: docker compose up -d --build
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
