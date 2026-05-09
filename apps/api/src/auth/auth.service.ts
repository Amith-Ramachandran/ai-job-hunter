/**
 * Verifies Google ID tokens and resolves them into our local User record.
 *
 * The frontend handles the OAuth dance — it sends the ID token (a signed JWT)
 * in the Authorization header. We verify the signature against Google's public
 * keys, validate the audience claim matches our client ID, and then upsert a
 * local User row keyed on the Google `sub` (Google's stable user identifier).
 *
 * Why upsert: first time a user signs in, no row exists; subsequent sign-ins
 * may have updated email/name/picture from Google.
 */
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Env } from '../common/config/env.schema';
import type { AuthenticatedUser } from './types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.googleClientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    // OAuth2Client without a client secret is fine — we only verify ID tokens
    // here, never exchange auth codes.
    this.googleClient = new OAuth2Client(this.googleClientId);
  }

  /**
   * Verifies an ID token and upserts the corresponding User.
   * Throws UnauthorizedException for any failure mode (invalid signature,
   * wrong audience, missing email, etc.) — never leak which check failed.
   */
  async verifyAndUpsert(idToken: string): Promise<AuthenticatedUser> {
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
}
