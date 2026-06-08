import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(SessionAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    // Re-fetch full record (including timestamps) — `user` from the guard
    // only carries identity-related fields.
    return this.users.findById(user.id);
  }
}
