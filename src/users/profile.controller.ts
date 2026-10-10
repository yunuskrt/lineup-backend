import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import type { User } from '@/contract/auth.js';
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
} from '@/contract/constants.js';
import {
  type HistoryPage,
  historyPageSchema,
  type HistoryQuery,
  historyQuerySchema,
  type Profile,
  profileSchema,
} from '@/contract/profile.js';
import { HistoryService } from '@/users/history.service.js';
import { UsersService } from '@/users/users.service.js';

@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly history: HistoryService,
  ) {}

  @Get()
  @DocumentsSession()
  @ContractResponse(profileSchema)
  async profile(@CurrentUser() user: User): Promise<Profile> {
    return { user, stats: await this.users.statsOf(user.id) };
  }

  @Get('history')
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_HISTORY_LIMIT,
      default: DEFAULT_HISTORY_LIMIT,
    },
  })
  @DocumentsSession()
  @ContractResponse(historyPageSchema)
  historyPage(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
  ): Promise<HistoryPage> {
    return this.history.historyOf(user.id, query);
  }
}
