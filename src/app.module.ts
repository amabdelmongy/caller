import { Module } from '@nestjs/common';
import { CallerModule } from './caller/caller.module';
import { LogsController } from './caller/logs.controller';

@Module({
  imports: [CallerModule],
  controllers: [LogsController],
})
export class AppModule {}
