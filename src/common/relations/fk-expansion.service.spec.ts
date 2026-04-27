import { FkExpansionService } from './fk-expansion.service';

describe('FkExpansionService', () => {
  const readUrl = (objectKey: string, mimeType: string): string => `https://cdn.example/${objectKey}?m=${mimeType}`;

  const createService = () => {
    const databaseService = {
      query: jest.fn(async (text: string, values?: unknown[]) => {
        const ids = ((values?.[0] as number[]) ?? []).map(Number);

        if (text.includes('FROM users u')) {
          return {
            rows: ids.map((id) => ({
              id,
              ssn: `SSN-${id}`,
              name: `User ${id}`,
              phone: `+2010000000${id}`,
              status: 'active',
              avatar_object_key: `users/${id}/avatar.jpg`,
              avatar_mime_type: 'image/jpeg',
            })),
          };
        }

        if (text.includes('FROM categories')) {
          return {
            rows: ids.map((id) => ({
              id,
              parent_id: id === 3 ? 1 : null,
              name: `Category ${id}`,
              created_at: '2026-01-01T00:00:00.000Z',
            })),
          };
        }

        if (text.includes('FROM products')) {
          return {
            rows: ids.map((id) => ({
              id,
              name: `Product ${id}`,
              price: '99.99',
              status: 'available',
              city: 'Cairo',
              created_at: '2026-01-01T00:00:00.000Z',
            })),
          };
        }

        if (text.includes('FROM messages')) {
          return {
            rows: ids.map((id) => ({
              id,
              message_text: `Message ${id}`,
              sent_at: '2026-01-01T00:00:00.000Z',
              read_at: null,
            })),
          };
        }

        if (text.includes('FROM conversations')) {
          return {
            rows: ids.map((id) => ({
              id,
              created_at: '2026-01-01T00:00:00.000Z',
            })),
          };
        }

        if (text.includes('FROM files')) {
          return {
            rows: ids.map((id) => ({
              id,
              purpose: 'product_image',
              object_key: `files/${id}.jpg`,
              mime_type: 'image/jpeg',
              status: 'uploaded',
              created_at: '2026-01-01T00:00:00.000Z',
              uploaded_at: '2026-01-01T00:00:00.000Z',
            })),
          };
        }

        return { rows: [] };
      }),
    };

    const fileReadUrlService = {
      buildReadUrl: jest.fn(readUrl),
    };

    const service = new FkExpansionService(databaseService as never, fileReadUrlService as never);

    return {
      service,
      databaseService,
      fileReadUrlService,
    };
  };

  it('replaces *_id fields with related objects', async () => {
    const { service } = createService();

    const input = {
      success: true,
      product: {
        id: 91,
        owner_id: 12,
        category_id: 3,
      },
    };

    const output = await service.expand(input) as {
      product: { owner: { id: number }; category: { id: number }; owner_id?: number; category_id?: number };
    };

    expect(output.product.owner.id).toBe(12);
    expect(output.product.category.id).toBe(3);
    expect(output.product.owner_id).toBeUndefined();
    expect(output.product.category_id).toBeUndefined();
  });

  it('replaces non *_id foreign keys like reviewed_by', async () => {
    const { service } = createService();

    const output = await service.expand({ report: { id: 1, reviewed_by: 7 } }) as {
      report: { reviewed_by: { id: number } | null };
    };

    expect(output.report.reviewed_by?.id).toBe(7);
  });

  it('leaves unknown fields unchanged', async () => {
    const { service } = createService();

    const output = await service.expand({ item: { custom_id: 55, label: 'x' } }) as {
      item: { custom_id: number; label: string };
    };

    expect(output.item).toEqual({ custom_id: 55, label: 'x' });
  });

  it('expands only one level and does not expand inside injected objects', async () => {
    const { service } = createService();

    const output = await service.expand({ product: { category_id: 3 } }) as {
      product: { category: { parent_id: number | null; parent?: unknown } | null };
    };

    expect(output.product.category?.parent_id).toBe(1);
    expect(output.product.category).not.toHaveProperty('parent');
  });

  it('skips polymorphic owner_id expansion when owner_type is present', async () => {
    const { service } = createService();

    const output = await service.expand({
      file: {
        owner_type: 'product',
        owner_id: 99,
        uploader_user_id: 4,
      },
    }) as {
      file: {
        owner_id: number;
        owner?: unknown;
        uploader_user: { id: number } | null;
      };
    };

    expect(output.file.owner_id).toBe(99);
    expect(output.file.owner).toBeUndefined();
    expect(output.file.uploader_user?.id).toBe(4);
  });

  it('handles null foreign keys by replacing with null object field', async () => {
    const { service } = createService();

    const output = await service.expand({ rating: { rater_id: null } }) as {
      rating: { rater: null; rater_id?: number | null };
    };

    expect(output.rating.rater).toBeNull();
    expect(output.rating.rater_id).toBeUndefined();
  });
});
