import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<AuthenticatedRequest>().user?.role !== 'admin')
      throw new ForbiddenException('需要管理员权限');
    return true;
  }
}
