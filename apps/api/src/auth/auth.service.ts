/**
 * Session-issuing AuthService.
 *
 * Two-token session model:
 *   - Access token: short-lived JWT (default 15 min). Stateless: the guard
 *     verifies the signature and trusts the payload (so protected routes do
 *     no DB hit just to identify the caller). Carried in the `dhruva_at`
 *     HttpOnly cookie.
 *   - Refresh token: opaque 32-byte random secret. Stored in DB only as its
 *     SHA-256 hash so a DB leak doesn't yield live sessions. Carried in the
 *     `dhruva_rt` HttpOnly cookie.
 *
 * Refresh tokens rotate on every use: the presented token is revoked, a new
 * one is issued, and `replacedById` links the chain. If a token that's
 * *already* revoked is presented, that's a theft signal — we revoke every
 * descendant in the chain (effectively: sign out every session the original
 * fork spawned). This is the "reuse detection" pattern OWASP recommends.
 *
 * Why opaque-not-JWT for refresh: refresh tokens must be revocable. Stateless
 * JWTs can't be revoked (without a deny-list), so making refresh tokens
 * DB-backed is simpler and strictly more secure.
 */
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Env } from '../common/config/env.schema';
import type { AuthenticatedUser, AccessTokenPayload, IssuedSession } from './types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    this.googleClientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    // OAuth2Client without a client secret is fine — we only verify ID tokens
    // here, never exchange auth codes.
    this.googleClient = new OAuth2Client(this.googleClientId);
    this.accessTtlSec = this.config.get('JWT_ACCESS_TTL_MIN', { infer: true }) * 60;
    this.refreshTtlSec = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true }) * 86400;
  }

  // ─── Google ID token → session ───────────────────────────────────────────

  /**
   * Verifies a Google ID token, upserts the local User, and issues a fresh
   * (access, refresh) pair. Called from POST /auth/google after the frontend
   * completes the Google OAuth dance.
   */
  async exchangeGoogleIdToken(
    idToken: string,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<IssuedSession> {
    const user = await this.verifyAndUpsert(idToken);
    return this.issueSession(user, ctx);
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────

  /**
   * Validates a presented refresh token and rotates it. Returns a new
   * (access, refresh) pair.
   *
   * On reuse of an already-revoked token, revokes the entire chain for the
   * owning user — every session that traces back to the stolen fork is killed.
   */
  async rotateRefresh(
    rawToken: string,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<IssuedSession> {
    const tokenHash = hashToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      // Unknown token — could be a forged cookie or a token we already pruned.
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.revokedAt) {
      // Reuse detection: a revoked token came back. Treat as theft and kill
      // every refresh token this user has — forcing re-login on every device.
      this.logger.warn(
        { userId: record.userId, refreshTokenId: record.id },
        'Refresh token reuse detected — revoking entire user chain',
      );
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user: AuthenticatedUser = {
      id: record.user.id,
      googleSub: record.user.googleSub,
      email: record.user.email,
      name: record.user.name,
      picture: record.user.picture,
    };

    // Mint the replacement first so we can write `replacedById` in one update.
    const issued = await this.issueSession(user, ctx);
    const replacement = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(issued.refreshToken) },
      select: { id: true },
    });
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedById: replacement?.id ?? null },
    });

    return issued;
  }

  // ─── Logout ──────────────────────────────────────────────────────────────

  /**
   * Revokes the presented refresh token. Best-effort: an unknown token isn't
   * an error (could be already-expired, already-revoked, or just absent).
   */
  async revokeRefresh(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Access token verification ───────────────────────────────────────────

  /**
   * Verifies an access JWT and returns the embedded user. Called by the
   * SessionAuthGuard. Throws UnauthorizedException for any failure.
   */
  verifyAccessToken(token: string): AuthenticatedUser {
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // The payload mirrors AuthenticatedUser at issue time. Email/name/picture
    // can be stale (up to one access-token TTL); that's accepted since the
    // window is short and a refresh will pick up the latest values.
    return {
      id: payload.sub,
      googleSub: payload.googleSub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Verifies a Google ID token (signature + audience + email_verified) and
   * upserts the local User. Pulled out of the public surface because we
   * always want callers to go through `exchangeGoogleIdToken`, which issues
   * a session in the same step.
   */
  private async verifyAndUpsert(idToken: string): Promise<AuthenticatedUser> {
    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn({ err }, 'Google ID token verification failed');
      throw new UnauthorizedException('Invalid token');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Google's `email_verified` claim — refuse unverified accounts so a
    // hostile actor can't hijack an email they don't actually own.
    if (payload.email_verified === false) {
      throw new UnauthorizedException('Email not verified by Google');
    }

    const user = await this.prisma.user.upsert({
      where: { googleSub: payload.sub },
      create: {
        googleSub: payload.sub,
        email: payload.email,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      },
      update: {
        email: payload.email,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      },
    });

    return {
      id: user.id,
      googleSub: user.googleSub,
      email: user.email,
      name: user.name,
      picture: user.picture,
    };
  }

  /**
   * Mints a fresh (access, refresh) pair for the given user and persists the
   * refresh-token record.
   */
  private async issueSession(
    user: AuthenticatedUser,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<IssuedSession> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      googleSub: user.googleSub,
      email: user.email,
      name: user.name,
      picture: user.picture,
    };
    const accessToken = this.jwt.sign(accessPayload, { expiresIn: this.accessTtlSec });

    // 32 random bytes = 256 bits of entropy — well above the 128-bit floor
    // recommended for opaque session tokens.
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshTtlSec * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      },
    });

    return {
      accessToken,
      accessTokenMaxAgeSec: this.accessTtlSec,
      refreshToken,
      refreshTokenMaxAgeSec: this.refreshTtlSec,
      user,
    };
  }
}

/**
 * Hashes a raw refresh-token secret for storage and lookup. SHA-256 with a
 * fixed hex encoding so lookups are stable across processes.
 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
