import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, ApiResponse, SwaggerModule } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { ErrorResponseDto } from './error-response.dto';
import { ProductListResponseDto } from '../../products/dto/product-response.dto';

@Controller('swagger-test')
class SwaggerTestController {
  @Get('error')
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  getError(): ErrorResponseDto {
    return {
      success: false,
      statusCode: 400,
      data: null,
      error: {
        code: 400,
        message: 'Bad Request',
        timestamp: new Date().toISOString(),
        path: '/swagger-test/error',
      },
    };
  }

  @Get('products')
  @ApiResponse({ status: 200, type: ProductListResponseDto })
  getProducts(): ProductListResponseDto {
    return {
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 1,
            owner: null,
            category: null,
            name: 'Used Laptop',
            description: 'Good condition, 1 year old',
            price: 1500,
            city: 'Cairo',
            address_text: '10 Tahrir Square',
            details: { condition: 'used' },
            status: 'available',
            is_negotiable: false,
            preferred_contact_method: 'both',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            images: [],
          },
        ],
      },
    };
  }
}

@Module({
  controllers: [SwaggerTestController],
})
class SwaggerTestModule {}

describe('ErrorResponseDto Swagger', () => {
  let app: INestApplication;
  let document: any;

  beforeAll(async () => {
    app = await NestFactory.create(SwaggerTestModule, { logger: false });

    const config = new DocumentBuilder().setTitle('Swagger Test').setVersion('1.0').build();
    document = SwaggerModule.createDocument(app, config, {
      extraModels: [ErrorResponseDto],
    });

    SwaggerModule.setup('api/docs', app, document);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates Swagger document successfully with ErrorResponseDto', () => {
    expect(document).toBeDefined();

    const schema = document.components?.schemas?.ErrorResponseDto;
    expect(schema).toBeDefined();
    expect(schema.properties?.data?.nullable).toBe(true);
    expect(schema.properties?.data?.type).toBe('object');

    const productListSchema = document.components?.schemas?.ProductListResponseDto;
    expect(productListSchema?.properties?.data?.$ref).toBe('#/components/schemas/ProductListDataDto');
    expect(document.components?.schemas?.ProductListDataDto?.properties?.items?.type).toBe('array');
  });

  it('serves Swagger UI and docs JSON endpoints', async () => {
    const docsUi = await request(app.getHttpServer()).get('/api/docs').expect(200);
    const docsJson = await request(app.getHttpServer()).get('/api/docs-json').expect(200);

    expect(docsUi.text).toContain('swagger-ui');
    expect(docsJson.body.components.schemas.ErrorResponseDto).toBeDefined();
    expect(docsJson.body.components.schemas.ErrorResponseDto.properties.data.nullable).toBe(true);
  });
});
