import { test, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 15_000 });
import { Pool } from 'pg';

// Opt-in integration suite: real local school DB, no model calls or payments.
test.skip(
  process.env.MINGKE_SCHOOL_E2E !== 'true',
  'Requires school-mode local server and database',
);

test('teacher prepares, revises, publishes and reuses a course; approved student attends and submits', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  await page
    .context()
    .route(/\/api\/(tts|chat|generate|voice|grade-quiz)(\/|\?|$)/, (route) => route.abort());
  const stamp = `mingke-e2e-${Date.now()}`;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://majian@127.0.0.1:5432/openmaic',
  });
  const studentContext = await browser.newContext();
  await studentContext.route(/\/api\/(tts|chat|generate|voice|grade-quiz)(\/|\?|$)/, (route) =>
    route.abort(),
  );
  const studentPage = await studentContext.newPage();
  studentPage.setDefaultTimeout(15_000);
  const orgIds: string[] = [];
  await page.addInitScript(() => localStorage.setItem('locale', 'zh-CN'));
  await studentPage.addInitScript(() => localStorage.setItem('locale', 'zh-CN'));
  try {
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/server-providers')),
      page.goto('/register/teacher'),
    ]);
    await page.getByPlaceholder('姓名', { exact: true }).fill('验收老师');
    await page.getByPlaceholder('邮箱', { exact: true }).fill(`${stamp}@school.test`);
    await page.getByPlaceholder('密码，至少 8 位').fill('classroom-pass');
    await page.getByPlaceholder('学校名称', { exact: true }).fill('明课验收学校');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.waitForURL('/');
    const account = await (await page.request.get('/api/saas/school')).json();
    orgIds.push(account.orgId);
    await expect(page.getByRole('button', { name: '添加测试额度' })).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '学校功能' })
      .getByRole('link', { name: '学校钱包' })
      .click();
    await expect(page.getByRole('region', { name: '学校钱包' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建文件夹' })).toHaveCount(0);
    const balance = account.balanceMilliYuan;
    await page.getByRole('button', { name: '添加测试额度' }).click();
    await expect
      .poll(
        async () => (await (await page.request.get('/api/saas/school')).json()).balanceMilliYuan,
      )
      .toBe(balance + 10_000);
    // Exercise checkout UI without merchant credentials or any external payment request.
    await expect(page.getByRole('button', { name: '支付宝充值', exact: true })).toHaveCount(0);
    await page.route('**/api/saas/school', async (route) => {
      if (
        route.request().method() === 'POST' &&
        route.request().postDataJSON()?.action === 'wallet'
      ) {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: {
            ...(await response.json()),
            alipayEnabled: true,
            alipaySandbox: true,
            paymentOrders: [],
          },
        });
      } else await route.continue();
    });
    await page.route('**/api/saas/payments/alipay', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ amountMilliYuan: 50_000 });
      await route.fulfill({
        status: 201,
        json: {
          orderId: 'browser-test-order',
          status: 'pending',
          paymentUrl: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do?test=local-only',
          sandbox: true,
        },
      });
    });
    await page.reload();
    await page.getByLabel('支付宝充值金额').selectOption('50000');
    await page.getByRole('button', { name: '支付宝充值', exact: true }).click();
    await expect(page.getByRole('link', { name: '前往支付宝收银台' })).toHaveAttribute(
      'href',
      /openapi-sandbox\.dl\.alipaydev\.com/,
    );
    await expect(page.getByText('支付宝沙箱：仅供联调，不发生真实付款。')).toBeVisible();
    await page.unrouteAll({ behavior: 'wait' });
    await page.reload();
    await page
      .getByRole('navigation', { name: '学校功能' })
      .getByRole('link', { name: '班级管理' })
      .click();
    await page.getByPlaceholder('班级名称').fill('三年一班');
    await page.getByRole('button', { name: '创建班级' }).click();
    await expect
      .poll(async () => (await (await page.request.get('/api/saas/school')).json()).classes.length)
      .toBe(1);
    const desk = await (await page.request.get('/api/saas/school')).json();
    const prepared = await page.request.post('/api/saas/school', {
      data: {
        action: 'prepare-lesson',
        classGroupId: desk.classes[0].id,
        title: '分数入门',
        grade: '三年级',
        subject: '数学',
      },
    });
    expect(prepared.status()).toBe(201);
    const lesson = await prepared.json();
    const now = Date.now();
    const scene = {
      id: `${stamp}-quiz`,
      stageId: lesson.stageId,
      type: 'quiz',
      title: '分数练习',
      order: 0,
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q1',
            type: 'single',
            question: '一半怎么表示？',
            options: [
              { value: 'A', label: '1/2' },
              { value: 'B', label: '1/3' },
            ],
            answer: ['A'],
            analysis: '平均分成两份取一份。',
          },
        ],
      },
      actions: [{ id: 'speech-1', type: 'speech', text: '今天认识分数。' }],
    };
    const saved = await page.request.put(`/api/persistence/documents/${lesson.stageId}`, {
      data: {
        stage: { id: lesson.stageId, name: '分数入门', createdAt: now, updatedAt: now },
        scenes: [
          scene,
          {
            id: `${stamp}-slide`,
            stageId: lesson.stageId,
            type: 'slide',
            title: '分数配图',
            order: 1,
            content: {
              type: 'slide',
              canvas: {
                id: 'canvas',
                viewportSize: 1000,
                viewportRatio: 0.5625,
                theme: {
                  backgroundColor: '#ffffff',
                  themeColors: ['#123456'],
                  fontColor: '#000000',
                  fontName: 'Arial',
                },
                elements: [
                  {
                    id: 'image-1',
                    type: 'image',
                    left: 20,
                    top: 20,
                    width: 200,
                    height: 200,
                    rotate: 0,
                    fixedRatio: true,
                    src: 'https://example.test/old-image.png',
                  },
                ],
              },
            },
          },
        ],
        outline: { outlines: [], generationComplete: true, createdAt: now, updatedAt: now },
      },
    });
    expect(saved.status(), await saved.text()).toBe(204);
    await pool.query('UPDATE stage_meta SET generation_complete = true WHERE stage_id = $1', [
      lesson.stageId,
    ]);
    await page.goto(`/classroom/${lesson.stageId}`);
    await page.getByRole('button', { name: '修改这节课' }).click();
    await page.getByLabel('讲解文本').fill('把一个整体平均分成两份，每一份就是二分之一。');
    await page.getByRole('button', { name: '保存这句讲解' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    await page
      .getByRole('textbox', { name: '题干', exact: true })
      .fill('把整体平分两份，其中一份怎样表示？');
    await page.getByRole('button', { name: '保存这道练习' }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/persistence/documents/${lesson.stageId}`)).json())
            .scenes[0].content.questions[0].question,
      )
      .toBe('把整体平分两份，其中一份怎样表示？');
    await page.getByRole('combobox', { name: '要修改的页面' }).selectOption(`${stamp}-slide`);
    await page.getByLabel('更换配图 1').setInputFiles({
      name: 'new.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/persistence/documents/${lesson.stageId}`)).json())
            .scenes[1].content.canvas.elements[0].src,
      )
      .toMatch(/^ast_/);
    await page.getByRole('button', { name: '回到课堂试听' }).click();
    await page.getByRole('button', { name: '发出课程码' }).click();
    const code = await page.getByRole('textbox', { name: '课程码', exact: true }).inputValue();
    expect(code.length).toBeGreaterThan(0);

    const registered = await studentPage.request.post('http://localhost:3002/api/saas/register', {
      data: {
        email: `student-${stamp}@school.test`,
        password: 'classroom-pass',
        name: '验收学生',
        kind: 'student',
        joinCode: account.joinCode,
      },
    });
    expect(registered.status()).toBe(201);
    expect(
      (
        await studentPage.request.get(
          `http://localhost:3002/api/persistence/documents/${lesson.stageId}`,
        )
      ).status(),
    ).toBe(401);
    await page.goto('/');
    await page
      .getByRole('navigation', { name: '学校功能' })
      .getByRole('link', { name: '成员管理' })
      .click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await studentPage.goto('http://localhost:3002/');
    await expect(studentPage.getByRole('button', { name: '添加测试额度' })).toHaveCount(0);
    await studentPage.getByPlaceholder('课程码', { exact: true }).fill(code);
    await studentPage.getByRole('button', { name: '进入课程', exact: true }).click();
    await expect(studentPage.getByText('你将进入明课验收学校的「分数入门」')).toBeVisible();
    await studentPage.getByRole('button', { name: '确认进入' }).click();
    await expect(studentPage.getByRole('button', { name: '修改这节课' })).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/saas/lessons/${lesson.stageId}/results`)).json())
            .students.length,
      )
      .toBe(1);
    await studentPage.getByRole('button', { name: '开始答题' }).click();
    await studentPage.getByRole('button', { name: /A.*1\/2/ }).click();
    await studentPage.getByRole('button', { name: '提交答案' }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/saas/lessons/${lesson.stageId}/results`)).json())
            .students[0].correct,
      )
      .toBe(1);
    const report = await (
      await page.request.get(`/api/saas/lessons/${lesson.stageId}/results`)
    ).json();
    expect(report.students[0]).toMatchObject({ name: '验收学生', completed: 1, correct: 1 });
    expect(
      (
        await studentPage.request.put(
          `http://localhost:3002/api/persistence/documents/${lesson.stageId}/scenes/${scene.id}`,
          { data: scene },
        )
      ).status(),
    ).toBe(403);

    await expect(page.getByRole('button', { name: '新建文件夹' })).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '学校功能' })
      .getByRole('link', { name: '课程与备课' })
      .click();
    await page.getByLabel('筛选年级').fill('三年级');
    await page.getByLabel('筛选科目').fill('数学');
    await page.getByRole('button', { name: '复制到所选班级' }).click();
    await page.waitForURL(/\/classroom\//);
    const copyId = page.url().split('/').at(-1)!;
    expect(copyId).not.toBe(lesson.stageId);
    await expect(page.getByRole('button', { name: '修改这节课' })).toBeVisible();
    expect((await (await page.request.get(`/api/stage-meta/${copyId}`)).json()).isPublic).toBe(
      false,
    );
    const secondSchool = await (
      await page.request.post('/api/saas/school', {
        data: { action: 'create', orgName: '明课验收第二校' },
      })
    ).json();
    orgIds.push(secondSchool.orgId);
    await page.goto('/');
    await page.getByRole('combobox', { name: '切换当前学校' }).selectOption(account.orgId);
    await expect
      .poll(async () => (await (await page.request.get('/api/saas/school')).json()).orgId)
      .toBe(account.orgId);
    await expect(page.getByRole('link', { name: '分数入门', exact: true }).first()).toBeVisible();
  } finally {
    await studentContext.close();
    // Only this test's unique users and schools are removed.
    const orgs = await pool.query(
      'SELECT m.org_id FROM saas_memberships m JOIN saas_users u ON u.id = m.user_id WHERE u.email = $1',
      [`${stamp}@school.test`],
    );
    for (const row of orgs.rows) if (!orgIds.includes(row.org_id)) orgIds.push(row.org_id);
    for (const orgId of orgIds) {
      const entries = await pool.query(
        'SELECT content_hash FROM asset_entries WHERE principal = $1',
        [orgId],
      );
      await pool.query('DELETE FROM asset_entries WHERE principal = $1', [orgId]);
      for (const entry of entries.rows)
        await pool.query(
          'UPDATE asset_blobs SET unreferenced_at = now() WHERE content_hash = $1 AND NOT EXISTS (SELECT 1 FROM asset_entries WHERE content_hash = $1)',
          [entry.content_hash],
        );
      const stages = await pool.query('SELECT stage_id FROM saas_lessons WHERE org_id = $1', [
        orgId,
      ]);
      for (const { stage_id } of stages.rows)
        await pool.query('DELETE FROM document_stages WHERE id = $1', [stage_id]);
      for (const table of [
        'saas_quiz_submissions',
        'saas_attendance',
        'saas_generation_jobs',
        'saas_course_codes',
        'saas_lessons',
        'saas_class_groups',
        'saas_wallet_topups',
        'saas_ledger',
        'saas_classes',
        'saas_join_requests',
        'saas_sessions',
        'saas_memberships',
        'saas_wallets',
      ])
        await pool.query(`DELETE FROM ${table} WHERE org_id = $1`, [orgId]);
      await pool.query('DELETE FROM saas_orgs WHERE id = $1', [orgId]);
    }
    await pool.query(
      'DELETE FROM saas_sessions WHERE user_id IN (SELECT id FROM saas_users WHERE email = ANY($1))',
      [[`${stamp}@school.test`, `student-${stamp}@school.test`]],
    );
    await pool.query('DELETE FROM saas_users WHERE email = ANY($1)', [
      [`${stamp}@school.test`, `student-${stamp}@school.test`],
    ]);
    await pool.end();
  }
});
