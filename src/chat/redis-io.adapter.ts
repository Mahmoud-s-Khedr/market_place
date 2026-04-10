import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly corsOrigins: string[],
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
      cors:
        this.corsOrigins.length > 0
          ? { origin: this.corsOrigins, credentials: true }
          : false,
    });
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
