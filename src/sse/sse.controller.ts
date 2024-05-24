import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { interval, Observable, map } from 'rxjs';
import { SseService } from './sse.service';

@Controller('sse')
export class SseController {
  constructor(private readonly sseService: SseService) {}

  @Sse('substxs')
  sse(): Observable<MessageEvent> {
    return interval(3000).pipe(
      map(() => ({
        data: {
          tradingData: this.sseService.getTradingHistories(),
          snipingData: this.sseService.getSnipingHistories(),
        },
      })),
    );
  }
}
