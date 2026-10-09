export const ROLES_LIST = ['admin', 'analyst'] as const;
export type Role = (typeof ROLES_LIST)[number];

/** Identity carried in the access token and attached to authenticated requests. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export const ACCESS_COOKIE = 'aj_access';
export const REFRESH_COOKIE = 'aj_refresh';
