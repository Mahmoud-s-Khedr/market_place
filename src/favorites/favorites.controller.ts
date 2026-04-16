import { Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ProductListResponseDto } from '../products/dto/product-response.dto';
import { SuccessResponseDto } from '../users/dto/user-response.dto';
import { ListFavoritesDto } from './dto/list-favorites.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('Favorites')
@ApiBearerAuth()
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post(':productId')
  @ApiParam({ name: 'productId', type: Number, description: 'Product ID' })
  @ApiOperation({ summary: 'Add product to favorites' })
  @ApiResponse({ status: 201, description: 'Product favorited', type: SuccessResponseDto })
  addFavorite(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<Record<string, unknown>> {
    return this.favoritesService.addFavorite(user, productId);
  }

  @Delete(':productId')
  @ApiParam({ name: 'productId', type: Number, description: 'Product ID' })
  @ApiOperation({ summary: 'Remove product from favorites' })
  @ApiResponse({ status: 200, description: 'Favorite removed', type: SuccessResponseDto })
  removeFavorite(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<Record<string, unknown>> {
    return this.favoritesService.removeFavorite(user, productId);
  }

  @Get()
  @ApiOperation({ summary: 'List current user favorites' })
  @ApiResponse({ status: 200, description: 'Paginated favorite products', type: ProductListResponseDto })
  listFavorites(
    @CurrentUser() user: AuthUser,
    @Query() query: ListFavoritesDto,
  ): Promise<Record<string, unknown>> {
    return this.favoritesService.listFavorites(user, query);
  }
}
