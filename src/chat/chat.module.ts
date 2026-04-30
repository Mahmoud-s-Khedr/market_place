import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FkExpansionService } from '../common/relations/fk-expansion.service';
import { AppLogger } from '../common/logging/app-logger.service';
import { DatabaseModule } from '../database/database.module';
import { FilesModule } from '../files/files.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatWsExceptionFilter } from './chat-ws-exception.filter';

@Module({
  imports: [JwtModule.register({}), DatabaseModule, FilesModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatWsExceptionFilter, AppLogger, FkExpansionService],
})
export class ChatModule {}
