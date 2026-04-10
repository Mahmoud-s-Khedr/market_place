import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { MarkUploadedDto } from './dto/mark-uploaded.dto';
import { FileMarkUploadedResponseDto, FileResponseDto, UploadIntentResponseDto } from './dto/file-response.dto';
import { FilesService } from './files.service';

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload-intent')
  @ApiOperation({ summary: 'Create a signed upload URL for a file' })
  @ApiResponse({ status: 201, description: 'Upload intent with signed URL', type: UploadIntentResponseDto })
  createUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadIntentDto,
  ): Promise<Record<string, unknown>> {
    return this.filesService.createUploadIntent(user, dto);
  }

  @Patch(':id/mark-uploaded')
  @ApiParam({ name: 'id', type: Number, description: 'File ID' })
  @ApiOperation({ summary: 'Confirm a file has been uploaded to storage' })
  @ApiResponse({ status: 200, description: 'File marked as uploaded', type: FileMarkUploadedResponseDto })
  @ApiResponse({ status: 404, description: 'File not found', type: ErrorResponseDto })
  markUploaded(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Body() dto: MarkUploadedDto,
  ): Promise<Record<string, unknown>> {
    return this.filesService.markUploaded(user, fileId, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: Number, description: 'File ID' })
  @ApiOperation({ summary: 'Get file metadata and signed download URL' })
  @ApiResponse({ status: 200, description: 'File record with signed URL', type: FileResponseDto })
  @ApiResponse({ status: 404, description: 'File not found', type: ErrorResponseDto })
  getFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) fileId: number,
  ): Promise<Record<string, unknown>> {
    return this.filesService.getFile(user, fileId);
  }
}
