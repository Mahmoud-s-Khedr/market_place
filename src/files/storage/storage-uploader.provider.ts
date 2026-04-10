import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { CloudinaryStorageUploaderService } from './cloudinary-storage-uploader.service';
import { STORAGE_UPLOADER, StorageUploader } from './storage-uploader.interface';

export function resolveStorageUploader(
  appConfig: AppConfig,
  cloudinaryUploader: StorageUploader,
): StorageUploader {
  if (appConfig.storageProvider === 'cloudinary') {
    return cloudinaryUploader;
  }

  throw new Error(`Unsupported storage provider: ${appConfig.storageProvider}`);
}

export const storageUploaderProvider: Provider = {
  provide: STORAGE_UPLOADER,
  inject: [ConfigService, CloudinaryStorageUploaderService],
  useFactory: (
    configService: ConfigService<{ app: AppConfig }, true>,
    cloudinaryStorageUploader: CloudinaryStorageUploaderService,
  ) => {
    const appConfig = configService.get('app', { infer: true });
    return resolveStorageUploader(appConfig, cloudinaryStorageUploader);
  },
};
