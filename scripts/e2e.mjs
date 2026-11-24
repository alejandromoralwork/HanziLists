// End-to-end smoke test against a running server.
// Usage: npm run preview (in another shell), then: npm run e2e [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4610/hanzi/'
const SHOTS = process.env.SHOTS ?? 'scripts/.cache/shots'
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const ok = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('ok -', msg)
}
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true })

await page.goto(BASE)
await page.getByText('Due today').waitFor({ timeout: 60000 })
ok(true, 'dashboard renders after dataset load')
await shot('1-dashboard')

// list view sorted by frequency
await page.goto(BASE + '#/list/verb')
await page.locator('tbody tr').first().waitFor()
const firstRow = await page.locator('tbody tr').first().innerText()
ok(firstRow.includes('是') && firstRow.startsWith('1'), 'verb list starts with #1 是')
await shot('2-list')

// study EN→ZH: direction picker exists for verbs
await page.goto(BASE + '#/study/verb')
ok(await page.getByText('English → Chinese').isVisible(), 'direction picker shown for verbs')
await page.getByText('English → Chinese').click()
await page.getByRole('button', { name: /Start session/ }).click()
await page.getByText('to be; yes').waitFor()
ok(await page.getByText('#1', { exact: true }).isVisible(), 'rank badge #1 on first card')
await shot('3-study-front')
await page.keyboard.press('Space')
await page.getByText('我是学生。').waitFor()
await shot('4-study-back')
await page.keyboard.press('1') // again → should come back
await page.keyboard.press('Space')
await page.keyboard.press('3')
await page.keyboard.press('Space')
await page.keyboard.press('3')
await page.keyboard.press('Space')
await page.keyboard.press('3')
ok(await page.getByText('to be; yes').isVisible(), '"again" card comes back after 3 cards')

// edit during session
await page.getByRole('button', { name: /Edit/ }).click()
const eng = page.locator('dialog input').nth(3)
await eng.fill('to be; am / is / are')
await page.getByRole('button', { name: 'Save' }).click()
await page.getByText('to be; am / is / are').waitFor()
ok(true, 'card edited mid-session')

// characters: no direction picker
await page.goto(BASE + '#/study/character')
await page.getByText('Recognition only').waitFor()
ok(!(await page.getByText('English → Chinese').isVisible()), 'characters have no direction picker')
await page.getByRole('button', { name: /Start session/ }).click()
await page.locator('.han', { hasText: '的' }).first().waitFor()
await shot('5-character')
await page.keyboard.press('Space')
await page.keyboard.press('3')

// dashboard reflects progress
await page.goto(BASE + '#/')
await page.getByText('Due today').waitFor()
const accText = await page.locator('text=English → Chinese').locator('..').locator('..').innerText()
ok(/\d+%/.test(accText), 'EN→ZH accuracy shown: ' + accText.replace(/\s+/g, ' '))
await shot('6-dashboard-after')

// mobile layout
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(BASE + '#/study/verb/zh-en')
await page.waitForTimeout(500)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
ok(!overflow, 'no horizontal scroll at phone width')
await shot('7-mobile')

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''))
await browser.close()
