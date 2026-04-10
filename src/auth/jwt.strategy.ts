import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../config/configuration';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';

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

  async validate(payload: AuthUser): Promise<AuthUser> {
    if (typeof payload.tokenVersion !== 'number') {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.databaseService.query<{ id: number; phone: string; token_version: number }>(
      'SELECT id, phone, token_version FROM users WHERE id = $1 LIMIT 1',
      [payload.sub],
    );

    if (!user.rowCount || user.rows[0].token_version !== payload.tokenVersion) {
      throw new UnauthorizedException('Token is stale');
    }

    return {
      sub: payload.sub,
      phone: user.rows[0].phone,
      isAdmin: payload.isAdmin,
      tokenVersion: user.rows[0].token_version,
    };
  }
}
