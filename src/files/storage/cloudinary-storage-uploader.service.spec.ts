import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CloudinaryStorageUploaderService } from './cloudinary-storage-uploader.service';

class TestCloudinaryStorageUploaderService extends CloudinaryStorageUploaderService {
  constructor(configService: ConfigService, private readonly nowMs: number) {
    super(configService as any);
  }

  protected now(): number {
    return this.nowMs;
  }
}

describe('CloudinaryStorageUploaderService', () => {
  it('returns signed direct upload intent metadata', async () => {
    const fixedNowMs = Date.UTC(2030, 0, 1, 0, 0, 0);
    const service = new TestCloudinaryStorageUploaderService(
      {
        get: jest.fn().mockReturnValue({
          cloudinaryCloudName: 'demo-cloud',
          cloudinaryApiKey: '123456789012345',
          cloudinaryApiSecret: 'cloud-secret',
        }),
      } as unknown as ConfigService,
      fixedNowMs,
    );

    const result = await service.createUploadIntent({
      objectKey: 'products/1/a.jpg',
      mimeType: 'image/jpeg',
      expiresInSeconds: 120,
    });

    const timestamp = String(Math.floor(fixedNowMs / 1000));
    const expectedSignature = createHash('sha1')
      .update(`public_id=products/1/a.jpg&timestamp=${timestamp}cloud-secret`)
      .digest('hex');

    expect(result).toMatchObject({
      method: 'POST',
      url: 'https://api.cloudinary.com/v1_1/demo-cloud/auto/upload',
      fields: {
        api_key: '123456789012345',
        public_id: 'products/1/a.jpg',
        timestamp,
        signature: expectedSignature,
      },
    });
    expect(result.expiresAt).toBe(new Date(fixedNowMs + 120_000).toISOString());
  });
});
