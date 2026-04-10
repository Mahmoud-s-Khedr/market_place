import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ListMyProductsDto } from './dto/list-my-products.dto';
import { SearchProductsDto } from './dto/search-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import {
  ProductDeleteResponseDto,
  ProductListResponseDto,
  ProductResponseDto,
  ProductStatusResponseDto,
} from './dto/product-response.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new product listing' })
  @ApiResponse({ status: 201, description: 'Product created', type: ProductResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid category or file references', type: ErrorResponseDto })
  createProduct(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
  ): Promise<Record<string, unknown>> {
    return this.productsService.createProduct(user, dto);
  }

  @Get('products/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiResponse({ status: 200, description: 'Product details with images', type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found', type: ErrorResponseDto })
  getProduct(@Param('id', ParseIntPipe) productId: number): Promise<Record<string, unknown>> {
    return this.productsService.getProductById(productId);
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiOperation({ summary: 'Update a product listing' })
  @ApiResponse({ status: 200, description: 'Product updated', type: ProductResponseDto })
  @ApiResponse({ status: 403, description: 'Not the product owner', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found', type: ErrorResponseDto })
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductDto,
  ): Promise<Record<string, unknown>> {
    return this.productsService.updateProduct(user, productId, dto);
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiOperation({ summary: 'Soft-delete a product listing' })
  @ApiResponse({ status: 200, description: 'Product deleted (soft)', type: ProductDeleteResponseDto })
  @ApiResponse({ status: 403, description: 'Not the product owner', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found', type: ErrorResponseDto })
  deleteProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<Record<string, unknown>> {
    return this.productsService.deleteProduct(user, productId);
  }

  @Patch('products/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiOperation({ summary: 'Update product status (available/sold/archived)' })
  @ApiResponse({ status: 200, description: 'Status updated', type: ProductStatusResponseDto })
  @ApiResponse({ status: 403, description: 'Not the product owner', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found', type: ErrorResponseDto })
  updateProductStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.productsService.updateProductStatus(user, productId, dto);
  }

  @Get('my/products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the current user\'s products' })
  @ApiResponse({ status: 200, description: 'Paginated list of own products', type: ProductListResponseDto })
  listMyProducts(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMyProductsDto,
  ): Promise<Record<string, unknown>> {
    return this.productsService.listMyProducts(user, query);
  }

  @Get('search/products')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Search / filter public product listings' })
  @ApiResponse({ status: 200, description: 'Paginated search results', type: ProductListResponseDto })
  searchProducts(@Query() query: SearchProductsDto): Promise<Record<string, unknown>> {
    return this.productsService.searchProducts(query);
  }
}
