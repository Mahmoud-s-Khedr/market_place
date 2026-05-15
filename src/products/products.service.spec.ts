import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };

  const service = new ProductsService(databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects deleting a product owned by another user', async () => {
    const deleteClient = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ owner_id: 99 }] }),
    };
    databaseService.withTransaction.mockImplementationOnce((callback: any) => callback(deleteClient));

    await expect(service.deleteProduct({ sub: 1, phone: '+201000000001', isAdmin: false }, 10)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects attaching product image not owned by the actor', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })                        // INSERT product
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // DELETE product_images
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8, object_key: 'a.jpg', purpose: 'product_image', status: 'uploaded', uploader_user_id: 2 }] }),  // SELECT files
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));

    await expect(
      service.createProduct(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        {
          category: 'electronics',
          subcategory: 'smartphones',
          name: 'Phone',
          description: 'Desc',
          price: 100,
          city: 'Cairo',
          addressText: 'Street',
          imageFileIds: [8],
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts product image ownership when uploader id is bigint-like string', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })                        // INSERT product
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // DELETE product_images
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8, object_key: 'a.jpg', purpose: 'product_image', status: 'uploaded', uploader_user_id: '1' }] }) // SELECT files
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })                    // INSERT product_images
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })                    // UPDATE files owner
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, owner_id: 1, name: 'Phone' }] }) // fetch product
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // fetch images
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ exists: false }] }),   // favorite exists
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));

    const result = await service.createProduct(
      { sub: 1, phone: '+201000000001', isAdmin: false },
      {
        category: 'electronics',
        subcategory: 'smartphones',
        name: 'Phone',
        description: 'Desc',
        price: 100,
        city: 'Cairo',
        addressText: 'Street',
        imageFileIds: [8],
      },
    );

    expect(result).toMatchObject({ product: expect.objectContaining({ id: 5 }) });
  });

  it('rejects updating a product owned by another user (ownership check inside transaction)', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ owner_id: 99 }] }),
    };
    databaseService.withTransaction.mockImplementationOnce((callback: any) => callback(client));

    await expect(
      service.updateProduct({ sub: 1, phone: '+201000000001', isAdmin: false }, 10, { name: 'Updated' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects updating a non-existent product (inside transaction)', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };
    databaseService.withTransaction.mockImplementationOnce((callback: any) => callback(client));

    await expect(
      service.updateProduct({ sub: 1, phone: '+201000000001', isAdmin: false }, 999, { name: 'Ghost' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects attaching non-uploaded product images', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })                        // INSERT product
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // DELETE product_images
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8, object_key: 'a.jpg', purpose: 'product_image', status: 'pending', uploader_user_id: 1 }] }),  // SELECT files
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));

    await expect(
      service.createProduct(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        {
          category: 'electronics',
          subcategory: 'smartphones',
          name: 'Phone',
          description: 'Desc',
          price: 100,
          city: 'Cairo',
          addressText: 'Street',
          imageFileIds: [8],
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('includes images in search results', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: 'Phone',
          images: [{ id: 10, file_id: 20, sort_order: 0, object_key: 'products/1/a.jpg', status: 'uploaded' }],
        },
      ],
    });

    const result = await service.searchProducts({}, 5);

    expect(result).toEqual({
      items: [
        {
          id: 1,
          name: 'Phone',
          images: [{ id: 10, file_id: 20, sort_order: 0, object_key: 'products/1/a.jpg', status: 'uploaded' }],
        },
      ],
    });
  });

  it('includes images in my products results', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          name: 'Laptop',
          images: [{ id: 11, file_id: 21, sort_order: 0, object_key: 'products/2/a.jpg', status: 'uploaded' }],
        },
      ],
    });

    const result = await service.listMyProducts(
      { sub: 1, phone: '+201000000001', isAdmin: false },
      {},
    );

    expect(result).toEqual({
      items: [
        {
          id: 2,
          name: 'Laptop',
          images: [{ id: 11, file_id: 21, sort_order: 0, object_key: 'products/2/a.jpg', status: 'uploaded' }],
        },
      ],
    });

    const [queryText] = databaseService.query.mock.calls[0];
    expect(queryText).toContain('FROM product_listing_view plv');
    expect(queryText).toContain('ORDER BY plv.created_at DESC, plv.id DESC');
  });

  it('applies shared filters and sorting in my products query', async () => {
    databaseService.query.mockResolvedValueOnce({ rows: [] });

    await service.listMyProducts(
      { sub: 1, phone: '+201000000001', isAdmin: false },
      {
        category: 'electronics',
        subcategory: 'all',
        minPrice: 100,
        maxPrice: 1000,
        fromDate: '2024-01-01',
        toDate: '2024-12-31',
        minRate: 3.5,
        city: 'Cairo',
        addressText: 'Tahrir',
        q: 'iphone',
        sortBy: 'price',
        sortDir: 'asc',
        status: 'sold',
        limit: 5,
        offset: 10,
      },
    );

    const [queryText, queryParams] = databaseService.query.mock.calls[0];
    expect(queryText).toContain('plv.owner_id = $1');
    expect(queryText).toContain('plv.category = $2');
    expect(queryText).toContain('plv.price >= $3');
    expect(queryText).toContain('plv.price <= $4');
    expect(queryText).toContain('plv.created_at >= $5');
    expect(queryText).toContain('plv.created_at <= $6');
    expect(queryText).toContain("plv.city ILIKE $7 ESCAPE '\\'");
    expect(queryText).toContain("plv.address_text ILIKE $8 ESCAPE '\\'");
    expect(queryText).toContain("plainto_tsquery('simple', $9)");
    expect(queryText).toContain('plv.seller_rate >= $10');
    expect(queryText).toContain('plv.status = $11');
    expect(queryText).toContain('ORDER BY plv.price ASC, plv.id DESC');
    expect(queryParams).toEqual([
      1,
      'electronics',
      100,
      1000,
      '2024-01-01',
      '2024-12-31',
      '%Cairo%',
      '%Tahrir%',
      'iphone',
      3.5,
      'sold',
      5,
      10,
    ]);
  });

  it('supports sorting by rate in my products query', async () => {
    databaseService.query.mockResolvedValueOnce({ rows: [] });

    await service.listMyProducts(
      { sub: 1, phone: '+201000000001', isAdmin: false },
      { sortBy: 'rate', sortDir: 'desc' },
    );

    const [queryText] = databaseService.query.mock.calls[0];
    expect(queryText).toContain('ORDER BY plv.seller_rate DESC, plv.id DESC');
  });

  it('rejects invalid category/subcategory pair on create', async () => {
    databaseService.withTransaction.mockImplementation((callback: any) => callback({ query: jest.fn() }));

    await expect(
      service.createProduct(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        {
          category: 'vehicles',
          subcategory: 'smartphones',
          name: 'Phone',
          description: 'Desc',
          price: 100,
          city: 'Cairo',
          addressText: 'Street',
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects subcategory=all on update', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ owner_id: 1 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ category: 'electronics', subcategory: 'smartphones' }] }),
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));

    await expect(
      service.updateProduct(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        10,
        { subcategory: 'all' },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
