import { type PermissionScope } from '@educore/shared';

export interface AuthUser {
  id: string;
  email: string;
  firstNames: string;
  lastNames: string;
  institution: { id: string; name: string };
  roles: Array<{ code: string; name: string }>;
  permissions: Array<{ code: string; scopes: PermissionScope[] }>;
}

export interface AuthSession {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
}
