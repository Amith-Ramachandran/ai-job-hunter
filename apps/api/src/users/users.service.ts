/**
 * UsersService is the canonical place to read/write User rows.
 * Other modules go through here rather than touching Prisma directly so
 * we have a single chokepoint for user-related invariants (eg. soft delete,
 * audit logging) when those become a concern.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
