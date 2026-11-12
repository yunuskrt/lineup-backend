import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import type { User } from '@/contract/auth.js';
import { type SoloAllowance, soloAllowanceSchema } from '@/contract/solo.js';
import { SoloService } from '@/solo/solo.service.js';

// The day's runs, not one run: beside /sessions
@ApiTags('solo')
@Controller('solo')
export class AllowanceController {
  constructor(private readonly solo: SoloService) {}

  @Get('allowance')
  @DocumentsSession()
  @ContractResponse(soloAllowanceSchema)
  allowance(@CurrentUser() user: User): Promise<SoloAllowance> {
    return this.solo.allowance(user);
  }
}
