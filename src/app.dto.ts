export class StartTokenTradingDto {
  privateKey: string;
  tokenAddress: string;
  buySlipage: number;
  sellSlipage: number;
  buyAmount: number;
  jitoTips: number;
}

export class StartPoolSnipingDto {
  privateKey: string;
  minPoolSize: number;
  maxPoolSize: number;
  checkLocked: boolean;
  buySlipage?: number;
  sellSlipage?: number;
  buyAmount: number;
}
