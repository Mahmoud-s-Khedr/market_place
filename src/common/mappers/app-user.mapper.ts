type AppUserSource = Record<string, unknown>;

export type AppUser = {
  id: number;
  ssn: string | null;
  name: string;
  phone: string;
  profileState: string | null;
};

export function mapToAppUser(source: AppUserSource): AppUser {
  const profileState = asNullableString(source.profile_state ?? source.status);

  return {
    id: toNumber(source.id),
    ssn: asNullableString(source.ssn),
    name: asString(source.name),
    phone: asString(source.phone),
    profileState,
  };
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}
