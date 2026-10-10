import { Module } from '@nestjs/common';
import { ProfileController } from '@/users/profile.controller.js';
import { UsersService } from '@/users/users.service.js';

@Module({
  controllers: [ProfileController],
  providers: [UsersService],
})
export class UsersModule {}
