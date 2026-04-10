import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ContactResponseDto,
  ContactsListResponseDto,
  SuccessResponseDto,
  UserProfileResponseDto,
} from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile', type: UserProfileResponseDto })
  getMe(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.usersService.getMe(user);
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated', type: UserProfileResponseDto })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<Record<string, unknown>> {
    return this.usersService.updateMe(user, dto);
  }

  @Patch('password')
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 200, description: 'Password changed', type: SuccessResponseDto })
  @ApiResponse({ status: 401, description: 'Current password incorrect', type: ErrorResponseDto })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<Record<string, unknown>> {
    return this.usersService.changePassword(user, dto);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'List current user\'s contacts' })
  @ApiResponse({ status: 200, description: 'Array of contact records', type: ContactsListResponseDto })
  listContacts(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.usersService.listContacts(user);
  }

  @Post('contacts')
  @ApiOperation({ summary: 'Add a contact to current user\'s profile' })
  @ApiResponse({ status: 201, description: 'Contact created', type: ContactResponseDto })
  createContact(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateContactDto,
  ): Promise<Record<string, unknown>> {
    return this.usersService.createContact(user, dto);
  }

  @Patch('contacts/:id')
  @ApiParam({ name: 'id', type: Number, description: 'Contact ID' })
  @ApiOperation({ summary: 'Update a contact' })
  @ApiResponse({ status: 200, description: 'Contact updated', type: ContactResponseDto })
  @ApiResponse({ status: 404, description: 'Contact not found', type: ErrorResponseDto })
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) contactId: number,
    @Body() dto: UpdateContactDto,
  ): Promise<Record<string, unknown>> {
    return this.usersService.updateContact(user, contactId, dto);
  }

  @Delete('contacts/:id')
  @ApiParam({ name: 'id', type: Number, description: 'Contact ID' })
  @ApiOperation({ summary: 'Delete a contact' })
  @ApiResponse({ status: 200, description: 'Contact deleted', type: SuccessResponseDto })
  @ApiResponse({ status: 404, description: 'Contact not found', type: ErrorResponseDto })
  deleteContact(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) contactId: number,
  ): Promise<Record<string, unknown>> {
    return this.usersService.deleteContact(user, contactId);
  }
}
