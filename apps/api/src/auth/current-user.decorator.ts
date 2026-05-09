/**
 * Param decorator that pulls the authenticated user off the request.
 *
 * Usage:
 *   @UseGuards(GoogleAuthGuard)
 *   @Get('me')
 *   me(@CurrentUser() user: AuthenticatedUser) { ... }
 */
import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.user) {
      // Guard should have set this. If not, treat as a programmer error
      // surfaced as 401 rather than a 500.
      throw new UnauthorizedException();
    }
    return request.user;
  },
);
