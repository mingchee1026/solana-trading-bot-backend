import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SseController } from './sse/sse.controller';
import { SseService } from './sse/sse.service';
import { SseModule } from './sse/sse.module';

@Module({
  imports: [ConfigModule.forRoot(), SseModule, SseModule],
  controllers: [AppController, SseController],
  providers: [AppService, SseService],
})
export class AppModule {}
