export class StartTokenTradingDto {
  privateKey: string;
  tokenAddress: string;
  buySlipage: number;
  sellSlipage: number;
  buyAmount: number;
}

export class StartPoolSnipingDto {
  privateKey: string;
  minPoolSizeAmount: number;
  maxPoolSizeAmount: number;
  checkRenounced: boolean;
  buySlipage: number;
  sellSlipage: number;
  buyAmount: number;
}
