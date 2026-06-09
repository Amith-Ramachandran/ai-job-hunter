/**
 * Auth module — provides AuthService and SessionAuthGuard so other modules
 * (cvs, jobs, applications) can apply @UseGuards(SessionAuthGuard) without
 * pulling in providers manually.
 *
 * JwtModule is registered async so the secret + access TTL come from the
 * validated config rather than process.env directly. The secret is the only
 * mandatory env var here; without it the app refuses to boot.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionAuthGuard } from './session-auth.guard';
import type { Env } from '../common/config/env.schema';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        // Default expiry; AuthService passes per-token expiresIn explicitly
        // so this is just a safety net.
        signOptions: {
          expiresIn: `${config.get('JWT_ACCESS_TTL_MIN', { infer: true })}m`,
        },
      }),
    }),
  ],
  providers: [AuthService, SessionAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
