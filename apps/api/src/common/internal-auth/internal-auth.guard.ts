/**
 * InternalAuthGuard — protects /internal/* routes that the Python AI service
 * calls back into.
 *
 * The check is a simple shared-secret bearer compared in constant time.
 * Routes guarded by this MUST NOT depend on a user cookie session — they
 * trust whatever the request body / query says about `userId` because the
 * caller is our own AI service, not a browser. The shared secret is the
 * authentication boundary; the userId is a parameter.
 *
 * Production hardening (Phase 3 polish):
 *   - rotate the token via an admin endpoint
 *   - move to mTLS between services
 *   - add per-call rate limit to bound the blast radius of a leaked token
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../config/env.schema';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header) throw new UnauthorizedException('Missing bearer token');
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) {
      throw new UnauthorizedException('Bad bearer token');
    }
    const expected = this.config.get('INTERNAL_SERVICE_TOKEN', { infer: true });
    if (!constantTimeEqual(value, expected)) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}

/**
 * Constant-time string compare. Bypasses early-exit on mismatched lengths
 * by padding to the longer side — prevents length-leak timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison so total work is roughly equivalent — pad shorter.
    const max = Math.max(ab.length, bb.length);
    const pa = Buffer.alloc(max);
    const pb = Buffer.alloc(max);
    ab.copy(pa);
    bb.copy(pb);
    timingSafeEqual(pa, pb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
