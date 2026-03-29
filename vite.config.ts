/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
  },
  plugins: [
    analog({
      // static: true,
      inlineStylesExtension: 'scss',
      // prerender: {
      //   routes: async () => [
      //     '/',
      //     {
      //       route: '/some-test',
      //       staticData: true,
      //     }
      //   ],
      //   postRenderingHooks: [
      //     async (route) => console.log(route),
      //   ],
      // },
      // nitro: {
      //   routeRules: {
      //     '/some-etest': { ssr: false },
      //   },
      // },
    }),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['**/*.spec.ts'],
    reporters: ['default'],
  },
}));
