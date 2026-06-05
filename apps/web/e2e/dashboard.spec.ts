import { test, expect } from '@playwright/test'

test.describe('dashboard', () => {
  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('shows dashboard when authenticated', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL || 'test@example.com')
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD || 'password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 10000 })
    await expect(page.getByText(/dashboard/i)).toBeVisible()
  })
})
