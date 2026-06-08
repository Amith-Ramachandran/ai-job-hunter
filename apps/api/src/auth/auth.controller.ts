/**
 * Auth-related HTTP endpoints.
 *
 *   POST /auth/google   — exchange a Google ID token for a session. Sets
 *                         dhruva_at and dhruva_rt cookies. Returns the user.
 *   POST /auth/refresh  — rotates the refresh-token pair. Same cookie set.
 *   POST /auth/logout   — revokes the presented refresh token and clears
 *                         cookies.
 *   GET  /auth/me       — returns the authenticated user. Frontend hits this
 *                         on app load to verify the cookie session is alive.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { SessionAuthGuard } from './session-auth.guard';
import { REFRESH_COOKIE, clearSessionCookies, readCookie, setSessionCookies } from './cookies';
import type { AuthenticatedUser, IssuedSession } from './types';
import type { Env } from '../common/config/env.schema';

class GoogleExchangeDto {
  @IsString()
  @MinLength(10)
  idToken!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @ApiOkResponse({ description: 'Exchanges a Google ID token for a session cookie pair.' })
  @HttpCode(HttpStatus.OK)
  @Post('google')
  async google(
    @Body() body: GoogleExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUser> {
    const issued = await this.authService.exchangeGoogleIdToken(body.idToken, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    this.writeCookies(res, issued);
    return issued.user;
  }

  @ApiOkResponse({ description: 'Rotates the session cookie pair.' })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUser> {
    const raw = readCookie(req, REFRESH_COOKIE);
    if (!raw) {
      // Missing refresh cookie is "no session" — same UX as a stale session.
      throw new UnauthorizedException('No refresh token');
    }
    const issued = await this.authService.rotateRefresh(raw, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    this.writeCookies(res, issued);
    return issued.user;
  }

  @ApiOkResponse({ description: 'Clears the session and revokes the refresh token.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.authService.revokeRefresh(readCookie(req, REFRESH_COOKIE));
    clearSessionCookies(res, this.isProd());
  }

  @ApiOkResponse({ description: 'Returns the authenticated user.' })
  @UseGuards(SessionAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private writeCookies(res: Response, issued: IssuedSession): void {
    setSessionCookies({
      res,
      accessToken: issued.accessToken,
      accessMaxAgeSec: issued.accessTokenMaxAgeSec,
      refreshToken: issued.refreshToken,
      refreshMaxAgeSec: issued.refreshTokenMaxAgeSec,
      isProd: this.isProd(),
    });
  }

  private isProd(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
}
