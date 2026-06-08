/**
 * Cookie helpers for session tokens.
 *
 * Names:
 *   - dhruva_at: short-lived access JWT
 *   - dhruva_rt: opaque refresh token
 *
 * Flags:
 *   - httpOnly: JS can't read them — eliminates XSS-driven token theft.
 *   - sameSite=lax: blocks CSRF from cross-site contexts on state-changing
 *     requests. Frontend (localhost:5173) and API (localhost:3000) share an
 *     eTLD+1 of "localhost", so lax cookies travel on XHR. In production,
 *     api.<domain> and app.<domain> are same-site; this still holds.
 *   - secure: true in production so cookies only flow over HTTPS. Disabled in
 *     dev because Vite runs on plain http://localhost.
 *
 * Note on CSRF: SameSite=Lax is the primary defense. We don't layer a CSRF
 * token on top because (a) every mutating endpoint requires a same-site cookie
 * that lax already gates, and (b) modern browsers default to lax-or-stricter
 * for cookies without an explicit SameSite attribute. If we ever embed the
 * app in a third-party iframe or accept cross-site POSTs, revisit.
 */
import type { CookieOptions, Response, Request } from 'express';

export const ACCESS_COOKIE = 'dhruva_at';
export const REFRESH_COOKIE = 'dhruva_rt';

interface SetCookieArgs {
  res: Response;
  accessToken: string;
  accessMaxAgeSec: number;
  refreshToken: string;
  refreshMaxAgeSec: number;
  isProd: boolean;
}

export function setSessionCookies({
  res,
  accessToken,
  accessMaxAgeSec,
  refreshToken,
  refreshMaxAgeSec,
  isProd,
}: SetCookieArgs): void {
  const base: CookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    maxAge: accessMaxAgeSec * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    maxAge: refreshMaxAgeSec * 1000,
  });
}

export function clearSessionCookies(res: Response, isProd: boolean): void {
  // express's `clearCookie` only matches when the flags match the original
  // `Set-Cookie`. Mirror everything except maxAge so the browser actually
  // drops them.
  const base: CookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

/**
 * Reads a named cookie off the request. cookie-parser populates `req.cookies`
 * — this helper just narrows the type and returns null instead of undefined.
 */
export function readCookie(req: Request, name: string): string | null {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[name] ?? null;
}
