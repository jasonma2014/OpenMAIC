# 明课下一阶段实现与验收

对应 `mingke-roadmap.md` 的第 1–7 项。本轮面向学校试用；支付宝支付已按配置接入，当前未配置商户资料，真实收款保持关闭。

## 已实现

| 路线图 | 实现 | 主要验收位置 |
| --- | --- | --- |
| 1. 邮箱注册登录 | 姓名、邮箱、密码；老师/学生身份唯一；失败注册回滚；已有邮箱账号迁移 | `tests/saas/school-flow.test.ts`、`school-http.test.ts` |
| 2. 学校、班级、课程码 | 机构码申请；校管理员审批、移出、建班、换班管理员；顶栏切校；学生确认进入已发布课程 | `school-flow.test.ts`、`school-http.test.ts`、`school-only.test.ts` |
| 3. 学校钱包 | 仅校管理员充值和查看收支；支付宝收银台、回调验签、幂等入账；可选测试额度 | `alipay.test.ts`、`alipay-config.test.ts`、`school-http.test.ts`、`billing.test.ts` |
| 4. 后台生成与进度 | 一个课程 ID 对应一个持久任务；大纲、页数、配图与旁白数量；首页重开进度；重复请求不重复运行 | `generation-jobs.test.ts`、`generation-runner.test.ts`、`tests/server/classroom-media-generation.test.ts`、`classroom-tts-progress.test.ts` |
| 5. 局部修改 | 修改一句讲解、上传替换配图、修改题干/选项/答案/解析；讲解变化使旧旁白失效，可重新试听 | `lesson-revision.test.ts`、`e2e/tests/mingke-school.spec.ts` |
| 6. 上课结果 | 到课记录；服务端按课件答案判选择题；简答题待老师批阅；逐人完成数/对错汇总；提交防重 | `learning-results.test.ts`、`e2e/tests/mingke-school.spec.ts` |
| 7. 校内复用 | 按年级、科目筛选；复制到有管理权限的班级；副本独立且未发布；学校资源隔离 | `lesson-library.test.ts`、`asset-route.test.ts`、浏览器验收 |

功能开发采用先失败测试、再实现、再回归的 TDD 循环。账号、并发申请/审批、班级权限、钱包、任务防重、修改内容、答题结果、课程库均有行为测试；数据库规则使用 PGlite/PostgreSQL，不只模拟 SQL 返回值。

## 运行与试用

1. 配置 PostgreSQL 的 `DATABASE_URL` 和平台模型服务。学校表会在首次访问时迁移。
2. 启动 `pnpm dev`，从老师注册入口创建学校，从「班级管理」菜单创建班级。
3. 本机 `.env.local` 已开启 `OPENMAIC_TRIAL_TOPUP_ENABLED=true`，管理员可从「学校钱包」菜单添加测试额度。`.env.example` 默认关闭此项；公开付费部署不能把测试额度当成已收款。
4. 老师备课时选择管理的班级并填写年级、科目。任务开始后，可以从首页的“备课进度”重开。
5. 试听、修改后发出课程码。学生先注册、申请并获批，再输入课程码确认进入。

`OPENMAIC_SAAS_ENABLED` 不再控制交付形态；正式代码始终要求学校登录。旧匿名文件分享、直接班级码入校、未按班级授权的旧工作台写入口均不能用于学校课程。单元测试在测试环境中保留旧适配器夹具，以继续检查底层存储回归。

## 支付边界

已接入支付宝电脑网站支付（`alipay.trade.page.pay`），使用[支付宝官方 Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all)。管理员选择 10/50/100 元创建订单，打开收银台付款。只有经过 RSA2 验签、匹配应用/收款方/订单/金额的成功通知才增加余额；通知重试、重复点击均不会重复入账。浏览器返回链接不能作为付款凭据。钱包可重新打开未付订单、刷新到账状态。

公司和商户资料尚未提供，当前不开真实收款。后续需要配置：

- `ALIPAY_APP_ID`：已开通电脑网站支付的应用 ID。
- `ALIPAY_SELLER_ID`：对应商户的支付宝 UID。
- `ALIPAY_PRIVATE_KEY`：应用私钥（PKCS8 PEM）；`ALIPAY_PUBLIC_KEY`：支付宝公钥。仅在服务端环境变量中设置，不写入代码或前端。
- `ALIPAY_PUBLIC_ORIGIN`：公网 HTTPS 域名；通知路径固定为 `/api/saas/payments/alipay/notify`。
- `ALIPAY_ENABLED=true`，正式环境 `ALIPAY_SANDBOX=false`；真实付费环境关闭 `OPENMAIC_TRIAL_TOPUP_ENABLED`。

先使用独立沙箱应用、独立数据库与 `ALIPAY_SANDBOX=true` 做联调，再进行小额真实支付验收。沙箱界面会明确标记测试性质，不能与正式余额混用。当前支持普通公钥模式；若申请的是证书模式，需要在上线前补充证书配置。自动退款和主动对账不在本轮内；回调暂未到达时保持待到账，可刷新检查，不会根据前端状态加钱。

## 本轮验收结果

2026-09-26：53 个测试文件、529 项相关回归测试通过；完整浏览器流程通过（包含模拟支付宝收银台入口）；TypeScript、生产构建、多语言键检查通过。变更文件 ESLint 无错误，首页仍有一条旧加载逻辑的 Hook 依赖警告。新增支付文件无 lint 警告。

浏览器验收不点击真实支付宝付款链接。支付签名使用临时测试密钥，数据库使用本地 PGlite；因此尚不代表支付宝商户侧联调完成。

## 验证命令

```sh
pnpm test tests/saas --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
pnpm build
```

浏览器验收使用真实学校 API 和本地 PostgreSQL，模型接口被拦截，不产生真实模型调用或付款。测试账号、学校、课程及资源在结束后清理：

```sh
# 在已开启学校试用充值的本地服务上运行（端口 3002）
MINGKE_SCHOOL_E2E=true pnpm exec playwright test e2e/tests/mingke-school.spec.ts --workers=1
```

浏览器测试覆盖注册、充值、建班、讲解/练习/图片修改、发布、学生审批与课程码确认、真实答题提交、结果查询、复制及多学校切换。

## 当前范围

浏览器关闭不会取消已启动的后台生成。任务失败后保留失败状态，不会因重开页面而自动重新消费。进程重启后的任务自动恢复、内容安全审核及开票不在本轮试用实现中。支付宝代码已完成本地签名与数据库联调测试；缺少商户资料，尚未进行支付宝沙箱或真实付款验收。外部模型可用性仍需在配置平台服务后验证。

## 学校菜单

首页只保留课程库、备课进度及备课入口；学生首页保留课程码入口。菜单按当前学校身份显示：

- 课程与备课／上课首页：`/`。
- 班级管理：`/school/classes`，管理员建班、换负责老师；老师查看班级。
- 成员管理：`/school/members`，仅校管理员处理申请、查看成员和移出成员。
- 学校钱包：`/school/wallet`，仅校管理员查看余额、充值和收支。
- 学校设置：`/school/settings`，创建／加入学校并查看待审批申请。

顶栏继续提供多学校切换。独立页面支持直接访问、刷新和浏览器前进后退；学生直接打开管理页面也不会显示管理操作。导航与移动端布局由 `e2e/tests/school-navigation.spec.ts` 验证，原有完整上课验收同步改为经过菜单操作。
