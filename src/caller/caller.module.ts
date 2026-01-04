import { Module } from '@nestjs/common';
import { CallerController } from './caller.controller';
import { CallerService } from './caller.service';
import { LogsStorage } from '../logger/logs.storage';

@Module({
  controllers: [CallerController],
  providers: [CallerService, LogsStorage],
  exports: [LogsStorage],
})
export class CallerModule {}
