import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthFlowService, type WithCookies } from '@/auth/auth-flow.service.js';
import { ContractResponse } from '@/common/contract-response.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import {
  sessionOrNullSchema,
  sessionSchema,
  signInRequestSchema,
  signUpRequestSchema,
  upgradeGuestRequestSchema,
  type SignInRequest,
  type SignUpRequest,
  type UpgradeGuestRequest,
} from '@/contract/auth.js';
import { componentRef } from '@/contract/openapi.js';

const headersOf = (req: Request) => fromNodeHeaders(req.headers);

// Forwards Better Auth's cookies, returns the data
function sendCookies<T>(res: Response, { data, cookies }: WithCookies<T>): T {
  if (cookies.length > 0) res.append('Set-Cookie', cookies);
  return data;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthFlowService) {}

  @Get('session')
  @ContractResponse(sessionOrNullSchema)
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.getSession(headersOf(req)));
  }

  @Post('sign-up')
  @ApiBody({ schema: { $ref: componentRef('SignUpRequest') } })
  @ContractResponse(sessionSchema)
  async signUp(
    @Body(new ZodValidationPipe(signUpRequestSchema)) body: SignUpRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.signUp(body, headersOf(req)));
  }

  @Post('sign-in')
  @ApiBody({ schema: { $ref: componentRef('SignInRequest') } })
  @ContractResponse(sessionSchema)
  async signIn(
    @Body(new ZodValidationPipe(signInRequestSchema)) body: SignInRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.signIn(body, headersOf(req)));
  }

  @Post('guest')
  @ContractResponse(sessionSchema)
  async guest(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return sendCookies(res, await this.auth.continueAsGuest(headersOf(req)));
  }

  @Post('upgrade')
  @ApiBody({ schema: { $ref: componentRef('UpgradeGuestRequest') } })
  @ContractResponse(sessionSchema)
  async upgrade(
    @Body(new ZodValidationPipe(upgradeGuestRequestSchema))
    body: UpgradeGuestRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.upgradeGuest(body, headersOf(req)));
  }

  @Post('sign-out')
  @ContractResponse(z.null())
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.signOut(headersOf(req)));
  }
}
