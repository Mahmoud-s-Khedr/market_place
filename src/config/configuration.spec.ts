import configuration, { DEFAULT_DEV_CORS_ORIGINS } from './configuration';

const ORIGINAL_ENV = process.env;

function setBaseEnv(): void {
  process.env = {
    ...ORIGINAL_ENV,
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/test',
    JWT_ACCESS_SECRET: 'access',
    JWT_REFRESH_SECRET: 'refresh',
    STORAGE_SIGNING_SECRET: 'signing-secret',
    OTP_SIGNING_SECRET: 'otp-secret',
    STORAGE_PROVIDER: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: '123456789012345',
    CLOUDINARY_API_SECRET: 'cloudinary-secret',
    OTP_PROVIDER: 'console',
  };
}

describe('configuration', () => {
  beforeEach(() => {
    setBaseEnv();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('loads defaults for console OTP and Cloudinary', () => {
    const config = configuration();

    expect(config.otpProvider).toBe('console');
    expect(config.storageProvider).toBe('cloudinary');
    expect(config.storageUploadTtlSeconds).toBe(600);
    expect(config.cloudinaryCloudName).toBe('demo-cloud');
    expect(config.logPretty).toBe(false);
    expect(config.logHttpBody).toBe(false);
    expect(config.logWsPayload).toBe(false);
    expect(config.corsOrigins).toEqual([...DEFAULT_DEV_CORS_ORIGINS]);
    expect(config.corsAllowAnyOrigin).toBe(false);
    expect(config.corsCredentials).toBe(true);
  });

  it('defaults to the local dev allowlist when CORS_ORIGINS is unset outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGINS;

    const config = configuration();

    expect(config.corsOrigins).toEqual([...DEFAULT_DEV_CORS_ORIGINS]);
    expect(config.corsAllowAnyOrigin).toBe(false);
    expect(config.corsCredentials).toBe(true);
  });

  it('requires CORS_ORIGINS in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    expect(() => configuration()).toThrow('CORS_ORIGINS is required in production');
  });

  it('parses wildcard CORS mode in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGINS = '*';

    const config = configuration();

    expect(config.corsOrigins).toEqual(['*']);
    expect(config.corsAllowAnyOrigin).toBe(true);
    expect(config.corsCredentials).toBe(false);
  });

  it('parses allowlist CORS mode', () => {
    process.env.CORS_ORIGINS = 'https://a.example, https://b.example';

    const config = configuration();

    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(config.corsAllowAnyOrigin).toBe(false);
    expect(config.corsCredentials).toBe(true);
  });

  it('rejects mixed wildcard and explicit origins', () => {
    process.env.CORS_ORIGINS = '*,https://a.example';

    expect(() => configuration()).toThrow('CORS_ORIGINS cannot mix "*" with specific origins');
  });

  it('rejects origins with trailing slash', () => {
    process.env.CORS_ORIGINS = 'https://a.example/';

    expect(() => configuration()).toThrow('CORS_ORIGINS contains invalid origin(s): https://a.example/');
  });

  it('rejects protocol-less origins', () => {
    process.env.CORS_ORIGINS = 'a.example';

    expect(() => configuration()).toThrow('CORS_ORIGINS contains invalid origin(s): a.example');
  });

  it('rejects invalid production origins', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://good.example, bad-origin';

    expect(() => configuration()).toThrow(
      'CORS_ORIGINS contains invalid origin(s): bad-origin',
    );
  });

  it('rejects wildcard CORS mode in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = '*';

    expect(() => configuration()).toThrow('CORS_ORIGINS wildcard "*" is not allowed in production');
  });

  it('requires akedly credentials when otp provider is akedly', () => {
    process.env.OTP_PROVIDER = 'akedly';
    delete process.env.AKEDLY_API_KEY;
    delete process.env.AKEDLY_PIPELINE_ID;

    expect(() => configuration()).toThrow('AKEDLY_API_KEY is required when OTP_PROVIDER=akedly');
  });

  it('requires akedly pipeline id when otp provider is akedly', () => {
    process.env.OTP_PROVIDER = 'akedly';
    process.env.AKEDLY_API_KEY = 'key';
    delete process.env.AKEDLY_PIPELINE_ID;

    expect(() => configuration()).toThrow('AKEDLY_PIPELINE_ID is required when OTP_PROVIDER=akedly');
  });

  it('requires cloudinary settings', () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;

    expect(() => configuration()).toThrow('CLOUDINARY_CLOUD_NAME is required when STORAGE_PROVIDER=cloudinary');
  });

  it('rejects unsupported storage providers', () => {
    process.env.STORAGE_PROVIDER = 'r2';

    expect(() => configuration()).toThrow('STORAGE_PROVIDER currently supports only "cloudinary"');
  });
});
