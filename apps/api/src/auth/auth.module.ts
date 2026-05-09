import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleAuthGuard } from './google-auth.guard';

/**
 * Auth module exports AuthService and the guard so other modules
 * (cvs, jobs, applications) can apply @UseGuards(GoogleAuthGuard) without
 * pulling in providers manually.
 */
@Module({
  providers: [AuthService, GoogleAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, GoogleAuthGuard],
})
export class AuthModule {}
