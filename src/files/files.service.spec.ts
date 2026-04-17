import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';

describe('FilesService', () => {
  it('creates upload intent using storage uploader', async () => {
    const databaseService = {
      query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 44 }] }),
    };

    const configService = {
      get: jest.fn().mockReturnValue({
        storageProvider: 'cloudinary',
        storageBucket: 'market-media',
        storageUploadTtlSeconds: 600,
      }),
    } as unknown as ConfigService;

    const storageUploader = {
      createUploadIntent: jest.fn().mockResolvedValue({
        method: 'POST',
        url: 'https://api.cloudinary.com/v1_1/demo-cloud/auto/upload',
        fields: {
          api_key: '123456789012345',
          timestamp: '1893456000',
          public_id: 'product/9/example',
          signature: 'abc123',
        },
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    };
    const fileReadUrlService = {
      buildReadUrl: jest.fn(),
    };

    const service = new FilesService(
      databaseService as any,
      configService as any,
      fileReadUrlService as any,
      storageUploader as any,
    );

    const result = await service.createUploadIntent(
      { sub: 7, phone: '+201000000007', isAdmin: false },
      {
        ownerType: 'product',
        ownerId: 9,
        purpose: 'product_image',
        filename: 'phone.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1000,
      },
    );

    expect(storageUploader.createUploadIntent).toHaveBeenCalledWith({
      objectKey: expect.stringMatching(/^product\/9\/.+-phone\.jpg$/),
      mimeType: 'image/jpeg',
      expiresInSeconds: 600,
    });
    expect(databaseService.query).toHaveBeenCalledTimes(1);
    const insertParams = (databaseService.query as jest.Mock).mock.calls[0][1];
    expect(insertParams[4]).toBe('cloudinary');
    expect(insertParams[5]).toBeNull();

    expect(result).toMatchObject({
      file: {
        id: 44,
        objectKey: expect.stringMatching(/^product\/9\/.+-phone\.jpg$/),
        status: 'pending',
      },
      upload: {
        method: 'POST',
        url: 'https://api.cloudinary.com/v1_1/demo-cloud/auto/upload',
        fields: {
          api_key: '123456789012345',
          timestamp: '1893456000',
          public_id: 'product/9/example',
          signature: 'abc123',
        },
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    });
  });
});
