import { test, expect } from '@playwright/test';
const admin = {
  userId: 'navigation-teacher',
  email: 'navigation@example.test',
  kind: 'teacher',
  role: 'org_admin',
  orgId: 'navigation-school',
  orgName: '长安小学',
  balanceMilliYuan: 80000,
  joinCode: 'TEST1234',
  orgs: [{ orgId: 'navigation-school', orgName: '长安小学', role: 'org_admin' }],
  pending: [],
  classes: [],
  members: [
    {
      userId: 'navigation-teacher',
      name: '王老师',
      email: 'navigation@example.test',
      role: 'org_admin',
    },
  ],
  requests: [],
  generations: [],
};
test('school menu separates administration from the teaching homepage', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'zh-CN'));
  await page.route('**/api/saas/session', (route) => route.fulfill({ json: admin }));
  await page.route('**/api/saas/school', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'POST'
          ? {
              balanceMilliYuan: 80000,
              trialTopupEnabled: true,
              alipayEnabled: false,
              entries: [],
              paymentOrders: [],
            }
          : admin,
    }),
  );
  await page.route('**/api/saas/lessons?*', (route) => route.fulfill({ json: { lessons: [] } }));
  await page.goto('/');
  const menu = page.getByRole('navigation', { name: '学校功能' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('button', { name: '添加测试额度' })).toHaveCount(0);
  await expect(page.getByPlaceholder('班级名称')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建学校', exact: true })).toHaveCount(0);
  await menu.getByRole('link', { name: '学校钱包' }).click();
  await expect(page).toHaveURL('/school/wallet');
  await expect(page.getByRole('button', { name: '添加测试额度' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: '学校钱包', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await menu.getByRole('link', { name: '班级管理' }).click();
  await expect(page.getByPlaceholder('班级名称')).toBeVisible();
  await expect(page.getByRole('button', { name: '添加测试额度' })).toHaveCount(0);
  await menu.getByRole('link', { name: '成员管理' }).click();
  await expect(page.getByText('暂无待处理申请')).toBeVisible();
  await expect(page.getByText('王老师', { exact: false })).toBeVisible();
  await menu.getByRole('link', { name: '学校设置' }).click();
  await expect(page.getByRole('button', { name: '创建学校', exact: true })).toBeVisible();
  await menu.getByRole('link', { name: '课程与备课' }).click();
  await expect(page).toHaveURL('/');
  await expect(menu).toBeVisible();
  await expect
    .poll(() =>
      menu.evaluate((element) => {
        let node: Element | null = element;
        while (node) {
          if (Number(getComputedStyle(node).opacity) < 0.99) return false;
          node = node.parentElement;
        }
        return true;
      }),
    )
    .toBe(true);
  await page.screenshot({ path: '/tmp/mingke-menu-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/mingke-menu-mobile.png', fullPage: true });
});
test('students cannot see management menus or open the wallet page', async ({ page }) => {
  const student = {
    ...admin,
    kind: 'student',
    role: 'student',
    joinCode: null,
    members: [],
    orgs: [{ ...admin.orgs[0], role: 'student' }],
  };
  await page.route('**/api/saas/session', (route) => route.fulfill({ json: student }));
  await page.route('**/api/saas/school', (route) => route.fulfill({ json: student }));
  await page.goto('/school/wallet');
  await expect(page.getByText('你没有此页面的管理权限')).toBeVisible();
  await expect(page.getByRole('link', { name: '学校钱包', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '成员管理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加测试额度' })).toHaveCount(0);
});
