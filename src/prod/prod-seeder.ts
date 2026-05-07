import { hash } from 'bcryptjs';
import { PoolClient } from 'pg';
import { BCRYPT_ROUNDS } from '../common/constants';
import { AdminSeedInput, parseAdminSeedInput, seedAdminUser } from '../admin/admin-seeder';

type CategoryNode = {
  name: string;
  children: string[];
};

type Queryable = Pick<PoolClient, 'query'>;

export type ProdSeedInput = AdminSeedInput;

export type ProdSeedSummary = {
  admin: {
    action: 'created' | 'updated';
    id: number;
    phone: string;
  };
  categories: {
    created: number;
    reused: number;
  };
};

const CATEGORY_TAXONOMY: CategoryNode[] = [
  {
    name: 'Real Estate',
    children: [
      'All',
      'Apartment For Rent',
      'Apartment For Sale',
      'Houses',
      'Lands',
      'Commercial Real Estate For Rent',
      'Commercial Real Estate For Sale',
      'Other',
    ],
  },
  {
    name: 'Vehicles',
    children: [
      'All',
      'Cars For Sale',
      'Cars For Rent',
      'Spare Parts And Accessories',
      'Motor Cycles',
      'Bicycles',
      'Trucks And Heavy Vehicles',
    ],
  },
  {
    name: 'Electronics',
    children: [
      'All',
      'Smartphones',
      'Tablets',
      'Laptops And Computers',
      'Accessories',
      'Speakers And Headphones',
      'Cameras',
      'Smart Watches And Wearables',
      'Monitors And TVs',
      'Other',
    ],
  },
  {
    name: 'Home And Decor',
    children: [
      'All',
      'Furniture',
      'Office Furniture',
      'Kitchen And Dining',
      'Bedding And Bath',
      'Home Decor',
      'Home Tools',
      'Lighting',
      'Other',
    ],
  },
  {
    name: 'Clothing And Fashion',
    children: [
      'All',
      'Men Clothing',
      'Women Clothing',
      'Kids Clothing',
      'Shoes',
      'Men Accessories',
      'Women Accessories And Makeup',
      'Jewelry And Watches',
      'Other',
    ],
  },
  {
    name: 'Services',
    children: [
      'All',
      'Maintenance And Repairs',
      'Transportation And Moving',
      'Personal Services',
      'Cars Services',
      'Home Services',
      'Lessons And Tutoring',
      'Other',
    ],
  },
];

export function parseProdSeedInput(env: NodeJS.ProcessEnv): ProdSeedInput {
  return parseAdminSeedInput(env);
}

async function upsertCategory(
  client: Queryable,
  name: string,
  parentId: number | null,
): Promise<{ id: number; created: boolean }> {
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO categories (name, parent_id)
     VALUES ($1, $2)
     ON CONFLICT (COALESCE(parent_id, 0), LOWER(name)) DO NOTHING
     RETURNING id`,
    [name, parentId],
  );

  if (inserted.rowCount && inserted.rowCount > 0) {
    return { id: inserted.rows[0].id, created: true };
  }

  const existing = await client.query<{ id: number }>(
    `SELECT id
     FROM categories
     WHERE COALESCE(parent_id, 0) = COALESCE($1::BIGINT, 0)
       AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [parentId, name],
  );

  if (!existing.rowCount) {
    throw new Error(`Failed to resolve category "${name}"`);
  }

  return { id: existing.rows[0].id, created: false };
}

export async function seedCategories(client: Queryable): Promise<{ created: number; reused: number }> {
  let created = 0;
  let reused = 0;

  for (const parent of CATEGORY_TAXONOMY) {
    const parentResult = await upsertCategory(client, parent.name, null);
    if (parentResult.created) created += 1;
    else reused += 1;

    for (const child of parent.children) {
      const childResult = await upsertCategory(client, child, parentResult.id);
      if (childResult.created) created += 1;
      else reused += 1;
    }
  }

  return { created, reused };
}

export async function runProdSeed(client: Queryable, input: ProdSeedInput): Promise<ProdSeedSummary> {
  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
  const admin = await seedAdminUser(client, input.phone, passwordHash);
  const categories = await seedCategories(client);

  return {
    admin: {
      action: admin.created ? 'created' : 'updated',
      id: admin.id,
      phone: admin.phone,
    },
    categories,
  };
}
