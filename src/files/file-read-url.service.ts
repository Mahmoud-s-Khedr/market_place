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
    const format = this.resolveFormat(mimeType);
    const publicIdWithOptionalFormat = format ? `${objectKey}.${format}` : objectKey;

    const cloudName = this.configService.get('app', { infer: true }).cloudinaryCloudName;
    return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${publicIdWithOptionalFormat}`;
  }

  private resolveFormat(mimeType: string): string | null {
    if (!mimeType || (!mimeType.startsWith('image/') && !mimeType.startsWith('video/'))) {
      return null;
    }

    const subtype = mimeType.split('/')[1]?.split('+')[0]?.toLowerCase();
    if (!subtype) return null;
    if (subtype === 'jpeg') return 'jpg';

    return subtype;
  }
}
