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
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ is_leaf: true }] })  // assertLeafCategory
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })                        // INSERT product
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // DELETE product_images
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8, object_key: 'a.jpg', purpose: 'product_image', status: 'uploaded', uploader_user_id: 2 }] }),  // SELECT files
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));

    await expect(
      service.createProduct(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        {
          categoryId: 3,
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
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ is_leaf: true }] })  // assertLeafCategory
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })                        // INSERT product
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // DELETE product_images
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8, object_key: 'a.jpg', purpose: 'product_image', status: 'pending', uploader_user_id: 1 }] }),  // SELECT files
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));

    await expect(
      service.createProduct(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        {
          categoryId: 3,
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
  });
});
