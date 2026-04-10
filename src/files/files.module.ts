import { Module } from '@nestjs/common';
import { FileReadUrlService } from './file-read-url.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { CloudinaryStorageUploaderService } from './storage/cloudinary-storage-uploader.service';
import { storageUploaderProvider } from './storage/storage-uploader.provider';

@Module({
  controllers: [FilesController],
  providers: [FilesService, FileReadUrlService, CloudinaryStorageUploaderService, storageUploaderProvider],
  exports: [FilesService, FileReadUrlService],
})
export class FilesModule {}
