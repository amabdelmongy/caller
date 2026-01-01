import { Module } from '@nestjs/common';
import { CallerModule } from './caller/caller.module';

@Module({
  imports: [CallerModule],
})
export class AppModule {}
