import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatWsExceptionFilter } from './chat-ws-exception.filter';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatWsExceptionFilter],
})
export class ChatModule {}
