// 取扱説明書「最低限の操作手順」の画像を撮る。`npm run manual:shots`
//
// - 開発サーバー（Vite）をこのスクリプトの中で立て、パソコンの Chrome を puppeteer-core で動かす
// - スマホの大きさ（幅 375px・端末の倍率 2）・ライトの配色。保存データ（localStorage）は空から始める
// - 説明書の手順（新しい仕事を作る → 部材を追加 → 木取り → 切り出しチェック）を実際に操作しながら撮る
// - 入力する・押すところに赤い枠を付ける。枠は撮るときだけ足す CSS で付ける（アプリの CSS は変えない）
// - 保存先は docs/manual/images/step-*.png
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

const VIEW_W = 375
const VIEW_H = 812

/** 撮るときだけ足す CSS：動きを止める・入力のカーソルを消す・赤い枠（.shot-mark） */
const SHOT_CSS = `
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
  .shot-mark { outline: 3px solid #e60012 !important; outline-offset: 3px !important; border-radius: 8px; }
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
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })
  await page.addStyleTag({ content: SHOT_CSS })

  /** 見えているボタンのうち、文字を含む最初のもの（within の中だけ。exact なら文字が同じもの） */
  const findButton = async (text, within = 'body', exact = false) => {
    const h = await page.evaluateHandle(
      (t, w, ex) => {
        const scopes = [...document.querySelectorAll(w)]
        const scope = scopes[scopes.length - 1] ?? document.body
        return (
          [...scope.querySelectorAll('button')].find(
            (b) => b.offsetParent !== null && (ex ? b.textContent.trim() === t : b.textContent.includes(t)),
          ) ?? null
        )
      },
      text,
      within,
      exact,
    )
    const el = h.asElement()
    if (!el) throw new Error(`ボタンが見つかりません：${text}`)
    return el
  }
  const click = async (text, within = 'body', exact = false) => {
    const el = await findButton(text, within, exact)
    await el.evaluate((b) => b.click())
    await wait(300)
  }
  const tab = (label) => click(label, '.tabbar')
  const top = () => page.evaluate(() => window.scrollTo(0, 0))

  /** 赤い枠を付ける（CSS セレクター、または [セレクター, 含む文字] で絞る） */
  const mark = (...targets) =>
    page.evaluate((ts) => {
      for (const t of ts) {
        const [sel, text] = Array.isArray(t) ? t : [t, null]
        const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && (text === null || e.textContent.includes(text)))
        if (!el) throw new Error(`枠を付ける所が見つかりません：${sel} ${text ?? ''}`)
        el.classList.add('shot-mark')
      }
    }, targets)
  const unmark = () => page.evaluate(() => document.querySelectorAll('.shot-mark').forEach((e) => e.classList.remove('shot-mark')))

  /** 撮る。clip を渡すと、そのページ上の範囲（CSS px）だけを撮る */
  const save = async (name, what, clip) => {
    await wait(200)
    const path = join(outDir, name)
    await page.screenshot(clip ? { path, clip, captureBeyondViewport: false } : { path })
    shots.push({ name, what, kb: Math.round(statSync(path).size / 1024) })
    await unmark()
  }

  /** 数字キーで数を入れて「決定」（NumberField） */
  const typeNumber = async (ariaLabel, digits) => {
    const box = await page.$(`.keypad-box[aria-label^="${ariaLabel}"]`)
    if (!box) throw new Error(`欄が見つかりません：${ariaLabel}`)
    await box.evaluate((b) => b.click())
    await wait(200)
    for (const d of digits) await click(d, '.numpad', true)
    await click('決定', '.numpad', true)
  }
  /** W・H・D の式の欄を押し、ボタンで数を入れて「完了」 */
  const typeExpr = async (axis, digits) => {
    await page.$eval(`#expr-${axis}-pad, .expr-box[aria-controls="expr-${axis}-pad"]`, (b) => b.click())
    await wait(300)
    for (const d of digits) await click(d, `#expr-${axis}-pad .pad-keys`, true)
    await click('完了', `#expr-${axis}-pad`, true)
  }

  mkdirSync(outDir, { recursive: true })

  // 1. 仕事の画面：「＋ 新しい仕事を作る」
  await tab('仕事')
  await top()
  await mark(['button', '＋ 新しい仕事を作る'])
  await save('step-1-new-job.png', '仕事の画面・「＋ 新しい仕事を作る」')

  // 2. 名前を入れて「作って開く」
  await click('＋ 新しい仕事を作る')
  await page.type('#new-job-name', '本棚 W900')
  await page.evaluate(() => document.activeElement?.blur())
  await mark('#new-job-name', ['button', '作って開く'])
  await save('step-2-job-name.png', '新しい仕事の名前・「作って開く」')
  await click('作って開く')

  // 3. 部材の画面：「＋ 部材を追加」
  // 「作って開く」で部材の画面に移る（移らなかったときのために、念のため下のタブでも開く）
  if (!(await page.evaluate(() => document.body.textContent.includes('＋ 部材を追加')))) await tab('部材')
  await top()
  await mark(['button', '＋ 部材を追加'])
  await save('step-3-add-part.png', '部材の画面・「＋ 部材を追加」')

  // 4. 部材の編集：名前・枚数・材料・W/H/D
  await click('＋ 部材を追加')
  await page.type('#part-name', '側板')
  await page.evaluate(() => document.activeElement?.blur())
  await typeNumber('枚数', '2')
  await click('ラワン', '.mat-chips[aria-label="材料名"]', true)
  await click('18', '.mat-step2', true)
  await typeExpr('W', '18')
  await typeExpr('H', '1800')
  await typeExpr('D', '400')

  /** 部材の編集のシート（.sheet-body）の中を、el の上端が枠の少し下に来るようにスクロールする（null なら先頭へ） */
  const sheetScroll = (sel) =>
    page.evaluate((s) => {
      const body = document.querySelector('.sheet-body')
      if (!body) return
      if (s === null) {
        body.scrollTop = 0
        return
      }
      const el = document.querySelector(s)?.closest('.field') ?? document.querySelector(s)
      if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 12
    }, sel)

  // 4a. 名前・枚数・材料
  await sheetScroll(null)
  await mark('#part-name', '.keypad-box[aria-label^="枚数"]', ['.mat-chips[aria-label="材料名"] .mat-chip', 'ラワン'], '.mat-step2 .mat-chip[aria-pressed="true"]')
  await save('step-4a-part-name.png', '部材の編集・名前・枚数・材料（ラワン と 18）')

  // 4b. W・H・D
  await sheetScroll('.expr-box[aria-controls="expr-W-pad"]')
  await mark(
    '.expr-box[aria-controls="expr-W-pad"]',
    '.expr-box[aria-controls="expr-H-pad"]',
    '.expr-box[aria-controls="expr-D-pad"]',
  )
  await save('step-4b-part-size.png', '部材の編集・W/H/D の欄')

  // 5. 「追加する」
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.trim() === '追加する')
    b?.scrollIntoView({ block: 'center' })
  })
  await mark(['.sheet-foot button', '追加する'])
  await save('step-5-add.png', '部材の編集・「追加する」')
  await click('追加する', '.sheet', true)

  // 6. 木取りの画面：必要な材料の枚数（まとめ）と配置図
  await tab('木取り')
  await top()
  await mark('.kd-mat')
  const diagram = await page.$('svg.diagram')
  if (diagram) {
    const inView = await diagram.evaluate((e) => e.getBoundingClientRect().bottom < window.innerHeight - 60)
    if (inView) await diagram.evaluate((e) => e.classList.add('shot-mark'))
  }
  await save('step-6-kidori.png', '木取りの画面・必要な材料の枚数（まとめの行）')

  // 7. 切り出しチェック：「□ 側板 ×2枚」
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.cl-row')].find((r) => r.textContent.includes('側板'))
    row?.closest('.cl')?.scrollIntoView({ block: 'center' })
  })
  await mark(['.cl-row', '側板'])
  await save('step-7-checklist.png', '切り出しチェック・「□ 側板 ×2枚」')
} finally {
  await browser.close()
  await server.close()
}

for (const s of shots) console.log(`${s.name}\t${s.kb}KB\t${s.what}${s.kb > 300 ? '（300KB を超えています）' : ''}`)
