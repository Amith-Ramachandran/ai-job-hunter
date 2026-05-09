/**
 * Auth-related HTTP endpoints.
 *
 * /auth/me — returns the authenticated user. Frontend hits this on app load
 * to (a) verify the stored ID token is still valid and (b) get the local
 * user record without parsing the JWT itself.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GoogleAuthGuard } from './google-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Returns the authenticated user.' })
  @UseGuards(GoogleAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
