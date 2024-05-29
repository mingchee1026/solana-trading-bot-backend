import { Controller, Get, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppService } from './app.service';
import { StartTokenTradingDto, StartPoolSnipingDto } from './app.dto';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  index(@Res() response: Response) {
    response
      .type('text/html')
      .send(readFileSync(join(__dirname, 'index.html')).toString());
  }

  @Post('startTokenTrading')
  async startTokenTrading(@Body() startTokenTradingDto: StartTokenTradingDto) {
    return await this.appService.startTokenTrading(startTokenTradingDto); // FFuAa2tv4VdB8o8fLS1oC7qAt13NXS1hv8hBTbFVP9uT HogxGo1jDwvseBdYNvNBM7UYpsWJPifbH7hM5nCvBWuw
    // if (res.Ok) {
    //   response.json({ Ok: true });
    // } else {
    //   response.json({ Ok: true });
    // }
  }

  @Get('stopTokenTrading')
  async stopTokenTrading() {
    return await this.appService.stopTokenTrading();
  }

  @Post('startPoolSniping')
  async startPoolSniping(@Body() startPoolSnipingDto: StartPoolSnipingDto) {
    return await this.appService.startPoolSniping(startPoolSnipingDto);
  }

  @Get('stopPoolSniping')
  async stopPoolSniping() {
    return await this.appService.stopPoolSniping();
  }

  @Get('bundle')
  async runBundle() {
    return await this.appService.runBundle();
  }
}
