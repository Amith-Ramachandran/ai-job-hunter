/**
 * Route guard: extracts the Google ID token from the Authorization header,
 * verifies it via AuthService, attaches the resolved user to the request,
 * and lets the route handler proceed.
 *
 * Apply with `@UseGuards(GoogleAuthGuard)` on a controller or specific route.
 * Combined with the @CurrentUser() decorator, route handlers receive a
 * fully-typed AuthenticatedUser.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    request.user = await this.authService.verifyAndUpsert(token);
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
  }
}
