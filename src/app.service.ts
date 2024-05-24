import { Injectable } from '@nestjs/common';
import { SseService } from './sse/sse.service';
import { StartTokenTradingDto, StartPoolSnipingDto } from './app.dto';

@Injectable()
export class AppService {
  constructor(private readonly sseService: SseService) {}

  async startTokenTrading(startTradingDto: StartTokenTradingDto) {
    await this.sseService.startSubscriptionForTokenTrading(startTradingDto);
    return 'started';
  }

  async stopTokenTrading() {
    await this.sseService.stopSubscriptionForTokenTrading();
  }

  async startPoolSniping(startPoolSnipingDto: StartPoolSnipingDto) {
    await this.sseService.startSubscriptionForPoolSniping(startPoolSnipingDto);
    return 'started';
  }

  async stopPoolSniping() {
    await this.sseService.stopSubscriptionForPoolSniping();
  }

  async runBundle() {
    await this.sseService.testBuyAndSell();
  }
}
