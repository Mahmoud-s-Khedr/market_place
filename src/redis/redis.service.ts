import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private enabled = false;

  constructor(private readonly configService: ConfigService<{ app: AppConfig }, true>) {}

  onModuleInit(): void {
    const redisUrl = this.configService.get('app', { infer: true }).redisUrl;
    if (redisUrl) {
      this.enabled = true;
      this.client = new Redis(redisUrl, { lazyConnect: false, enableReadyCheck: true });
      this.client.on('error', (err: Error) => {
        this.logger.error(`Redis connection error: ${err.message}`);
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
