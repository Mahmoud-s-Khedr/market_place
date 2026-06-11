import { AppConfig } from '../../config/configuration';

export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export type CorsPolicy = Pick<AppConfig, 'corsOrigins' | 'corsAllowAnyOrigin' | 'corsCredentials'>;

export type CorsRuntimePolicy = CorsPolicy & {
  methods: readonly string[];
};

export type HttpCorsOptions = {
  origin: true | string[];
  credentials: boolean;
  methods: readonly string[];
};

export type SocketCorsOptions = Pick<HttpCorsOptions, 'origin' | 'credentials'>;

export function buildCorsRuntimePolicy(config: CorsPolicy): CorsRuntimePolicy {
  return {
    corsOrigins: config.corsOrigins,
    corsAllowAnyOrigin: config.corsAllowAnyOrigin,
    corsCredentials: config.corsCredentials,
    methods: CORS_METHODS,
  };
}

export function buildHttpCorsOptions(policy: CorsRuntimePolicy): HttpCorsOptions {
  return {
    origin: policy.corsAllowAnyOrigin ? true : policy.corsOrigins,
    credentials: policy.corsCredentials,
    methods: policy.methods,
  };
}

export function buildSocketCorsOptions(policy: CorsPolicy): SocketCorsOptions {
  return {
    origin: policy.corsAllowAnyOrigin ? true : policy.corsOrigins,
    credentials: policy.corsCredentials,
  };
}
