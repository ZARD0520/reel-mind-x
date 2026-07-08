import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const cookies = header.split(';').map((part) => part.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = getCookie(req.headers.cookie, this.auth.cookieName);
    const user = await this.auth.getSessionUser(token);
    if (!user) throw new UnauthorizedException('Login required');
    req.user = user;
    return true;
  }
}
