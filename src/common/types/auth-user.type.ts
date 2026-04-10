export type AuthUser = {
  sub: number;
  phone: string;
  isAdmin: boolean;
  tokenVersion?: number;
};
