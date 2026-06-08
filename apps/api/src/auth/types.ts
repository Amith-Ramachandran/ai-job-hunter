/**
 * The shape we attach to `request.user` after access-token verification.
 * Kept narrow on purpose — anything more is the responsibility of UsersService.
 */
export interface AuthenticatedUser {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Access-token JWT payload. Mirrors AuthenticatedUser plus the standard `sub`
 * field used by JWT libraries. Embedded so protected routes can identify the
 * caller without a DB lookup; email/name/picture can be up to one access-TTL
 * stale, which is acceptable.
 */
export interface AccessTokenPayload {
  sub: string;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * The full result of issuing or rotating a session. The controller turns
 * `accessToken` and `refreshToken` into HttpOnly cookies on the response.
 */
export interface IssuedSession {
  accessToken: string;
  accessTokenMaxAgeSec: number;
  refreshToken: string;
  refreshTokenMaxAgeSec: number;
  user: AuthenticatedUser;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
