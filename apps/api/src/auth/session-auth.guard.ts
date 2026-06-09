/**
 * Route guard: pulls the access JWT from the `dhruva_at` cookie, verifies it,
 * and attaches the embedded user to the request.
 *
 * Apply with `@UseGuards(SessionAuthGuard)`. Combined with @CurrentUser(),
 * route handlers receive a fully-typed AuthenticatedUser without doing any
 * DB work.
 *
 * Token refresh is a frontend concern (the axios interceptor retries on 401
 * via POST /auth/refresh) — this guard just verifies whatever it's given.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, readCookie } from './cookies';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request, ACCESS_COOKIE);
    if (!token) {
      throw new UnauthorizedException('Missing session');
    }
    request.user = this.authService.verifyAccessToken(token);
    return true;
  }
}
