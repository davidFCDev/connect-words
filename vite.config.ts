import { remixPlugin } from '@insidethesim/remix-dev/vite'
import { defineConfig } from 'vite'
import remixConfig from './remix.config'

export default defineConfig({
  plugins: [remixPlugin(remixConfig)],
})
