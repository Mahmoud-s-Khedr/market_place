import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PublicUsersController } from './public-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [FilesModule],
  controllers: [UsersController, PublicUsersController],
  providers: [UsersService],
})
export class UsersModule {}
