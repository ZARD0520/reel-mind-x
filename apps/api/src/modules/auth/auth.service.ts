import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthSessionSchema,
  UserSchema,
  type AuthSession,
  type LoginInput,
  type RegisterInput,
  type User,
} from '@reel/contracts';
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser, CookieResponse } from './auth.types';

const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

interface SessionPayload {
  sub: string;
  exp: number;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64url');
}

function parseBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(input: RegisterInput, res: CookieResponse): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash: this.hashPassword(input.password),
      },
    });
    this.setSessionCookie(res, user.id);
    return AuthSessionSchema.parse({ user });
  }

  async login(input: LoginInput, res: CookieResponse): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !this.verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'active') throw new UnauthorizedException('User is disabled');

    this.setSessionCookie(res, user.id);
    return AuthSessionSchema.parse({ user });
  }

  logout(res: CookieResponse): void {
    res.clearCookie(this.cookieName, { path: '/' });
  }

  async getSessionUser(token: string | undefined): Promise<AuthUser | null> {
    const payload = this.verifySessionToken(token);
    if (!payload) return null;

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Session user not found');
    return UserSchema.parse(user);
  }

  get cookieName(): string {
    return this.config.get('AUTH_COOKIE_NAME', { infer: true });
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('base64url');
    const hash = pbkdf2Sync(
      password,
      salt,
      PASSWORD_ITERATIONS,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
    ).toString('base64url');
    return `pbkdf2:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [scheme, iterationsText, salt, hash] = stored.split(':');
    if (scheme !== 'pbkdf2' || !iterationsText || !salt || !hash) return false;

    const expected = Buffer.from(hash, 'base64url');
    const actual = pbkdf2Sync(
      password,
      salt,
      Number(iterationsText),
      expected.length,
      PASSWORD_DIGEST,
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private setSessionCookie(res: CookieResponse, userId: string): void {
    const days = this.config.get('AUTH_SESSION_DAYS', { infer: true });
    const maxAge = days * 24 * 60 * 60 * 1000;
    const token = this.signSessionToken({
      sub: userId,
      exp: Math.floor((Date.now() + maxAge) / 1000),
    });
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge,
    });
  }

  private signSessionToken(payload: SessionPayload): string {
    const encodedPayload = base64Url(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  private verifySessionToken(token: string | undefined): SessionPayload | null {
    if (!token) return null;
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;
    if (this.sign(encodedPayload) !== signature) return null;

    const payload = parseBase64UrlJson<SessionPayload>(encodedPayload);
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.get('SESSION_SECRET', { infer: true }))
      .update(value)
      .digest('base64url');
  }
}
