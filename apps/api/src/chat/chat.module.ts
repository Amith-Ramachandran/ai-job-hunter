/**
 * Chat module (Slice 2.3).
 *
 * Wires:
 *   - ChatController: SSE turn endpoint + cover-letter endpoint + sessions CRUD
 *   - ChatService: forwards to Python with the internal bearer, writes
 *     user + assistant messages, computes per-message cost from token usage
 *
 * AuthModule is imported so SessionAuthGuard is available on every route.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [],
})
export class ChatModule {}
