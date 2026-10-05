import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthFlowService, NO_SESSION } from '@/auth/auth-flow.service.js';
import {
  currentUserFrom,
  type RequestWithUser,
} from '@/auth/current-user.decorator.js';
import { IS_PUBLIC, Public } from '@/auth/public.decorator.js';
import { SessionGuard } from '@/auth/session.guard.js';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import type { User } from '@/contract/auth.js';

const GUEST: User = {
  id: 'g-1',
  handle: 'guest-abc12345',
  isGuest: true,
  emailVerified: false,
  tier: 'free',
};

class Routes {
  guarded(this: void) {}
  @Public()
  open(this: void) {}
}

@Public()
class PublicRoutes {
  any(this: void) {}
}

// An HTTP context over a fake request and response
function httpContext(
  handler: () => void,
  cls: object,
  request: Partial<RequestWithUser> = {},
) {
  const req = { headers: { cookie: 'lineup.session_token=t' }, ...request };
  const res = { append: vi.fn() };
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, req: req as RequestWithUser, res };
}

describe('SessionGuard', () => {
  const getSession = vi.fn();
  const guard = new SessionGuard(new Reflector(), {
    getSession,
  } as unknown as AuthFlowService);

  beforeEach(() => {
    getSession.mockReset();
  });

  it('lets a public route through without reading a session', async () => {
    const { context } = httpContext(Routes.prototype.open, Routes);

    expect(await guard.canActivate(context)).toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('honours @Public() on the class', async () => {
    const { context } = httpContext(PublicRoutes.prototype.any, PublicRoutes);

    expect(await guard.canActivate(context)).toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('refuses a request with no session', async () => {
    getSession.mockResolvedValue({ data: null, cookies: [] });
    const { context } = httpContext(Routes.prototype.guarded, Routes);

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({
      status: 401,
      error: { code: 'unauthorized', message: NO_SESSION },
    });
  });

  it('attaches the contract user from the session', async () => {
    getSession.mockResolvedValue({ data: { user: GUEST }, cookies: [] });
    const { context, req } = httpContext(Routes.prototype.guarded, Routes);

    expect(await guard.canActivate(context)).toBe(true);
    expect(req.currentUser).toEqual(GUEST);
    expect(getSession).toHaveBeenCalledWith(expect.any(Headers));
    const [headers] = getSession.mock.calls[0] as [Headers];
    expect(headers.get('cookie')).toBe('lineup.session_token=t');
  });

  it('ignores a user id the client sends', async () => {
    getSession.mockResolvedValue({ data: { user: GUEST }, cookies: [] });
    const forged = { ...GUEST, id: 'someone-else' };
    const { context, req } = httpContext(Routes.prototype.guarded, Routes, {
      currentUser: forged,
    });

    await guard.canActivate(context);

    expect(req.currentUser?.id).toBe('g-1');
  });

  it('forwards a refreshed session cookie', async () => {
    getSession.mockResolvedValue({
      data: { user: GUEST },
      cookies: ['lineup.session_token=renewed; Max-Age=2592000'],
    });
    const { context, res } = httpContext(Routes.prototype.guarded, Routes);

    await guard.canActivate(context);

    expect(res.append).toHaveBeenCalledWith('Set-Cookie', [
      'lineup.session_token=renewed; Max-Age=2592000',
    ]);
  });

  it('forwards the clearing cookie before refusing an expired session', async () => {
    getSession.mockResolvedValue({
      data: null,
      cookies: ['lineup.session_token=; Max-Age=0'],
    });
    const { context, res } = httpContext(Routes.prototype.guarded, Routes);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      error: { code: 'unauthorized' },
    });
    expect(res.append).toHaveBeenCalledWith('Set-Cookie', [
      'lineup.session_token=; Max-Age=0',
    ]);
  });

  it('never reads a failed lookup as signed out', async () => {
    getSession.mockRejectedValue(
      new ApiException('server_error', SERVER_ERROR_MESSAGE),
    );
    const { context } = httpContext(Routes.prototype.guarded, Routes);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      error: { code: 'server_error' },
    });
  });

  it('leaves non-HTTP contexts to their own checks', async () => {
    const context = { getType: () => 'ws' } as unknown as ExecutionContext;

    expect(await guard.canActivate(context)).toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('Public', () => {
  it('marks a handler with the metadata the guard reads', () => {
    expect(new Reflector().get(IS_PUBLIC, Routes.prototype.open)).toBe(true);
    expect(
      new Reflector().get(IS_PUBLIC, Routes.prototype.guarded),
    ).toBeUndefined();
  });
});

describe('currentUserFrom', () => {
  it('returns the user the guard attached', () => {
    const { context } = httpContext(Routes.prototype.guarded, Routes, {
      currentUser: GUEST,
    });
    expect(currentUserFrom(context)).toEqual(GUEST);
  });

  it('throws on a route the guard never resolved', () => {
    const { context } = httpContext(Routes.prototype.open, Routes);
    expect(() => currentUserFrom(context)).toThrow(
      '@CurrentUser() needs a guarded route',
    );
  });
});
