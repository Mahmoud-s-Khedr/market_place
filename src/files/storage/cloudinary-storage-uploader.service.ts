import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AppConfig } from '../../config/configuration';
import { StorageUploader, UploadIntent } from './storage-uploader.interface';

@Injectable()
export class CloudinaryStorageUploaderService implements StorageUploader {
  constructor(private readonly configService: ConfigService<{ app: AppConfig }, true>) {}

  async createUploadIntent(params: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<UploadIntent> {
    const appConfig = this.configService.get('app', { infer: true });
    const expiresInSeconds = Math.max(1, params.expiresInSeconds);
    const timestampSeconds = Math.floor(this.now() / 1000);
    const timestamp = String(timestampSeconds);
    const signedParams = {
      public_id: params.objectKey,
      timestamp,
    };
    const signature = this.signParams(signedParams, appConfig.cloudinaryApiSecret);

    return {
      method: 'POST',
      url: `https://api.cloudinary.com/v1_1/${appConfig.cloudinaryCloudName}/auto/upload`,
      fields: {
        api_key: appConfig.cloudinaryApiKey,
        public_id: params.objectKey,
        timestamp,
        signature,
      },
      expiresAt: new Date((timestampSeconds + expiresInSeconds) * 1000).toISOString(),
    };
  }

  protected now(): number {
    return Date.now();
  }

  protected signParams(params: Record<string, string>, apiSecret: string): string {
    const payload = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
  }
}
