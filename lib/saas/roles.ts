/**
 * Who can do what once an organization is signed in.
 *
 * Provider keys stay on the platform. Nobody in a customer org configures
 * DeepSeek or MiniMax. Students only attend a published class.
 */

export type SaasRole = 'org_admin' | 'teacher' | 'student';

export type SaasAction =
  | 'play'
  | 'generate'
  | 'edit'
  | 'publish'
  | 'manage_members'
  | 'manage_billing'
  | 'configure_providers';

const GRANTS: Record<SaasRole, ReadonlySet<SaasAction>> = {
  org_admin: new Set(['play', 'generate', 'edit', 'publish', 'manage_members', 'manage_billing']),
  teacher: new Set(['play', 'generate', 'edit', 'publish']),
  student: new Set(['play']),
};

export function canPerform(role: SaasRole, action: SaasAction): boolean {
  return GRANTS[role].has(action);
}
