import { defineConfig } from '@playwright/test';

/**
 * AZİM — uçtan uca (e2e) testler (Ajan 7 — Test & QA).
 *
 *   npx playwright test                    # tüm e2e testleri
 *   npx playwright test tests/e2e/boot     # tek dosya
 *
 * Tarayıcı: sistemdeki Chromium + SwiftShader (CPU WebGL). Yavaştır; bu yüzden:
 *   - tek işçi (workers: 1), küçük görünüm alanı (480x270), quality=low
 *   - mantık testlerinde çizim kapalı, oyun döngüsü __game.simulate() ile sürülür
 * Sunucu: kendi portumuz 5187 (başka ajanların sunucularıyla çakışmaz).
 */
const PORT = Number(process.env.QA_PORT || 5187);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.js$/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE,
    browserName: 'chromium',
    viewport: { width: 480, height: 270 },
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
