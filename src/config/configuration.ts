export type AppConfig = {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  databaseUrl: string;
  databaseSsl: boolean;
  databasePoolMax: number;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessTtl: string;
  jwtRefreshTtl: string;
  adminPhone?: string;
  adminPassword?: string;
  /** @deprecated Use users.is_admin as source of truth. */
  adminPhones: string[];
  otpSigningSecret: string;
  otpProvider: 'console' | 'twilio';
  otpTtlMinutes: number;
  otpDevMode: boolean;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  twilioMessagingServiceSid?: string;
  storageProvider: 'cloudinary';
  storageBucket: string;
  storagePublicBaseUrl: string;
  storageUploadTtlSeconds: number;
  storageSigningSecret: string;
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  throttleTtl: number;
  throttleLimit: number;
  logLevel: string;
  redisUrl?: string;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = parseNumber(value, fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default (): AppConfig => {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const storageSigningSecret = process.env.STORAGE_SIGNING_SECRET;
  const otpSigningSecret = process.env.OTP_SIGNING_SECRET;
  const otpProvider = (process.env.OTP_PROVIDER ?? 'console').toLowerCase();
  const storageProvider = (process.env.STORAGE_PROVIDER ?? 'cloudinary').toLowerCase();
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;
  const twilioMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
  const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!jwtAccessSecret) throw new Error('JWT_ACCESS_SECRET is required');
  if (!jwtRefreshSecret) throw new Error('JWT_REFRESH_SECRET is required');
  if (!storageSigningSecret) throw new Error('STORAGE_SIGNING_SECRET is required');
  if (!otpSigningSecret) throw new Error('OTP_SIGNING_SECRET is required');
  if (otpProvider !== 'console' && otpProvider !== 'twilio') {
    throw new Error('OTP_PROVIDER must be either "console" or "twilio"');
  }
  if (storageProvider !== 'cloudinary') {
    throw new Error('STORAGE_PROVIDER currently supports only "cloudinary"');
  }

  if (otpProvider === 'twilio') {
    if (!twilioAccountSid) throw new Error('TWILIO_ACCOUNT_SID is required when OTP_PROVIDER=twilio');
    if (!twilioAuthToken) throw new Error('TWILIO_AUTH_TOKEN is required when OTP_PROVIDER=twilio');

    const hasFromNumber = Boolean(twilioFromNumber);
    const hasMessagingServiceSid = Boolean(twilioMessagingServiceSid);
    if (hasFromNumber === hasMessagingServiceSid) {
      throw new Error(
        'Set exactly one of TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID when OTP_PROVIDER=twilio',
      );
    }
  }

  if (!cloudinaryCloudName) {
    throw new Error('CLOUDINARY_CLOUD_NAME is required when STORAGE_PROVIDER=cloudinary');
  }
  if (!cloudinaryApiKey) {
    throw new Error('CLOUDINARY_API_KEY is required when STORAGE_PROVIDER=cloudinary');
  }
  if (!cloudinaryApiSecret) {
    throw new Error('CLOUDINARY_API_SECRET is required when STORAGE_PROVIDER=cloudinary');
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseNumber(process.env.PORT, 3000),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseUrl,
    databaseSsl: parseBoolean(process.env.DATABASE_SSL, false),
    databasePoolMax: parsePositiveInteger(process.env.DATABASE_POOL_MAX, 20),
    jwtAccessSecret,
    jwtRefreshSecret,
    jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    adminPhone: process.env.ADMIN_PHONE,
    adminPassword: process.env.ADMIN_PASSWORD,
    otpSigningSecret,
    adminPhones: (process.env.ADMIN_PHONES ?? '')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean),
    otpProvider,
    otpTtlMinutes: parseNumber(process.env.OTP_TTL_MINUTES, 10),
    otpDevMode: parseBoolean(process.env.OTP_DEV_MODE, false),
    twilioAccountSid,
    twilioAuthToken,
    twilioFromNumber,
    twilioMessagingServiceSid,
    storageProvider,
    storageBucket: process.env.STORAGE_BUCKET ?? 'market-media',
    storagePublicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? 'https://cdn.example.com',
    storageUploadTtlSeconds: parsePositiveInteger(process.env.STORAGE_UPLOAD_TTL_SECONDS, 600),
    storageSigningSecret,
    cloudinaryCloudName,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    throttleTtl: parseNumber(process.env.THROTTLE_TTL, 60_000),
    throttleLimit: parseNumber(process.env.THROTTLE_LIMIT, 120),
    logLevel: process.env.LOG_LEVEL ?? 'log',
    redisUrl: process.env.REDIS_URL,
  };
};
