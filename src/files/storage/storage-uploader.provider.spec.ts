import { resolveStorageUploader } from './storage-uploader.provider';

describe('resolveStorageUploader', () => {
  it('returns cloudinary uploader when provider is cloudinary', () => {
    const cloudinaryUploader = { createUploadIntent: jest.fn() };

    const uploader = resolveStorageUploader(
      { storageProvider: 'cloudinary' } as any,
      cloudinaryUploader as any,
    );

    expect(uploader).toBe(cloudinaryUploader);
  });

  it('throws when provider is unsupported', () => {
    const cloudinaryUploader = { createUploadIntent: jest.fn() };

    expect(() =>
      resolveStorageUploader({ storageProvider: 'unknown' } as any, cloudinaryUploader as any),
    ).toThrow('Unsupported storage provider: unknown');
  });
});
