import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';
import { buildSocketCorsOptions } from '../common/cors/cors-policy';

type CorsPolicy = {
  origins: string[];
  allowAnyOrigin: boolean;
  credentials: boolean;
};

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly corsPolicy: CorsPolicy,
  ) {
    super(app);
  }

  async connectToRedis(redisUrl: string): Promise<void> {
    const pubClient = new Redis(redisUrl);
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: buildSocketCorsOptions({
        corsOrigins: this.corsPolicy.origins,
        corsAllowAnyOrigin: this.corsPolicy.allowAnyOrigin,
        corsCredentials: this.corsPolicy.credentials,
      }),
    });
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
