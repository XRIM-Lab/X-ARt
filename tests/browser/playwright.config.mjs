import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
const webglArgs = [
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader'
];

export default defineConfig({
  testDir: '.',
  testMatch: ['pages.spec.mjs', 'rendering.spec.mjs'],
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: 'list',
  outputDir: '../../test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10000
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: webglArgs }
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        launchOptions: { args: webglArgs }
      }
    }
  ],
  webServer: {
    command: 'node ../helpers/server.mjs --port=4173',
    url: `${baseURL}/`,
    reuseExistingServer: true,
    timeout: 30000
  }
});
