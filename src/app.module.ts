import { Module } from '@nestjs/common';
import { CallerModule } from './caller/caller.module';
import { GraphModule } from './graph/graph.module';
import { LoggerModule } from './logger/logger.module';
import { LogsController } from './logger/logs.controller';
import { HealthController } from './health/health.controller';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    LoggerModule,
    CallerModule,
    GraphModule,

    // Serve Swagger UI assets from public/swagger so /swagger/swagger-ui*.js|css resolve in prod
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public', 'swagger'),
      serveRoot: '/swagger',
      exclude: ['/swagger', '/swagger/'], // let SwaggerModule serve the HTML at /swagger
    }),
  ],
  controllers: [LogsController, HealthController],
})
export class AppModule {}
