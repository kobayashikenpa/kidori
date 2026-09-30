import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettingsTab, saveSettingsTab } from './settingsTab'

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('settingsTab', () => {
  it('保存したタブを読み戻す（キーは kidori.settingsTab だけ）', () => {
    const s = fakeStorage()
    vi.stubGlobal('localStorage', s)
    expect(loadSettingsTab()).toBe('basic')
    saveSettingsTab('materials')
    expect(loadSettingsTab()).toBe('materials')
    expect([...s.map.keys()]).toEqual(['kidori.settingsTab'])
  })

  it('知らない値は「基本」', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'kidori.settingsTab': 'zzz' }))
    expect(loadSettingsTab()).toBe('basic')
  })

  it('localStorage が例外を投げても「基本」で開け、保存も落ちない', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    vi.stubGlobal('localStorage', bad)
    expect(loadSettingsTab()).toBe('basic')
    expect(() => saveSettingsTab('groups')).not.toThrow()
  })
})
