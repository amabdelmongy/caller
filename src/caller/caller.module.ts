import { Module } from '@nestjs/common';
import { DeepSeekController } from './caller.controller';
import { CallerService } from './caller.service';

@Module({
  controllers: [DeepSeekController],
  providers: [CallerService],
})
export class CallerModule {}
