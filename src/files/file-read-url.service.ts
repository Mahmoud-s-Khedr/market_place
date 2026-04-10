import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

@Injectable()
export class FileReadUrlService {
  constructor(
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
  ) {}

  buildReadUrl(objectKey: string, mimeType: string): string {
    const resourceType = mimeType.startsWith('image/')
      ? 'image'
      : mimeType.startsWith('video/')
        ? 'video'
        : 'raw';

    const cloudName = this.configService.get('app', { infer: true }).cloudinaryCloudName;
    return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${objectKey}`;
  }
}
