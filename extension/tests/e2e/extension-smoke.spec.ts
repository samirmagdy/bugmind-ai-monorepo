import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const extensionPath = path.resolve(process.cwd(), 'dist');

test('production manifest enforces Jira host allowlist', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf-8'));

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.host_permissions).toEqual(['https://*.atlassian.net/*']);
  expect(manifest.optional_host_permissions).toEqual([
    '*://*/browse/*',
    '*://*/issues/*',
    '*://*/rest/api/*',
    '*://*/rest/raven/*',
  ]);
  expect(manifest.background.service_worker).toBe('assets/background.js');
});

test('unpacked extension starts without crashing', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugmind-extension-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    expect(serviceWorker.url()).toContain('assets/background.js');

    const page = await context.newPage();
    await page.goto(`file://${path.join(extensionPath, 'sidepanel.html')}`);
    await expect(page.locator('body')).toBeVisible();
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
