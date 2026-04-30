import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requestContext } from '../context/request-context';
import { AppConfig } from '../../config/configuration';
import { AppLogLevel, AppLogRecord } from './logging.types';
import { sanitizeForLog } from './logging.utils';

type AppLogInput = Omit<AppLogRecord, 'timestamp' | 'level' | 'env' | 'requestId'> & {
  requestId?: string;
};

@Injectable()
export class AppLogger {
  private readonly logger = new Logger('App');

  constructor(
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
  ) {}

  log(input: AppLogInput): void {
    this.write('log', input);
  }

  warn(input: AppLogInput): void {
    this.write('warn', input);
  }

  error(input: AppLogInput): void {
    this.write('error', input);
  }

  debug(input: AppLogInput): void {
    this.write('debug', input);
  }

  private write(level: AppLogLevel, input: AppLogInput): void {
    const appConfig = this.configService.get('app', { infer: true });
    const env = appConfig.nodeEnv;
    if (!isLevelEnabled(level, appConfig.logLevel)) {
      return;
    }
    const requestId = input.requestId ?? requestContext.getStore()?.requestId;
    const payload: AppLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      env,
      requestId,
      ...input,
      meta: input.meta ? (sanitizeForLog(input.meta) as Record<string, unknown>) : undefined,
    };
    const line = appConfig.logPretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
    if (level === 'error') {
      this.logger.error(line);
      return;
    }
    if (level === 'warn') {
      this.logger.warn(line);
      return;
    }
    if (level === 'debug' || level === 'verbose') {
      this.logger.debug(line);
      return;
    }
    this.logger.log(line);
  }
}

function isLevelEnabled(level: AppLogLevel, configured: string): boolean {
  const order: AppLogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const configuredLevel = (order.includes(configured as AppLogLevel) ? configured : 'log') as AppLogLevel;
  return order.indexOf(level) <= order.indexOf(configuredLevel);
}
