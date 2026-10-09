'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, GraduationCap, Users, Wallet, Settings2, School } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { refreshSaasSession } from '@/lib/saas/use-saas-session';
import { SchoolLibrary } from './school-library';
import { SchoolWallet } from './school-wallet';

interface DeskState {
  userId: string;
  kind: 'teacher' | 'student';
  role: 'org_admin' | 'teacher' | 'student' | null;
  orgId: string | null;
  orgName: string;
  joinCode: string | null;
  orgs: Array<{ orgId: string; orgName: string; role: string }>;
  pending: Array<{ id: string; orgName: string; role: string }>;
  classes: Array<{ id: string; name: string; adminName: string; adminUserId: string }>;
  members: Array<{ userId: string; name: string; email: string; role: string }>;
  requests: Array<{ id: string; name: string; email: string; role: string; createdAt: number }>;
  generations: Array<{ stageId: string; title: string; status: string }>;
}

export type SchoolView = 'home' | 'classes' | 'members' | 'wallet' | 'settings';

export function SchoolDesk({ view = 'home' }: { view?: SchoolView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [error, setError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [orgName, setOrgName] = useState('');
  const [className, setClassName] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [confirm, setConfirm] = useState<{
    orgName: string;
    title: string;
    stageId: string;
  } | null>(null);

  const reload = useCallback(async () => {
    const response = await fetch('/api/saas/school', { credentials: 'include', cache: 'no-store' });
    setLoading(false);
    const body = (await response.json().catch(() => null)) as DeskState | null;
    if (!response.ok || !body?.kind) {
      setDesk(null);
      return;
    }
    setDesk(body);
    setAdminUserId(
      (current) =>
        current || body.members?.find((member) => member.role !== 'student')?.userId || '',
    );
  }, []);

  useEffect(() => {
    // reload awaits the HTTP response before setting state; this is an async data load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload().catch(() => {
      setLoading(false);
      setError('读取学校信息失败，请刷新重试');
    });
  }, [reload]);

  async function post(payload: Record<string, unknown>) {
    setError('');
    const response = await fetch('/api/saas/school', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      status?: string;
      orgName?: string;
      title?: string;
      stageId?: string;
    } | null;
    if (!response.ok) {
      setError(body?.error || t('saas.failed'));
      return null;
    }
    await refreshSaasSession();
    await reload();
    return body;
  }

  if (!desk)
    return view === 'home' ? null : (
      <div className="rounded-2xl border bg-background p-8 text-center">
        <p className="text-muted-foreground">
          {loading ? '正在读取学校信息…' : error || '请先登录后管理学校'}
        </p>
        {!loading && (
          <Link href="/login" className="mt-4 inline-block text-primary underline">
            前往登录
          </Link>
        )}
      </div>
    );

  const menus = [
    {
      id: 'home',
      href: '/',
      label: desk.kind === 'student' ? '上课首页' : '课程与备课',
      icon: BookOpen,
      visible: true,
    },
    {
      id: 'classes',
      href: '/school/classes',
      label: '班级管理',
      icon: GraduationCap,
      visible: !!desk.orgId && desk.role !== 'student' && !!desk.role,
    },
    {
      id: 'members',
      href: '/school/members',
      label: '成员管理',
      icon: Users,
      visible: desk.role === 'org_admin',
    },
    {
      id: 'wallet',
      href: '/school/wallet',
      label: '学校钱包',
      icon: Wallet,
      visible: desk.role === 'org_admin',
    },
    { id: 'settings', href: '/school/settings', label: '学校设置', icon: Settings2, visible: true },
  ];
  const allowed = menus.some((item) => item.id === view && item.visible);
  const current = menus.find((item) => item.id === view);

  return (
    <div className="mb-6 w-full overflow-hidden rounded-2xl border border-border/60 bg-background/90 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <School size={19} />
          </span>
          <div>
            <p className="font-semibold">{desk.orgName || '我的学校'}</p>
            <p className="text-xs text-muted-foreground">
              {desk.role ? t(`saas.role.${desk.role}`) : '加入学校，开始使用'}
            </p>
          </div>
        </div>
      </div>
      <nav
        aria-label="学校功能"
        className="flex flex-wrap gap-1 border-y border-border/60 bg-muted/30 px-3 py-2"
      >
        {menus
          .filter((item) => item.visible)
          .map(({ id, href, label, icon: Icon }) => (
            <Link
              key={id}
              href={href}
              aria-current={view === id ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${view === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {id === 'members' && desk.requests.length > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-xs">
                  {desk.requests.length}
                </span>
              )}
            </Link>
          ))}
      </nav>
      <div className="space-y-5 p-5 sm:p-6">
        {!allowed ? (
          <p role="alert" className="py-8 text-center text-muted-foreground">
            你没有此页面的管理权限
          </p>
        ) : (
          <>
            {view !== 'home' && (
              <div>
                <h1 className="text-xl font-semibold">{current?.label}</h1>
                <p className="mt-1 text-muted-foreground">
                  {view === 'classes'
                    ? '管理本校班级及负责老师。'
                    : view === 'members'
                      ? '处理入校申请，管理本校老师和学生。'
                      : view === 'wallet'
                        ? '查看学校余额、充值与收支记录。'
                        : '管理学校身份，创建或申请加入其他学校。'}
                </p>
              </div>
            )}
            {view === 'home' && !desk.orgId && (
              <div className="rounded-xl bg-muted/50 p-4">
                <p>你还没有加入学校。</p>
                <Link
                  href="/school/settings"
                  className="mt-2 inline-block font-medium text-primary"
                >
                  {desk.kind === 'teacher' ? '创建或加入学校' : '申请加入学校'} →
                </Link>
              </div>
            )}
            {(view === 'settings' || !desk.orgId) &&
              desk.pending.map((item) => (
                <p key={item.id} className="text-muted-foreground">
                  {t('saas.waitingApproval', { school: item.orgName })}
                </p>
              ))}

            {view === 'home' && desk.generations?.length ? (
              <section className="space-y-2">
                <h2 className="font-medium">备课进度</h2>
                {desk.generations.map((job) => (
                  <p key={job.stageId}>
                    <Link
                      className="text-primary underline"
                      href={`/generation/${encodeURIComponent(job.stageId)}`}
                    >
                      {job.title}
                    </Link>
                    {' · '}
                    {job.status === 'succeeded'
                      ? '已完成，可试听修改'
                      : job.status === 'failed'
                        ? '生成未完成'
                        : '正在生成'}
                  </p>
                ))}
              </section>
            ) : null}

            {view === 'home' && desk.orgId && desk.role && desk.role !== 'student' ? (
              <SchoolLibrary
                key={desk.orgId}
                classes={desk.classes.filter(
                  (group) => desk.role === 'org_admin' || group.adminUserId === desk.userId,
                )}
              />
            ) : null}

            {view === 'settings' && desk.kind === 'teacher' ? (
              <form
                className="grid max-w-xl gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void post({ action: 'create', orgName });
                }}
              >
                <Input
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  placeholder={t('saas.orgName')}
                  required
                />
                <Button type="submit">{t('saas.createSchool')}</Button>
              </form>
            ) : null}

            {view === 'settings' && (
              <>
                <form
                  className="grid max-w-xl gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void post({ action: 'apply', joinCode });
                  }}
                >
                  <Input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    placeholder={t('saas.joinCode')}
                    required
                  />
                  <Button type="submit" variant="outline">
                    {t('saas.joinSchool')}
                  </Button>
                </form>
              </>
            )}
            {view === 'home' && desk.role === 'student' && desk.orgId ? (
              <form
                className="grid max-w-xl gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void post({ action: 'course-entry', code: courseCode }).then((body) => {
                    if (body?.status === 'confirm' && body.orgName && body.title && body.stageId) {
                      setConfirm({
                        orgName: body.orgName,
                        title: body.title,
                        stageId: body.stageId,
                      });
                    }
                    if (body?.status === 'join-required') setError(t('saas.joinBeforeCourse'));
                    if (body?.status === 'switch-school') setError(t('saas.switchBeforeCourse'));
                  });
                }}
              >
                <Input
                  value={courseCode}
                  onChange={(event) => setCourseCode(event.target.value.toUpperCase())}
                  placeholder={t('saas.courseCode')}
                  required
                />
                <Button type="submit">{t('saas.enterCourse')}</Button>
              </form>
            ) : null}

            {view === 'home' && confirm ? (
              <div className="rounded-lg border p-3">
                <p>
                  {t('saas.enterCourseConfirm', { school: confirm.orgName, course: confirm.title })}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    onClick={() => router.push(`/classroom/${confirm.stageId}`)}
                  >
                    {t('saas.confirmEnter')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
                    {t('saas.cancelEnter')}
                  </Button>
                </div>
              </div>
            ) : null}

            {(view === 'members' || view === 'settings') && desk.joinCode ? (
              <p>
                {t('saas.joinCode')}: <span className="font-mono">{desk.joinCode}</span>
              </p>
            ) : null}

            {desk.role === 'org_admin' ? (
              <div className="space-y-3">
                {view === 'wallet' && desk.orgId ? (
                  <SchoolWallet key={desk.orgId} orgId={desk.orgId} />
                ) : null}
                {view === 'members' && (
                  <>
                    <h2 className="font-semibold">入校申请</h2>
                    {!desk.requests.length && (
                      <p className="rounded-xl bg-muted/40 p-4 text-muted-foreground">
                        暂无待处理申请
                      </p>
                    )}
                    {desk.requests.map((request) => (
                      <div key={request.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          {request.name} {request.email} {t(`saas.role.${request.role}`)}
                          {' · '}
                          {new Date(request.createdAt).toLocaleString()}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            void post({
                              action: 'decide',
                              requestId: request.id,
                              decision: 'approve',
                            })
                          }
                        >
                          {t('saas.approve')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void post({
                              action: 'decide',
                              requestId: request.id,
                              decision: 'reject',
                            })
                          }
                        >
                          {t('saas.reject')}
                        </Button>
                      </div>
                    ))}
                    <h2 className="pt-3 font-semibold">学校成员</h2>
                    <div className="divide-y rounded-xl border">
                      {desk.members.map((member) => (
                        <div
                          key={member.userId}
                          className="flex flex-wrap items-center justify-between gap-3 p-4"
                        >
                          <div>
                            <p className="font-medium">
                              {member.name}
                              <span className="ml-2 rounded-md bg-muted px-2 py-1 text-xs font-normal text-muted-foreground">
                                {t(`saas.role.${member.role}`)}
                              </span>
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{member.email}</p>
                          </div>
                          {member.role !== 'org_admin' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void post({ action: 'remove', userId: member.userId })}
                            >
                              {t('saas.removeMember')}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {view === 'classes' && (
                  <>
                    <h2 className="font-semibold">新建班级</h2>
                    <form
                      className="grid max-w-xl gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void post({ action: 'class', name: className, adminUserId });
                      }}
                    >
                      <Input
                        value={className}
                        onChange={(event) => setClassName(event.target.value)}
                        placeholder={t('saas.className')}
                        required
                      />
                      <select
                        className="rounded-md border bg-background px-2 py-1"
                        value={adminUserId}
                        onChange={(event) => setAdminUserId(event.target.value)}
                        required
                      >
                        <option value="">{t('saas.classAdmin')}</option>
                        {desk.members
                          .filter((member) => member.role !== 'student')
                          .map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.name}
                            </option>
                          ))}
                      </select>
                      <Button type="submit" variant="outline">
                        {t('saas.createClass')}
                      </Button>
                    </form>
                  </>
                )}
              </div>
            ) : null}

            {view === 'classes' && desk.classes.length === 0 && (
              <p className="rounded-xl bg-muted/40 p-4 text-muted-foreground">
                暂无班级
                {desk.role === 'org_admin'
                  ? '，创建第一个班级后即可开始备课。'
                  : '，请联系学校管理员创建。'}
              </p>
            )}
            {view === 'classes' && desk.classes.length > 0 ? (
              <ul className="divide-y rounded-xl border">
                {desk.classes.map((group) => (
                  <li
                    key={group.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    {group.name} · {group.adminName}
                    {desk.role === 'org_admin' ? (
                      <select
                        aria-label={`${group.name} · ${t('saas.classAdmin')}`}
                        className="ml-2 rounded-md border bg-background px-2 py-1"
                        value={group.adminUserId}
                        onChange={(event) =>
                          void post({
                            action: 'class-admin',
                            classGroupId: group.id,
                            adminUserId: event.target.value,
                          })
                        }
                      >
                        {desk.members
                          .filter((member) => member.role !== 'student')
                          .map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.name}
                            </option>
                          ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
