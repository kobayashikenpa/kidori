// 取扱説明書の画像を撮る（第2.9版 U-105）。`npm run manual:shots`
//
// - 開発サーバー（Vite）をこのスクリプトの中で立て、パソコンの Chrome を puppeteer-core で動かす
// - スマホの大きさ（幅 375px・端末の倍率 2）・ライトの配色で、見本（本棚 W900）の画面を撮る
// - 見本は、仕事の画面の「見本（本棚 W900）を追加」を押して入れる（localStorage は空から）
// - 撮るのは5つの画面（仕事・部材・寸法表・木取り・設定）を1枚ずつ。上から見える範囲（下のタブも含めて1画面分）をそのまま撮る
// - 保存先は docs/manual/images/*.png
//
// Chrome の場所は環境変数 CHROME_PATH で変えられる（無ければ macOS・Windows・Linux のよくある場所を探す）
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/manual/images')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error('Chrome が見つかりません。環境変数 CHROME_PATH に Chrome の場所を入れてください')
  process.exit(1)
}

/** 撮るときだけ足す CSS：動きを止める・入力のカーソルを消す（アプリの CSS は変えない） */
const SHOT_CSS = `
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } })
await server.listen()
const address = server.httpServer.address()
const url = `http://localhost:${address.port}/kidori/`

const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
const shots = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })

  await page.addStyleTag({ content: SHOT_CSS })

  /** 見えているボタンのうち、文字を含む最初のもの（within の中だけ） */
  const click = async (text, within = 'body') => {
    const h = await page.evaluateHandle(
      (t, w) => {
        const scope = document.querySelector(w) ?? document.body
        return [...scope.querySelectorAll('button')].find((b) => b.offsetParent !== null && b.textContent.includes(t)) ?? null
      },
      text,
      within,
    )
    const el = h.asElement()
    if (!el) throw new Error(`ボタンが見つかりません：${text}`)
    await el.evaluate((b) => b.click())
    await wait(400)
  }
  const tab = (label) => click(label, '.tabbar')
  const top = () => page.evaluate(() => window.scrollTo(0, 0))
  const save = async (name, what) => {
    await wait(200)
    const path = join(outDir, name)
    await page.screenshot({ path })
    shots.push({ name, what, kb: Math.round(statSync(path).size / 1024) })
  }

  mkdirSync(outDir, { recursive: true })

  // 1. 仕事（見本を追加したあと）
  await click('見本（本棚 W900）を追加')
  await tab('仕事')
  await top()
  await save('screen-jobs.png', '仕事')

  // 2. 部材
  await tab('部材')
  await top()
  await save('screen-parts.png', '部材')

  // 3. 寸法表の［木取り］タブ
  await tab('寸法表')
  await click('木取り', '.dim-tabs')
  await top()
  await save('screen-dims.png', '寸法表（［木取り］タブ）')

  // 4. 木取り（先頭。まとめが画面の縦をほぼ使うので、配置図までは入らない）
  await tab('木取り')
  await top()
  await save('screen-kidori.png', '木取り（切り方・まとめ）')

  // 5. 設定の［基本］タブ
  await tab('設定')
  await click('基本', '.settings-tabs')
  await top()
  await save('screen-settings.png', '設定（［基本］タブ）')
} finally {
  await browser.close()
  await server.close()
}

for (const s of shots) console.log(`${s.name}\t${s.kb}KB\t${s.what}${s.kb > 300 ? '（300KB を超えています）' : ''}`)
