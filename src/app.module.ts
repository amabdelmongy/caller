import { Module } from '@nestjs/common';
import { CallerModule } from './caller/caller.module';
import { LogsController } from './caller/logs.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [CallerModule],
  controllers: [LogsController, HealthController],
})
export class AppModule {}
