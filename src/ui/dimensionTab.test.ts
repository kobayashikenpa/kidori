import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDimensionTab, saveDimensionTab } from './dimensionTab'

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('dimensionTab', () => {
  it('初めは「木取り」。保存したタブを読み戻す（キーは kidori.dimensionTab だけ）', () => {
    const s = fakeStorage()
    vi.stubGlobal('localStorage', s)
    expect(loadDimensionTab()).toBe('cut')
    saveDimensionTab('finished')
    expect(loadDimensionTab()).toBe('finished')
    expect([...s.map.keys()]).toEqual(['kidori.dimensionTab'])
  })

  it('知らない値は「木取り」', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'kidori.dimensionTab': 'zzz' }))
    expect(loadDimensionTab()).toBe('cut')
  })

  it('localStorage が例外を投げても「木取り」で開け、保存も落ちない', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    vi.stubGlobal('localStorage', bad)
    expect(loadDimensionTab()).toBe('cut')
    expect(() => saveDimensionTab('finished')).not.toThrow()
  })
})
