import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [FilesModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
