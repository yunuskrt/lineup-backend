import { Module } from '@nestjs/common';
import { ConfigController } from '@/config/config.controller.js';

// Not in ConfigModule: it injects ENV from there
@Module({ controllers: [ConfigController] })
export class AppConfigModule {}
