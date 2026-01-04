import { Module, Global } from "@nestjs/common";
import { LogsStorage } from "./logs.storage";

@Global()
@Module({
  providers: [LogsStorage],
  exports: [LogsStorage],
})
export class LoggerModule {}
