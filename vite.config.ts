/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages（https://kobayashikenpa.github.io/kidori/）で公開するため base を設定
export default defineConfig({
  base: '/kidori/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
