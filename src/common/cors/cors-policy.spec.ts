import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { RedisIoAdapter } from '../../chat/redis-io.adapter';
import { buildCorsRuntimePolicy, buildHttpCorsOptions, buildSocketCorsOptions } from './cors-policy';

@Controller('cors-test')
class CorsTestController {
  @Get()
  getOk(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  controllers: [CorsTestController],
})
class CorsTestModule {}

async function createCorsApp(policy: ReturnType<typeof buildCorsRuntimePolicy>): Promise<INestApplication> {
  const app = await NestFactory.create(CorsTestModule, { logger: false });
  app.enableCors(buildHttpCorsOptions(policy));
  await app.init();
  return app;
}

describe('CORS policy', () => {
  it('allows configured origins for HTTP preflight requests', async () => {
    const app = await createCorsApp(
      buildCorsRuntimePolicy({
        corsOrigins: ['http://localhost:800', 'http://localhost:5174'],
        corsAllowAnyOrigin: false,
        corsCredentials: true,
      }),
    );

    try {
      const response = await request(app.getHttpServer())
        .options('/cors-test')
        .set('Origin', 'http://localhost:5174')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5174');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('does not allow disallowed origins for HTTP preflight requests', async () => {
    const app = await createCorsApp(
      buildCorsRuntimePolicy({
        corsOrigins: ['http://localhost:800'],
        corsAllowAnyOrigin: false,
        corsCredentials: true,
      }),
    );

    try {
      const response = await request(app.getHttpServer())
        .options('/cors-test')
        .set('Origin', 'http://localhost:5174')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('reflects requested non-simple headers without a hard-coded allowlist', async () => {
    const app = await createCorsApp(
      buildCorsRuntimePolicy({
        corsOrigins: ['http://localhost:5174'],
        corsAllowAnyOrigin: false,
        corsCredentials: true,
      }),
    );

    try {
      const response = await request(app.getHttpServer())
        .options('/cors-test')
        .set('Origin', 'http://localhost:5174')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'x-custom-header,x-lang')
        .expect(204);

      expect(response.headers['access-control-allow-headers']).toBe('x-custom-header,x-lang');
    } finally {
      await app.close();
    }
  });

  it('disables credentials in wildcard mode', async () => {
    const app = await createCorsApp(
      buildCorsRuntimePolicy({
        corsOrigins: ['*'],
        corsAllowAnyOrigin: true,
        corsCredentials: false,
      }),
    );

    try {
      const response = await request(app.getHttpServer())
        .options('/cors-test')
        .set('Origin', 'http://localhost:5174')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5174');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('uses the same origin and credential policy for HTTP and Socket.IO', async () => {
    const policy = buildCorsRuntimePolicy({
      corsOrigins: ['http://localhost:800', 'http://localhost:5174'],
      corsAllowAnyOrigin: false,
      corsCredentials: true,
    });
    const app = await NestFactory.create(CorsTestModule, { logger: false });

    try {
      const httpCors = buildHttpCorsOptions(policy);
      const adapter = new RedisIoAdapter(app, {
        origins: policy.corsOrigins,
        allowAnyOrigin: policy.corsAllowAnyOrigin,
        credentials: policy.corsCredentials,
      });
      const server = adapter.createIOServer(0);

      try {
        expect(buildSocketCorsOptions(policy)).toEqual({
          origin: httpCors.origin,
          credentials: httpCors.credentials,
        });
        expect(server.engine.opts.cors).toMatchObject({
          origin: httpCors.origin,
          credentials: httpCors.credentials,
        });
      } finally {
        server.close();
      }
    } finally {
      await app.close();
    }
  });
});
