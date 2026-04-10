import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuthUser } from '../types/auth-user.type';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly databaseService: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser;

    if (!user?.sub) {
      throw new ForbiddenException('Admin privileges required');
    }

    const adminCheck = await this.databaseService.query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE id = $1 LIMIT 1',
      [user.sub],
    );

    if (!adminCheck.rowCount || !adminCheck.rows[0].is_admin) {
      throw new ForbiddenException('Admin privileges required');
    }

    request.user = { ...user, isAdmin: true };
    return true;
  }
}
