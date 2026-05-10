import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../config/configuration';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';

type JwtPayload = {
  sub: number | string;
  phone: string;
  isAdmin: boolean;
  tokenVersion?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
    private readonly databaseService: DatabaseService,
  ) {
    const appConfig = configService.get('app', { infer: true });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: appConfig.jwtAccessSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (typeof payload.tokenVersion !== 'number') {
      throw new UnauthorizedException('Invalid token');
    }
    const normalizedSub = this.toPositiveInt(payload.sub);
    if (normalizedSub === null) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.databaseService.query<{ id: number; phone: string; token_version: number }>(
      'SELECT id, phone, token_version FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [normalizedSub],
    );

    if (!user.rowCount || user.rows[0].token_version !== payload.tokenVersion) {
      throw new UnauthorizedException('Token is stale');
    }

    return {
      sub: normalizedSub,
      phone: user.rows[0].phone,
      isAdmin: payload.isAdmin,
      tokenVersion: user.rows[0].token_version,
    };
  }

  private toPositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }
}
