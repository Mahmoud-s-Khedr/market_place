import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [CategoriesModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
