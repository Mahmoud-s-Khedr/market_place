import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { SearchProductsDto } from './search-products.dto';

describe('Product taxonomy DTO validation', () => {
  it('accepts valid create payload pair', async () => {
    const dto = plainToInstance(CreateProductDto, {
      category: 'electronics',
      subcategory: 'smartphones',
      name: 'Phone',
      description: 'Desc',
      price: 100,
      city: 'Cairo',
      addressText: 'Street',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects subcategory all in create payload', async () => {
    const dto = plainToInstance(CreateProductDto, {
      category: 'electronics',
      subcategory: 'all',
      name: 'Phone',
      description: 'Desc',
      price: 100,
      city: 'Cairo',
      addressText: 'Street',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'subcategory')).toBe(true);
  });

  it('allows subcategory=all for search', async () => {
    const dto = plainToInstance(SearchProductsDto, {
      category: 'electronics',
      subcategory: 'all',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects mismatched category/subcategory for search', async () => {
    const dto = plainToInstance(SearchProductsDto, {
      category: 'vehicles',
      subcategory: 'smartphones',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'subcategory')).toBe(true);
  });
});
