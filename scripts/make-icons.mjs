// アプリのアイコン（SVG と PNG）を作る。Node の標準機能（zlib）だけを使い、依存パッケージは増やさない
// 使い方：node scripts/make-icons.mjs （public/ に書き出す）
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// 512 マスの座標で形を決める。青い地に、板（縦長）と切り線
const BG = [0x1d, 0x5c, 0x86]
const WOOD = [0xe8, 0xc8, 0x9a]
const BOARD = { x0: 112, y0: 64, x1: 400, y1: 448 }
const LINE = 14 // 切り線の太さ
const CUT_Y = 256 // 横に1本
const CUT_X = 256 // 下半分を縦に1本

function colorAt(x, y) {
  const inBoard = x >= BOARD.x0 && x < BOARD.x1 && y >= BOARD.y0 && y < BOARD.y1
  if (!inBoard) return BG
  if (Math.abs(y - CUT_Y) < LINE / 2) return BG
  if (y > CUT_Y && Math.abs(x - CUT_X) < LINE / 2) return BG
  return WOOD
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let o = 0
  for (let py = 0; py < size; py++) {
    raw[o++] = 0 // フィルタなし
    for (let px = 0; px < size; px++) {
      const [r, g, b] = colorAt(((px + 0.5) * 512) / size, ((py + 0.5) * 512) / size)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8bit
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
const h = LINE / 2
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${hex(BG)}"/>
  <rect x="${BOARD.x0}" y="${BOARD.y0}" width="${BOARD.x1 - BOARD.x0}" height="${BOARD.y1 - BOARD.y0}" fill="${hex(WOOD)}"/>
  <rect x="${BOARD.x0}" y="${CUT_Y - h}" width="${BOARD.x1 - BOARD.x0}" height="${LINE}" fill="${hex(BG)}"/>
  <rect x="${CUT_X - h}" y="${CUT_Y}" width="${LINE}" height="${BOARD.y1 - CUT_Y}" fill="${hex(BG)}"/>
</svg>
`

const out = new URL('../public/', import.meta.url)
writeFileSync(new URL('icon.svg', out), svg)
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(new URL(name, out), png(size))
}
console.log('public/ にアイコンを書き出しました')
