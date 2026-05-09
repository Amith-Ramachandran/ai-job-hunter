/**
 * The shape we attach to `request.user` after Google ID token verification.
 * Kept narrow on purpose — anything more is the responsibility of UsersService.
 */
export interface AuthenticatedUser {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
