export type AppLogLevel = 'error' | 'warn' | 'log' | 'debug' | 'verbose';

export type AppLogRecord = {
  timestamp: string;
  level: AppLogLevel;
  service: string;
  env: string;
  correlationId?: string;
  requestId?: string;
  protocol: 'http' | 'ws' | 'system';
  routeOrEvent: string;
  userId?: number | null;
  statusCode?: number;
  durationMs?: number;
  message: string;
  meta?: Record<string, unknown>;
};

