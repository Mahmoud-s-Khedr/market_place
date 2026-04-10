import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CategoriesListResponseDto } from './dto/category-response.dto';
import { CategoriesService } from './categories.service';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all categories (tree-flat)' })
  @ApiResponse({ status: 200, description: 'Array of category objects with parent_id', type: CategoriesListResponseDto })
  listCategories(): Promise<Record<string, unknown>> {
    return this.categoriesService.listCategories();
  }
}
