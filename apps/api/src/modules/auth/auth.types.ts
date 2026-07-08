export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: string;
}

export interface AuthenticatedRequest {
  headers: {
    cookie?: string;
  };
  user: AuthUser;
}

export interface CookieResponse {
  cookie: (
    name: string,
    value: string,
    options: {
      httpOnly?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      secure?: boolean;
      path?: string;
      maxAge?: number;
    },
  ) => void;
  clearCookie: (name: string, options: { path?: string }) => void;
}

export interface FileResponse {
  sendFile: (path: string) => void;
}
