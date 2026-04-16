import { Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { SuccessResponseDto } from '../users/dto/user-response.dto';
import { BlocksService } from './blocks.service';

@ApiTags('Blocks')
@ApiBearerAuth()
@Controller('blocks')
@UseGuards(JwtAuthGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Post(':userId')
  @ApiParam({ name: 'userId', type: Number, description: 'Target user ID' })
  @ApiOperation({ summary: 'Block a user' })
  @ApiResponse({ status: 201, description: 'User blocked', type: SuccessResponseDto })
  blockUser(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Record<string, unknown>> {
    return this.blocksService.blockUser(user, userId);
  }

  @Delete(':userId')
  @ApiParam({ name: 'userId', type: Number, description: 'Target user ID' })
  @ApiOperation({ summary: 'Unblock a user' })
  @ApiResponse({ status: 200, description: 'User unblocked', type: SuccessResponseDto })
  unblockUser(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Record<string, unknown>> {
    return this.blocksService.unblockUser(user, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List blocked users for current user' })
  listBlockedUsers(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.blocksService.listBlockedUsers(user);
  }
}
