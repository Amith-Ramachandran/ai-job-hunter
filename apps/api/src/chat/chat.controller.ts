/**
 * Chat HTTP surface for the authenticated user.
 *
 *   POST   /chat/stream            — SSE: send a turn, stream the reply
 *   POST   /chat/cover-letter      — SSE: stream a cover-letter draft for one job
 *   GET    /chat/sessions          — list sidebar entries
 *   GET    /chat/sessions/:id      — full message history for one session
 *   DELETE /chat/sessions/:id      — remove a session
 *
 * All routes require the cookie session via SessionAuthGuard.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ChatService } from './chat.service';

class ChatStreamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

class CoverLetterDto {
  @IsString()
  jobId!: string;
}

@ApiTags('chat')
@UseGuards(SessionAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // ─── Streaming endpoints ───────────────────────────────────────────────

  @Post('stream')
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChatStreamDto,
    @Res() res: Response,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      for await (const event of this.chat.startTurn({
        userId: user.id,
        sessionId: body.sessionId,
        content: body.content,
      })) {
        res.write(formatSseLine(event));
      }
    } catch (err) {
      res.write(
        formatSseLine({
          type: 'error',
          message: (err as Error).message?.slice(0, 200) ?? 'unknown',
        }),
      );
    } finally {
      res.end();
    }
  }

  @Post('cover-letter')
  async coverLetter(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CoverLetterDto,
    @Res() res: Response,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      for await (const event of this.chat.streamCoverLetter(user.id, body.jobId)) {
        res.write(formatSseLine(event));
      }
    } catch (err) {
      res.write(
        formatSseLine({
          type: 'error',
          message: (err as Error).message?.slice(0, 200) ?? 'unknown',
        }),
      );
    } finally {
      res.end();
    }
  }

  // ─── Sidebar / history ─────────────────────────────────────────────────

  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.listSessions(user.id);
  }

  @Get('sessions/:id')
  async session(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const session = await this.chat.getSession(user.id, id);
    if (!session) throw new NotFoundException('Chat session not found');
    return session;
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.chat.deleteSession(user.id, id);
  }
}

function writeSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Disable Nginx/Express buffering so chunks flush immediately.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function formatSseLine(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
