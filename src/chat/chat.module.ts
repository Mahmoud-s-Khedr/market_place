import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppLogger } from '../common/logging/app-logger.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatWsExceptionFilter } from './chat-ws-exception.filter';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatWsExceptionFilter, AppLogger],
})
export class ChatModule {}
