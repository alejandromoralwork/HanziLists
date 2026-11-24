// Two-device sync test: two isolated browser contexts share one account.
// Needs the preview server and the API running (see README).
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4610/hanzi/'
const user = `e2e_${Date.now().toString(36)}`
const pass = 'e2e-password-123'

const ok = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('ok -', msg)
}

const browser = await chromium.launch()
const errors = []
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(BASE)
  await page.getByText('Due today').waitFor({ timeout: 60000 })
  return page
}
const tile = async (page, label) => (await page.locator(`text=${label}`).locator('..').innerText()).replace(/\s+/g, ' ')

// ---- device A: study anonymously, then create the account (local progress must be merged)
const A = await device('A')
await A.goto(BASE + '#/study/verb/zh-en')
for (let i = 0; i < 3; i++) {
  await A.getByRole('button', { name: /Show answer/ }).click()
  await A.getByRole('button', { name: /I know it/ }).click()
}
await A.goto(BASE + '#/account')
await A.getByText('Create an account').click()
await A.getByLabel('Username').fill(user)
await A.getByLabel(/Password/).fill(pass)
await A.getByRole('button', { name: 'Create account' }).click()
await A.getByText('Due today').waitFor()
ok(await A.getByTitle('Synced').isVisible(), 'A registered and synced')

// edit a card on A
await A.goto(BASE + '#/list/noun')
await A.locator('tbody tr').first().getByTitle('Edit').click()
await A.locator('dialog input').nth(3).fill('person; people (edited on A)')
await A.getByRole('button', { name: 'Save' }).click()
await A.getByText('(edited on A)').waitFor()
await A.goto(BASE + '#/account')
await A.getByRole('button', { name: 'Sync now' }).click()
await A.waitForFunction(() => document.body.innerText.includes('Changes waiting to upload') && /upload\s*0/.test(document.body.innerText))
ok(true, 'A pushed its card edit')

// ---- device B: sign in and see A's progress and edit
const B = await device('B')
await B.goto(BASE + '#/account')
await B.getByLabel('Username').fill(user)
await B.getByLabel(/Password/).fill(pass)
await B.getByRole('button', { name: 'Sign in' }).click()
await B.getByText('Due today').waitFor()
await B.waitForFunction(() => /In progress\s*3/.test(document.body.innerText), null, { timeout: 15000 })
ok(true, 'B sees the 3 cards studied on A: ' + (await tile(B, 'In progress')))
await B.goto(BASE + '#/list/noun')
await B.getByText('(edited on A)').waitFor({ timeout: 10000 })
ok(true, "B sees A's card edit")

// ---- B studies one more; A picks it up
await B.goto(BASE + '#/study/adjective/en-zh')
await B.getByRole('button', { name: /Show answer/ }).click()
await B.getByRole('button', { name: /Hard/ }).click()
await B.goto(BASE + '#/account')
await B.getByRole('button', { name: 'Sync now' }).click()
await B.waitForFunction(() => /upload\s*0/.test(document.body.innerText))
await A.goto(BASE + '#/')
await A.evaluate(() => window.dispatchEvent(new Event('focus')))
await A.waitForFunction(() => /In progress\s*4/.test(document.body.innerText), null, { timeout: 15000 })
ok(true, "A sees B's review")

// ---- reset on B clears progress on A too
await B.goto(BASE + '#/settings')
await B.getByRole('button', { name: 'Reset progress' }).click()
await B.getByRole('button', { name: 'Yes, reset progress' }).click()
await B.getByText('Progress reset.').waitFor()
await A.evaluate(() => window.dispatchEvent(new Event('focus')))
await A.waitForFunction(() => /In progress\s*0/.test(document.body.innerText), null, { timeout: 15000 })
ok(true, 'reset on B propagated to A')
await A.goto(BASE + '#/list/noun')
await A.getByText('(edited on A)').waitFor({ timeout: 10000 })
ok(true, 'card edits survive a progress reset')

// ---- sign out clears the device; signing back in restores
await A.goto(BASE + '#/account')
await A.getByRole('button', { name: 'Sign out' }).click()
await A.getByText('Due today').waitFor()
await A.goto(BASE + '#/list/noun')
await A.locator('tbody tr').first().waitFor()
ok(!(await A.getByText('(edited on A)').isVisible()), 'sign out cleared this device')
ok(await A.getByRole('link', { name: 'Sign in' }).isVisible(), 'header shows Sign in')

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''))
await browser.close()
