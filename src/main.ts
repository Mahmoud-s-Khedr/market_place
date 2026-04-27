import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import helmet from 'helmet';
import express from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { FkExpansionInterceptor } from './common/interceptors/fk-expansion.interceptor';
import { HttpResponseEnvelopeInterceptor } from './common/interceptors/http-response-envelope.interceptor';
import { AppConfig } from './config/configuration';
import { RedisIoAdapter } from './chat/redis-io.adapter';
import { ErrorDetailDto, ErrorResponseDto } from './common/dto/error-response.dto';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService<{ app: AppConfig }, true>>(ConfigService);
  const appConfig = configService.get('app', { infer: true });

  const redisIoAdapter = new RedisIoAdapter(app, appConfig.corsOrigins);
  if (appConfig.redisUrl) {
    await redisIoAdapter.connectToRedis(appConfig.redisUrl);
  }
  app.useWebSocketAdapter(redisIoAdapter);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new HttpResponseEnvelopeInterceptor(),
    new LoggingInterceptor(),
    app.get(FkExpansionInterceptor),
  );

  if (appConfig.corsOrigins.length > 0) {
    app.enableCors({
      origin: appConfig.corsOrigins,
      credentials: true,
    });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Market Place API')
    .setDescription(
      'Online marketplace REST API — user registration, product listings, real-time chat, ratings, and admin moderation.\n\n' +
      '> **WebSocket (Chat):** Real-time messaging uses a Socket.io gateway at the `/chat` namespace. ' +
      'That interface is not documented here; see the project README for event names and payloads.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true,
    extraModels: [ErrorResponseDto, ErrorDetailDto],
  });
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));

  await app.listen(appConfig.port);
}

void bootstrap();
