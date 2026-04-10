import configuration from './configuration';

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
  });

  it('requires twilio credentials when otp provider is twilio', () => {
    process.env.OTP_PROVIDER = 'twilio';
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;

    expect(() => configuration()).toThrow('TWILIO_ACCOUNT_SID is required when OTP_PROVIDER=twilio');
  });

  it('requires exactly one twilio sender identifier when otp provider is twilio', () => {
    process.env.OTP_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15550001111';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG123';

    expect(() => configuration()).toThrow(
      'Set exactly one of TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID when OTP_PROVIDER=twilio',
    );
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
