import { chromium } from 'playwright'
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
})
for (const p of process.argv.slice(2)) {
  const page = await b.newPage({ viewport: { width: 1400, height: 2000 } })
  await page.goto(`http://localhost:5173/__tmp-view.html?p=${p}`)
  await page.waitForFunction(() => document.title === 'ready', { timeout: 90000 })
  await (await page.$('#c')).screenshot({ path: `screenshots/pg${p}.png` })
  await page.close()
}
await b.close()
console.log('ok')
