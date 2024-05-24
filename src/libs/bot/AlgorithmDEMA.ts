import { Indicators } from '@ixjb94/indicators';

import { TransactionType } from 'src/sse/sse.service';
// import { Bot } from './bot';

const options = {
  method: 'GET',
  headers: { 'X-API-KEY': '3a52505960ba4355936444fe19bd251b' },
};

export class AlgorithmDEMA {
  private poolId: string;
  private mintBase: string;

  private buyPrice: number;
  private constantPrice: number;

  private sellPercentage: number;

  private initiateSwap: boolean = false;
  private percentSwapInitiated: boolean = false;
  private datemillis: number;
  private dateseconds: number;

  constructor() {} // private readonly mintQuote: string, private readonly mintBase: string, private readonly poolId: string, private readonly bot: Bot, private readonly connection: Connection,

  private async fetchData() {
    try {
      const apiOHLC = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${this.poolId}/ohlcv/minute?aggregate=5&limit=1000&currency=usd&token=base`; // 5m

      const response = await fetch(apiOHLC);
      const data = await response.json();
      const fifthElements = data.data.attributes.ohlcv_list.map(
        (subList) => subList[4],
      );
      fifthElements.reverse();

      return data;
    } catch (error) {
      // console.error('Error fetching data:', error);
    }
  }

  private async buyPriceFetcher() {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/price?address=${this.mintBase}`,
      options,
    );

    const price = await response.json();
    this.buyPrice = Number(price.data.value);
    // console.log("Buying token amount: " + BuyPrice);
  }

  private async priceFetcher() {
    try {
      const response = await fetch(
        `https://public-api.birdeye.so/defi/price?address=${this.mintBase}`,
        options,
      );
      const price = await response.json();
      this.constantPrice = Number(price.data.value);
    } catch (error) {
      // console.error('Error fetching price: ', error);
    }
    // console.log(ConstantPrice);
  }

  private percentageCalculate() {
    try {
      // console.log('PercentageCalculate', this.constantPrice, this.buyPrice);
      this.sellPercentage = (this.constantPrice / this.buyPrice) * 100;
    } catch (error) {
      console.error('Error calculating percentage: ', error);
    }
  }

  private calculateEMA9(closingPrices, period) {
    const k = 2 / (period + 1);
    let sma = 0;

    for (let i = 0; i < period; i++) {
      sma += closingPrices[i];
    }
    sma /= period;

    let ema9 = sma;

    for (let i = period; i < closingPrices.length; i++) {
      ema9 = (closingPrices[i] - ema9) * k + ema9;
    }

    return ema9;
  }

  private calculateDEMA(closingPrices, period) {
    const k = 2 / (period + 1);

    let ema1 = 0;
    for (let i = 0; i < period; i++) {
      ema1 += closingPrices[i];
    }
    ema1 /= period;

    let ema2 = 0;
    for (let i = 0; i < period; i++) {
      ema2 += ema1;
    }
    ema2 /= period;

    let dema = ema1 * 2 - ema2;

    for (let i = period; i < closingPrices.length; i++) {
      ema1 = (closingPrices[i] - ema1) * k + ema1;
      ema2 = (ema1 - ema2) * k + ema2;
      dema = ema1 * 2 - ema2;
    }

    return dema;
  }

  async checkDEMA(poolId: string, mintBase: string) {
    this.poolId = poolId;
    this.mintBase = mintBase;
    let result = null;

    try {
      const data = await this.fetchData();
      this.datemillis = Date.now();
      this.dateseconds = this.datemillis * 1000;

      const fifthElements = data.data.attributes.ohlcv_list.map(
        (subList) => subList[4],
      );
      fifthElements.reverse();

      const openPrices = data.data.attributes.ohlcv_list.map(
        (subList) => subList[1],
      );
      openPrices.reverse();

      const highPrices = data.data.attributes.ohlcv_list.map(
        (subList) => subList[2],
      );
      highPrices.reverse();

      const lowPrices = data.data.attributes.ohlcv_list.map(
        (subList) => subList[3],
      );
      lowPrices.reverse();

      // const closingListforEMAList12 = fifthElements.slice(-905, -1);
      // const closingListforEMAList26 = fifthElements.slice(-910, -1);

      this.priceFetcher();
      this.percentageCalculate();

      // let ema12List = calculateEMAList(closingListforEMAList12, 12);
      // let ema26List = calculateEMAList(closingListforEMAList26, 26);

      // let SignalEmaCalculation = [];

      // for(var i = 0;i<=ema26List.length-1;i++)
      // SignalEmaCalculation.push(ema12List[i] - ema26List[i]);

      // MACD INDICATOR
      // ema9 = calculateEMA9(closingListforEMAList12, 12);
      // ema26 = calculateEMA9(closingListforEMAList26, 26);
      // MACDLine = ema9 - ema26;
      // SignalLine = calculateEMA9(SignalEmaCalculation, 9);

      // console.log('Sell Percentage: ' + SellPercentage);
      // console.log('MACD: ' + MACDLine);
      // console.log('Signal' + SignalLine);

      // Double EMA
      //   const dema4 = this.calculateDEMA(closingListforEMAList12, 10);
      //   const dema9 = this.calculateDEMA(closingListforEMAList26, 18);
      //   const ema4 = this.calculateEMA9(closingListforEMAList12, 4);
      //   const ema9 = this.calculateEMA9(closingListforEMAList26, 9);
      // console.log('DEMA10: ' + dema4);
      // console.log('DEMA18: ' + dema9);

      // SUPERTREND INDICATOR. Do not use.
      // let ATRList = calculateATR(highPrices, lowPrices, fifthElements, 13);
      // let averagetruerange = ATRList[ATRList.length-1];
      // let supertrendLowerLine = (highPrices[highPrices.length-1] + lowPrices[lowPrices.length-1]) / 2 - (6 * averagetruerange);
      // let supertrendUpperLine = (highPrices[highPrices.length-1] + lowPrices[lowPrices.length-1]) / 2 + (6 * averagetruerange);
      // console.log('ATR: ' + averagetruerange);
      // console.log('SuperTrend Lower: ' + supertrendLowerLine);
      // console.log('SuperTrend Upper: ' + supertrendUpperLine);

      // TRUE STRENGTH INDEX
      // let { tsiValues, signalLine } = calculateTSIWithSignal(fifthElements, 13, 25, 7, 13);
      const ta = new Indicators();
      // const tsiList = await ta.tsi(fifthElements, 25, 13);
      // const tsiSignalList = await ta.ema(tsiList, 13);
      // const tsiSignal = tsiSignalList[tsiSignalList.length - 2];
      // const tsiLine = tsiList[tsiList.length - 2];
      // console.log(tsiLine);
      // console.log(tsiSignal);

      // STOCHASTIC
      const stochList = await ta.stoch(
        highPrices,
        lowPrices,
        fifthElements,
        14,
        6,
        6,
      );

      const stochbaseList = stochList[0];
      const stochsignalList = stochList[1];
      const stochbase = stochbaseList[stochbaseList.length - 1];
      const stochsignal = stochsignalList[stochsignalList.length - 1];

      console.log('Stochastic base:' + stochbase);
      console.log('Stochastic signal:' + stochsignal);
      console.log('InitiateSwap:', this.initiateSwap);
      console.log('SellPercentage:', this.sellPercentage);

      // STOCH RSI. Do not use
      // const stochRsiList = await ta.stochrsi(fifthElements, 14);
      // const stochRsi = stochRsiList[stochRsiList.length - 1];
      // const stochRsiSignalList = await ta.sma(stochRsiList, 3);
      // const stochRsiSignal = stochRsiSignalList[stochRsiSignalList.length - 1];
      // let stochRsiwithMAsmoothTest = await ta.sma(stochRsiList, 3);
      // console.log('Stochastic RSI: ' + stochRsiList);
      // console.log('Stochastic Signal: ' + stochRsiSignal);

      // FISHER INDICATOR
      // const fisher = await ta.fisher(highPrices, lowPrices, 12);
      // console.log(fisher);
      // const fisherbaseList = fisher[0];
      // const fishersignalList = fisher[1];
      // const fisherbase = fisherbaseList[fisherbaseList.length - 1];
      // const fishersignal = fishersignalList[fishersignalList.length - 1];
      // let fishersignalListEma = await ta.ema(fisherbaseList, 9);
      // let fishersignalema = fishersignalListEma[fishersignalListEma.length-1];
      // console.log('Fisher base from indicators: ' + fisherbase);
      // console.log('Fisher signal from indicators: ' + fishersignal);
      // console.log('Fisher signal from Technical Indicators EMA: ' + fishersignalema);

      if (this.sellPercentage >= 110) {
        // this.sellExecute();
        // this.bot.sellWithCommon(this.poolId, this.mintBase);

        console.log('---------------------------'); // For logging purposes. You can use /n if you want
        console.log('Timestamp: ' + this.dateseconds);
        console.log('Maximum percentage profit exceeded! Swapping...');
        console.log('Expected profit percent: ' + this.sellPercentage);
        console.log('---------------------------'); // For logging purposes. You can use /n if you want
        this.percentSwapInitiated = true;
        this.buyPrice = NaN; //'This text unassigns the value of the variable';

        result = {
          type: TransactionType.SELL,
          profit: this.sellPercentage,
        };
      }

      if (this.sellPercentage <= 95) {
        // SellExecute();
        console.log('Timestamp: ' + this.dateseconds);
        console.log('Minimum percentage loss exceeded! Swapping...');
        console.log('Expected loss percent: ' + this.sellPercentage);
        this.percentSwapInitiated = true;
        this.buyPrice = NaN; //'This text unassigns the value of the variable';
      }

      if (
        stochbase > stochsignal &&
        !this.initiateSwap /* !PercentSwapInitiated */
      ) {
        // Buy Initializer
        console.log('---------------------------'); // For logging purposes. You can use /n if you want
        console.log('Timestamp: ' + this.dateseconds);
        console.log('Buy Signal Triggered');
        console.log('---------------------------'); // For logging purposes. You can use /n if you want

        this.buyPriceFetcher();

        // this.buyExecute();
        // this.bot.buyWithCommon(this.poolId, this.mintBase);

        this.initiateSwap = true;

        result = {
          type: TransactionType.BUY,
          profit: 0,
        };
      }

      if (
        (stochbase < stochsignal &&
          this.initiateSwap &&
          this.percentSwapInitiated) ||
        (stochbase < stochsignal &&
          this.initiateSwap &&
          !this.percentSwapInitiated)
      ) {
        // Sell Initializer
        console.log('---------------------------'); // For logging purposes. You can use /n if you want
        console.log('Timestamp: ' + this.dateseconds);
        console.log(
          'Sell Signal Triggered. Profit/Loss: ' + this.sellPercentage,
        );
        console.log('---------------------------'); // For logging purposes. You can use /n if you want

        // this.sellExecute();
        // this.bot.sellWithCommon(this.poolId, this.mintBase);

        this.initiateSwap = false;
        this.percentSwapInitiated = false;
        this.buyPrice = NaN; //'This text unassigns the value of the variable';

        result = {
          type: TransactionType.SELL,
          profit: this.sellPercentage,
        };
      }
    } catch (error) {
      // console.error('Error fetching and calculating data:', error);
    }

    return result;
  }
}
