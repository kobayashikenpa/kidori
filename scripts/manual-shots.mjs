// 取扱説明書の画像を撮る（第2.9版 U-105）。`npm run manual:shots`
//
// - 開発サーバー（Vite）をこのスクリプトの中で立て、パソコンの Chrome を puppeteer-core で動かす
// - スマホの大きさ（幅 375px・端末の倍率 2）・ライトの配色で、見本（本棚 W900）の画面を撮る
// - 見本は、仕事の画面の「見本（本棚 W900）を追加」を押して入れる（localStorage は空から）
// - 押すところに赤い枠を付ける（撮るときだけ CSS を足す。アプリの CSS は変えない）
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

/** 撮るときだけ足す CSS：赤い枠・動きを止める・入力のカーソルを消す */
const SHOT_CSS = `
  .shot-mark { outline: 3px solid #e02020 !important; outline-offset: 2px !important; border-radius: 8px; }
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
`
/** まとめ・1枚の図を切り取って撮るときは、下のタブを隠す（図に重ならないように） */
const HIDE_TABBAR_CSS = `.tabbar { display: none !important; }`

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

  const addCss = (css) => page.addStyleTag({ content: css }).then((h) => h)
  await addCss(SHOT_CSS)

  /** 見えているボタンのうち、文字を含む最初のもの（within の中だけ） */
  const findButton = (text, within = 'body') =>
    page.evaluateHandle(
      (t, w) => {
        const scope = document.querySelector(w) ?? document.body
        return [...scope.querySelectorAll('button')].find((b) => b.offsetParent !== null && b.textContent.includes(t)) ?? null
      },
      text,
      within,
    )
  const click = async (text, within) => {
    const h = await findButton(text, within)
    const el = h.asElement()
    if (!el) throw new Error(`ボタンが見つかりません：${text}`)
    await el.evaluate((b) => b.click())
    await wait(400)
  }
  /** 赤い枠を付ける（CSS セレクタ、または { button: 文字, within }） */
  const mark = async (targets) => {
    await page.evaluate(() => document.querySelectorAll('.shot-mark').forEach((e) => e.classList.remove('shot-mark')))
    for (const t of targets) {
      if (typeof t === 'string') {
        await page.evaluate((s) => document.querySelector(s)?.classList.add('shot-mark'), t)
      } else {
        const el = (await findButton(t.button, t.within)).asElement()
        if (!el) throw new Error(`枠を付けるボタンが見つかりません：${t.button}`)
        await el.evaluate((b) => b.classList.add('shot-mark'))
      }
    }
  }
  const tab = (label) => click(label, '.tabbar')
  const top = () => page.evaluate(() => window.scrollTo(0, 0))
  /** 画面の中の要素を上から少し下に来るようにスクロールする */
  const scrollTo = (selector, offset = 70) =>
    page.evaluate(
      (s, o) => {
        const el = document.querySelector(s)
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o)
      },
      selector,
      offset,
    )
  const save = async (name, what, opts = {}) => {
    await wait(200)
    const path = join(outDir, name)
    await page.screenshot({ path, ...opts })
    shots.push({ name, what, kb: Math.round(statSync(path).size / 1024) })
  }
  /** 要素の範囲（上下に少し余白）を切り取って撮る */
  const clipOf = (selector, pad = 8) =>
    page.evaluate(
      (s, p) => {
        const r = document.querySelector(s).getBoundingClientRect()
        return { x: 0, y: Math.max(0, r.top + window.scrollY - p), width: document.documentElement.clientWidth, height: r.height + p * 2 }
      },
      selector,
      pad,
    )

  mkdirSync(outDir, { recursive: true })

  // 1. 仕事の一覧（見本を追加したあと。見本の追加と、仕事の「開く」に枠）
  await click('見本（本棚 W900）を追加')
  await tab('仕事')
  await top()
  await mark([{ button: '開く', within: 'main' }, { button: '見本（本棚 W900）を追加' }])
  await save('01-jobs.png', '仕事の一覧（見本の追加・仕事を開く）')

  // 2. 部材の一覧（部材のカードと「＋ 部材を追加」に枠）
  await tab('部材')
  await top()
  await mark(['.part-card:nth-of-type(2)', { button: '＋ 部材を追加' }])
  await save('02-parts.png', '部材の一覧')

  // 3. 部材の編集（側板。材料の欄と［設定］ボタンに枠）
  await click('側板', 'main')
  await page.evaluate(() => {
    const body = document.querySelector('.sheet-body')
    const head = document.querySelector('.sheet .mat-head')
    if (body && head) body.scrollTop = head.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 80
  })
  await page.evaluate(() => {
    // 材料名（1段目）で今の材料を選んだ表示にするため、材料グループのボタンを押す（見本の側板はフラッシュ25）
    ;[...document.querySelectorAll('.sheet .mat-chip.name')].find((b) => b.textContent === '材料グループ')?.click()
  })
  await wait(300)
  await mark(['.sheet .mat-settings', '.sheet .mat-chips[aria-label="材料名"]', '.sheet .mat-step2'])
  await save('03-part-edit.png', '部材の編集（材料の欄と［設定］ボタン）')
  await click('閉じる', '.sheet-head')

  // 4. 設定の［材料］タブ（タブ・ラワンの厚みのボタン・［＋］に枠）
  await tab('設定')
  await click('材料', '.settings-tabs')
  await top()
  await mark([
    { button: '材料', within: '.settings-tabs' },
    '.mat-row[aria-label="ラワン"] .mat-chip:not(.add)',
    '.mat-row[aria-label="ラワン"] .mat-chip.add',
  ])
  await save('04-settings-materials.png', '設定の［材料］タブ（厚みのボタンと［＋］）')

  // 5. 設定の［材料］タブの一番下（「＋ 材料名を追加」「選んで削除」に枠）
  await mark(['.list-foot'])
  await scrollTo('.list-foot', 560)
  await save('05-settings-materials-foot.png', '設定の［材料］タブの一番下（＋ 材料名を追加・選んで削除）')

  // 6. 寸法表の［木取り］（タブに枠）
  await tab('寸法表')
  await click('木取り', '.dim-tabs')
  await top()
  await mark([{ button: '木取り', within: '.dim-tabs' }])
  await save('06-dims-cut.png', '寸法表の［木取り］')

  // 7・8 は下のタブを隠して、まとめ・1枚の図を切り取る
  await tab('木取り')
  await top()
  const hide = await addCss(HIDE_TABBAR_CSS)

  // 7. 木取りのまとめ（サイズのボタンに枠）
  await mark(['.kd-summary .sz-opts'])
  await save('07-kidori-summary.png', '木取りのまとめ（材料のサイズのボタン）', { clip: await clipOf('.kd-summary') })

  // 8. 1枚の配置図と切り出しチェック（重ねた板1。チェックの行に枠）
  await mark(['.kd-sheet .cl-list'])
  await save('08-kidori-sheet.png', '1枚の配置図と切り出しチェック', { clip: await clipOf('.kd-sheet') })
  await hide.evaluate((el) => el.remove())
} finally {
  await browser.close()
  await server.close()
}

for (const s of shots) console.log(`${s.name}\t${s.kb}KB\t${s.what}${s.kb > 300 ? '（300KB を超えています）' : ''}`)
