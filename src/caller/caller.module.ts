import { Module } from '@nestjs/common';
import { CallerController } from './caller.controller';
import { CallerService } from './caller.service';

@Module({
  controllers: [CallerController],
  providers: [CallerService],
})
export class CallerModule {}
