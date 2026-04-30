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
              avatar_file_id: id,
              avatar_object_key: `users/${id}/avatar.jpg`,
              avatar_mime_type: 'image/jpeg',
              avatar_purpose: 'avatar',
              avatar_status: 'uploaded',
              avatar_created_at: '2026-01-01T00:00:00.000Z',
              avatar_uploaded_at: '2026-01-01T00:00:00.000Z',
              contact_info: `contact-${id}`,
              rate: '4.50',
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
              owner_id: id + 100,
              name: `Product ${id}`,
              price: '99.99',
              status: 'available',
              city: 'Cairo',
              created_at: '2026-01-01T00:00:00.000Z',
              owner_ssn: `SSN-${id + 100}`,
              owner_name: `Owner ${id}`,
              owner_phone: `+2010000001${id}`,
              owner_status: 'active',
              owner_avatar_file_id: id + 100,
              owner_avatar_object_key: `users/${id + 100}/avatar.jpg`,
              owner_avatar_mime_type: 'image/jpeg',
              owner_avatar_purpose: 'avatar',
              owner_avatar_status: 'uploaded',
              owner_avatar_created_at: '2026-01-01T00:00:00.000Z',
              owner_avatar_uploaded_at: '2026-01-01T00:00:00.000Z',
              owner_contact_info: `contact-${id + 100}`,
              owner_rate: '4.25',
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
    expect((output.product.owner as Record<string, unknown>).avatar).toEqual(
      expect.objectContaining({ id: 12, url: 'https://cdn.example/users/12/avatar.jpg?m=image/jpeg' }),
    );
    expect((output.product.owner as Record<string, unknown>).contactInfo).toBe('contact-12');
    expect((output.product.owner as Record<string, unknown>).rate).toBe('4.50');
    expect(output.product.category.id).toBe(3);
    expect(output.product.owner_id).toBeUndefined();
    expect(output.product.category_id).toBeUndefined();
  });

  it('expands product_id with product owner details', async () => {
    const { service } = createService();

    const output = await service.expand({ conversation: { product_id: 91 } }) as {
      conversation: { product: { id: number; owner: { id: number; avatar: { id: number } | null } | null } | null };
    };

    expect(output.conversation.product?.id).toBe(91);
    expect(output.conversation.product?.owner?.id).toBe(191);
    expect(output.conversation.product?.owner?.avatar?.id).toBe(191);
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
