import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import type { User } from '@/contract/auth.js';
import { type Profile, profileSchema } from '@/contract/profile.js';
import { UsersService } from '@/users/users.service.js';

@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @DocumentsSession()
  @ContractResponse(profileSchema)
  async profile(@CurrentUser() user: User): Promise<Profile> {
    return { user, stats: await this.users.statsOf(user.id) };
  }
}
