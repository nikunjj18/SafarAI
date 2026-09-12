import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react({ jsxImportSource: '@safarai/i18n' })],
  resolve: { alias: { '@safarai/i18n': fileURLToPath(new URL('./src/i18n', import.meta.url)) } },
  build: { outDir: fileURLToPath(new URL('../dist/frontend', import.meta.url)), emptyOutDir: true },
});
