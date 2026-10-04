import { z } from 'zod';

// ---------------------------------------------------------------------------
// Panel security: login with 2FA, sessions, IP allowlist.
// Vietnamese messages here are translated by the server (apps/server/src/i18n/en/security.ts).
// ---------------------------------------------------------------------------

/** A 6-digit TOTP code or a recovery code ("k3f9q-x2mzt"). */
export const secondFactorCodeSchema = z.string().trim().min(6, 'Mã xác thực không hợp lệ').max(32, 'Mã xác thực không hợp lệ');

export const loginSecondFactorSchema = z.object({
  mfaToken: z.string().min(1),
  code: secondFactorCodeSchema,
});

export const twoFactorCodeSchema = z.object({ code: secondFactorCodeSchema });

export const twoFactorDisableSchema = z
  .object({
    code: z.string().trim().max(32).optional(),
    password: z.string().max(200).optional(),
  })
  .refine((v) => !!v.code || !!v.password, 'Nhập mã xác thực hoặc mật khẩu hiện tại');

export const passwordChangeSchema = z.object({
  current: z.string().min(1, 'Mật khẩu hiện tại không đúng').max(200),
  next: z.string().min(10, 'Mật khẩu mới tối thiểu 10 ký tự').max(200),
});

export const ALLOWLIST_MAX = 100;

export const allowlistUpdateSchema = z.object({
  entries: z.array(z.string().trim().min(1).max(64)).max(ALLOWLIST_MAX),
  /** Save even though the list does not cover the IP of the request saving it. */
  force: z.boolean().optional(),
});
export type AllowlistUpdate = z.infer<typeof allowlistUpdateSchema>;

export interface SessionUser {
  id: number;
  username: string;
  twoFactor: boolean;
}

/** POST /api/auth/login: either a session, or a request for the second factor. */
export type LoginResult =
  | { token: string; user: SessionUser; recoveryCodesLeft?: number }
  | { mfaRequired: true; mfaToken: string };

export interface TwoFactorStatus {
  enabled: boolean;
  /** Setup started but not confirmed with a code yet. */
  pending: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

export interface TwoFactorEnabled {
  recoveryCodes: string[];
  /** Fresh session token: enabling 2FA signs out every other session. */
  token: string;
}

export interface AllowlistView {
  entries: string[];
  /** The address this request came from, as the panel sees it. */
  currentIp: string;
}
