/**
 * Chat module (Slice 2.3).
 *
 * Currently a stub — wires nothing. The next commit fills in:
 *   - chat.controller.ts: POST /chat SSE proxy, sessions CRUD, internal callbacks
 *   - chat.service.ts: forwards to Python with INTERNAL_SERVICE_TOKEN,
 *     streams events through, writes user + assistant + tool messages
 *   - DTOs for chat send + session list
 *
 * Stubbing now keeps `AppModule` importing it cleanly so the Slice 2.3
 * foundation (internal auth, chat schema, migration) can ship as its own
 * reviewable commit.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [],
  controllers: [],
  exports: [],
})
export class ChatModule {}
