import { Injectable } from '@nestjs/common';
import { SseService } from './sse/sse.service';
import { StartTokenTradingDto, StartPoolSnipingDto } from './app.dto';

@Injectable()
export class AppService {
  constructor(private readonly sseService: SseService) {}

  async startTokenTrading(startTradingDto: StartTokenTradingDto) {
    const res =
      await this.sseService.startSubscriptionForTokenTrading(startTradingDto);
    return res;
  }

  async stopTokenTrading() {
    await this.sseService.stopSubscriptionForTokenTrading();
  }

  async startPoolSniping(startPoolSnipingDto: StartPoolSnipingDto) {
    const res =
      await this.sseService.startSubscriptionForPoolSniping(
        startPoolSnipingDto,
      );
    return res;
  }

  async stopPoolSniping() {
    await this.sseService.stopSubscriptionForPoolSniping();
  }

  async runBundle() {
    await this.sseService.testBuyAndSell();
  }
}
