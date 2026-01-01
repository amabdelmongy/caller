import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ChatRequestDto } from './caller/dto/chat.dto';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe());

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('DeepSeek AI Chat API')
    .setDescription('API documentation for DeepSeek AI Chat with LangChain')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ChatRequestDto],
    deepScanRoutes: true,
  });
  SwaggerModule.setup('/swagger', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/swagger`);
}

bootstrap();
