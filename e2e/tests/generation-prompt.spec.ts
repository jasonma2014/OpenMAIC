import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures/base';
import { GenerationPreviewPage } from '../pages/generation-preview.page';
import { createSettingsStorage } from '../fixtures/test-data/settings';

const SETTINGS_STORAGE = createSettingsStorage();
const REQUIREMENT = '讲解光合作用时保留这句提示词';
const PROMPT_BUTTON = '当时的提示';

function generationSession(requirement: string) {
  return JSON.stringify({
    sessionId: 'e2e-generation-prompt',
    requirements: {
      requirement,
      language: 'zh-CN',
    },
    pdfText: '',
    pdfImages: [],
    imageStorageIds: [],
    sceneOutlines: null,
    currentStep: 'generating',
  });
}

async function readStoredPrompt(page: Page, stageId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('maic-documents');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stage = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = db.transaction('stages', 'readonly').objectStore('stages').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const prompts = stage?.generationPrompts;
      if (!Array.isArray(prompts) || prompts.length === 0) return null;
      const text = (prompts[0] as { text?: unknown }).text;
      return typeof text === 'string' ? text : null;
    } finally {
      db.close();
    }
  }, stageId);
}

test.describe('generation prompt kept with the course', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('saves the requirement during generation and shows it after reload', async ({
    page,
    mockApi,
  }) => {
    test.setTimeout(60_000);
    await page.addInitScript(
      ({ settings, session }) => {
        localStorage.setItem('locale', 'zh-CN');
        localStorage.setItem('maic:account:settings-storage', settings);
        sessionStorage.setItem('generationSession', session);
      },
      { settings: SETTINGS_STORAGE, session: generationSession(`  ${REQUIREMENT}  `) },
    );
    await mockApi.setupGenerationMocks();

    const preview = new GenerationPreviewPage(page);
    await preview.goto();
    await preview.waitForRedirectToClassroom();

    const stageId = new URL(page.url()).pathname.split('/').pop() ?? '';
    await expect.poll(() => readStoredPrompt(page, stageId)).toBe(REQUIREMENT);

    const promptButton = page.getByRole('button', { name: PROMPT_BUTTON });
    await expect(promptButton).toBeVisible();
    await promptButton.click();

    const dialog = page.getByRole('dialog', { name: '生成这节课时的提示词' });
    await expect(dialog.getByText(REQUIREMENT)).toBeVisible();
    await dialog.getByRole('button', { name: '复制' }).click();
    await expect(dialog.getByRole('button', { name: '已复制' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(REQUIREMENT);

    await page.reload();
    await expect(promptButton).toBeVisible();
    await promptButton.click();
    await expect(page.getByRole('dialog').getByText(REQUIREMENT)).toBeVisible();
  });

  test('leaves older courses without a prompt button', async ({ page }) => {
    const stageId = 'e2e-course-without-prompt';
    await page.addInitScript((settings) => {
      localStorage.setItem('locale', 'zh-CN');
      localStorage.setItem('maic:account:settings-storage', settings);
    }, SETTINGS_STORAGE);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate((id) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('maic-documents', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('stages')) {
            db.createObjectStore('stages', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('scenes')) {
            const scenes = db.createObjectStore('scenes', { keyPath: ['stageId', 'id'] });
            scenes.createIndex('by-stage', 'stageId');
          }
          if (!db.objectStoreNames.contains('outlines')) {
            db.createObjectStore('outlines', { keyPath: 'stageId' });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['stages', 'scenes', 'outlines'], 'readwrite');
          const now = Date.now();
          tx.objectStore('stages').put({
            id,
            name: '没有提示词的旧课',
            description: '',
            style: 'professional',
            createdAt: now,
            updatedAt: now,
            dslVersion: '0.3.0',
          });
          tx.objectStore('scenes').put({
            id: 'scene-quiz',
            stageId: id,
            type: 'quiz',
            title: '旧课练习',
            order: 0,
            content: {
              type: 'quiz',
              questions: [
                {
                  id: 'q1',
                  type: 'single',
                  question: '这节课没有保存提示词',
                  options: [
                    { label: '是', value: 'A' },
                    { label: '否', value: 'B' },
                  ],
                  answer: ['A'],
                },
              ],
            },
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore('outlines').put({
            stageId: id,
            outline: { outlines: [], createdAt: now, updatedAt: now },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    }, stageId);

    await page.goto(`/classroom/${stageId}`);
    await expect(page.getByRole('button', { name: '设置' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '旧课练习' })).toBeVisible();
    await expect(page.getByRole('button', { name: PROMPT_BUTTON })).toHaveCount(0);
  });
});
