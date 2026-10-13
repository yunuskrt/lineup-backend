import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import type { User } from '@/contract/auth.js';
import { idSchema } from '@/contract/common.js';
import { type Filters, filtersSchema } from '@/contract/match.js';
import { componentRef } from '@/contract/openapi.js';
import {
  type ChooseSideRequest,
  chooseSideRequestSchema,
  type SoloGuessRequest,
  soloGuessRequestSchema,
  type SoloGuessResponse,
  soloGuessResponseSchema,
  type SoloMatchOffer,
  soloMatchOfferSchema,
  type SoloSession,
  soloSessionSchema,
  type SoloSummary,
  soloSummarySchema,
} from '@/contract/solo.js';
import { SoloService } from '@/solo/solo.service.js';

const SESSION_ID = new ZodValidationPipe(idSchema);

@ApiTags('solo')
@Controller('solo/sessions')
export class SoloController {
  constructor(private readonly solo: SoloService) {}

  @Post()
  @ApiBody({ schema: { $ref: componentRef('Filters') } })
  @DocumentsSession()
  @ContractResponse(soloMatchOfferSchema)
  start(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(filtersSchema)) filters: Filters,
  ): Promise<SoloMatchOffer> {
    return this.solo.start(user, filters);
  }

  @Post(':sessionId/side')
  @ApiBody({ schema: { $ref: componentRef('ChooseSideRequest') } })
  @DocumentsSession()
  @ContractResponse(soloSessionSchema)
  chooseSide(
    @CurrentUser() user: User,
    @Param('sessionId', SESSION_ID) sessionId: string,
    @Body(new ZodValidationPipe(chooseSideRequestSchema))
    body: ChooseSideRequest,
  ): Promise<SoloSession> {
    return this.solo.chooseSide(user, sessionId, body.side);
  }

  @Post(':sessionId/guesses')
  @ApiBody({ schema: { $ref: componentRef('SoloGuessRequest') } })
  @DocumentsSession()
  @ContractResponse(soloGuessResponseSchema)
  guess(
    @CurrentUser() user: User,
    @Param('sessionId', SESSION_ID) sessionId: string,
    @Body(new ZodValidationPipe(soloGuessRequestSchema))
    body: SoloGuessRequest,
  ): SoloGuessResponse {
    return this.solo.guess(user, sessionId, body);
  }

  @Get(':sessionId')
  @DocumentsSession()
  @ContractResponse(soloSessionSchema)
  sync(
    @CurrentUser() user: User,
    @Param('sessionId', SESSION_ID) sessionId: string,
  ): SoloSession {
    return this.solo.sync(user, sessionId);
  }

  @Post(':sessionId/quit')
  @DocumentsSession()
  @ContractResponse(soloSummarySchema)
  quit(
    @CurrentUser() user: User,
    @Param('sessionId', SESSION_ID) sessionId: string,
  ): SoloSummary {
    return this.solo.quit(user, sessionId);
  }

  @Get(':sessionId/summary')
  @DocumentsSession()
  @ContractResponse(soloSummarySchema)
  summary(
    @CurrentUser() user: User,
    @Param('sessionId', SESSION_ID) sessionId: string,
  ): SoloSummary {
    return this.solo.summary(user, sessionId);
  }
}
