import { Module } from '@nestjs/common';
import { HistoryService } from '@/users/history.service.js';
import { ProfileController } from '@/users/profile.controller.js';
import { UsersService } from '@/users/users.service.js';

@Module({
  controllers: [ProfileController],
  providers: [UsersService, HistoryService],
})
export class UsersModule {}
