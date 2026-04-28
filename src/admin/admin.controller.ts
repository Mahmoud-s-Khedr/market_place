import {
  Delete,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CategoriesService } from '../categories/categories.service';
import { AdminService } from './admin.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateWarningDto } from './dto/create-warning.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import {
  AdminReportResponseDto,
  AdminReportsListResponseDto,
  AdminAdminsListResponseDto,
  AdminUserResponseDto,
  AdminUsersListResponseDto,
  WarningResponseDto,
} from './dto/admin-response.dto';
import { CategoryResponseDto } from '../categories/dto/category-response.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly categoriesService: CategoriesService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users with optional filters (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated user list', type: AdminUsersListResponseDto })
  @ApiResponse({ status: 403, description: 'Admin access required', type: ErrorResponseDto })
  listUsers(@Query() query: ListUsersQueryDto): Promise<Record<string, unknown>> {
    return this.adminService.listUsers(query);
  }

  @Get('admins')
  @ApiOperation({ summary: 'List all admins (admin only)' })
  @ApiResponse({ status: 200, description: 'Array of admin users', type: AdminAdminsListResponseDto })
  listAdmins(): Promise<Record<string, unknown>> {
    return this.adminService.listAdmins();
  }

  @Post('admins/:id')
  @ApiParam({ name: 'id', type: Number, description: 'User ID to promote to admin' })
  @ApiOperation({ summary: 'Promote a user to admin (admin only)' })
  @ApiResponse({ status: 200, description: 'User promoted to admin', type: AdminUserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found', type: ErrorResponseDto })
  promoteAdmin(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseIntPipe) userId: number,
  ): Promise<Record<string, unknown>> {
    return this.adminService.promoteAdmin(admin, userId);
  }

  @Delete('admins/:id')
  @ApiParam({ name: 'id', type: Number, description: 'Admin user ID to demote' })
  @ApiOperation({ summary: 'Demote an admin to regular user (admin only)' })
  @ApiResponse({ status: 200, description: 'Admin demoted', type: AdminUserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found', type: ErrorResponseDto })
  demoteAdmin(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseIntPipe) userId: number,
  ): Promise<Record<string, unknown>> {
    return this.adminService.demoteAdmin(admin, userId);
  }

  @Patch('users/:id/status')
  @ApiParam({ name: 'id', type: Number, description: 'User ID' })
  @ApiOperation({ summary: 'Update a user\'s status (admin only)' })
  @ApiResponse({ status: 200, description: 'User status updated', type: AdminUserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found', type: ErrorResponseDto })
  updateUserStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.adminService.updateUserStatus(admin, userId, dto);
  }

  @Post('warnings')
  @ApiOperation({ summary: 'Issue a warning to a user (admin only)' })
  @ApiResponse({ status: 201, description: 'Warning created', type: WarningResponseDto })
  @ApiResponse({ status: 404, description: 'Target user not found', type: ErrorResponseDto })
  createWarning(
    @CurrentUser() admin: AuthUser,
    @Body() dto: CreateWarningDto,
  ): Promise<Record<string, unknown>> {
    return this.adminService.createWarning(admin, dto);
  }

  @Get('reports')
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'reviewing', 'resolved', 'rejected'],
    description: 'Filter reports by status',
  })
  @ApiOperation({ summary: 'List user abuse reports (admin only)' })
  @ApiResponse({ status: 200, description: 'Array of report records', type: AdminReportsListResponseDto })
  listReports(
    @Query('status') status?: 'open' | 'reviewing' | 'resolved' | 'rejected',
  ): Promise<Record<string, unknown>> {
    return this.adminService.listReports(status);
  }

  @Patch('reports/:id')
  @ApiParam({ name: 'id', type: Number, description: 'Report ID' })
  @ApiOperation({ summary: 'Update the status of an abuse report (admin only)' })
  @ApiResponse({ status: 200, description: 'Report status updated', type: AdminReportResponseDto })
  @ApiResponse({ status: 404, description: 'Report not found', type: ErrorResponseDto })
  updateReportStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseIntPipe) reportId: number,
    @Body() dto: UpdateReportStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.adminService.updateReportStatus(admin, reportId, dto);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a category (admin only)' })
  @ApiResponse({ status: 201, description: 'Category created', type: CategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Parent category not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Duplicate category name', type: ErrorResponseDto })
  createCategory(
    @CurrentUser() admin: AuthUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<Record<string, unknown>> {
    return this.adminService.createCategory(admin, dto);
  }

  @Delete('categories/:id')
  @ApiParam({ name: 'id', type: Number, description: 'Category ID' })
  @ApiOperation({ summary: 'Delete a category (admin only)' })
  @ApiResponse({ status: 200, description: 'Category deleted', type: CategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Category not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Category has children or referenced products', type: ErrorResponseDto })
  deleteCategory(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseIntPipe) categoryId: number,
  ): Promise<Record<string, unknown>> {
    return this.adminService.deleteCategory(admin, categoryId);
  }
}
