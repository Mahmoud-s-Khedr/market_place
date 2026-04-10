export type UploadIntent = {
  method: 'PUT' | 'POST';
  url: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  expiresAt: string;
};

export interface StorageUploader {
  createUploadIntent(params: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<UploadIntent>;
}

export const STORAGE_UPLOADER = Symbol('STORAGE_UPLOADER');
