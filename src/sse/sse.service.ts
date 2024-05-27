import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  KeyedAccountInfo,
  PublicKey,
  Commitment,
  Keypair,
} from '@solana/web3.js';
// import { OpenOrders } from '@project-serum/serum';
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  // MAINNET_PROGRAM_ID,
  Token,
  TokenAmount,
  LiquidityPoolKeysV4,
} from '@raydium-io/raydium-sdk';
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import { Listeners } from 'src/libs/listeners';
import { PoolCache, TradingCache, SnipingCache } from 'src/libs/cache';
import { TradingBot, SnipingBot, BotConfig } from 'src/libs/bot';
import { AlgorithmDEMA } from 'src/libs/bot/AlgorithmDEMA';
import { getToken, getWallet } from 'src/libs/bot';
import { StartTokenTradingDto, StartPoolSnipingDto } from 'src/app.dto';
import { getMinimalMarketV3, createPoolKeys } from 'src/libs/helpers';

export enum TransactionMode {
  'BUNDLE',
  'COMMON',
}

export enum TransactionType {
  BUY,
  SELL,
  UNKNOWN,
}

export type TradingState = {
  transactionType: TransactionType;
  transactionBaseAmount: number;
  transactionQuoteAmount: number;
  tokenPriceSOL: number;
  tokenPriceBase: number;
  tokenPriceUSB: number;
  bundle?: {
    diff: number;
    buySlippage: number;
    sellSlippage: number;
  };
  trading?: {
    type: TransactionType;
    profit: number;
  };
};

export type SnipingState = {
  poolId: string;
  tokenAddress: string;
  poolSize: string;
  isLocked: string;
  buying?: {
    amount: number;
  };
};

// const RPC_ENDPOINT = process.env['RPC_ENDPOINT'];
// const RPC_WEBSOCKET_ENDPOINT = process.env['RPC_WEBSOCKET_ENDPOINT'];
// const COMMITMENT_LEVEL = process.env['COMMITMENT_LEVEL'] as Commitment;
// console.log('RPC_ENDPOINT', RPC_ENDPOINT);
// const connection = new Connection(RPC_ENDPOINT, {
//   wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
//   commitment: COMMITMENT_LEVEL,
// });

// const listeners = new Listeners(connection);
// const poolCache = new PoolCache();

@Injectable()
export class SseService {
  private connection: Connection;
  private listeners: Listeners;

  private poolCache: PoolCache;
  private tradingCache: TradingCache;
  private snipingCache: SnipingCache;

  private isRunningTokenTrading = false;
  private isRunningPoolSniping = false;

  private wallet: Keypair;

  private tradingPoolId = '';
  private baseToken = '';

  private quoteToken: Token;
  private quoteAta: PublicKey;

  private preSwapBaseInAmount = '';
  private preSwapBaseOutAmount = '';
  private preSwapQuoteInAmount = '';
  private preSwapQuoteOutAmount = '';

  private isRunningBundle = false;

  private tradingBot: TradingBot;
  private algoDEMA: AlgorithmDEMA;

  private snipingBot: SnipingBot;
  private sniperRunTimestamp: number;

  constructor(private readonly configService: ConfigService) {
    this.connection = new Connection(this.configService.get('RPC_ENDPOINT'), {
      wsEndpoint: this.configService.get('RPC_WEBSOCKET_ENDPOINT'),
      commitment: this.configService.get('COMMITMENT_LEVEL') as Commitment,
    });

    this.listeners = new Listeners(this.connection);
    this.poolCache = new PoolCache();
    this.tradingCache = new TradingCache();
    this.snipingCache = new SnipingCache();

    this.quoteToken = getToken(this.configService.get('QUOTE_MINT'));

    this.listeners.on(
      'listenPoolForTrading',
      this.subscribeToRaydiumPoolsForTrading,
    );
    this.listeners.on(
      'listenPoolForSniping',
      this.subscribeToRaydiumPoolsForSniping,
    );
    this.listeners.on('wallet', this.subscribeToWalletChanges);
  }

  /***************************************************************************** */
  /******************************  Trading Bot  ******************************** */
  /***************************************************************************** */

  async setBundleTradingState(trading: boolean) {
    this.isRunningBundle = trading;
  }

  async startSubscriptionForTokenTrading(
    startTokenTradingDto: StartTokenTradingDto,
  ) {
    if (this.isRunningTokenTrading) {
      return;
    }

    this.isRunningTokenTrading = true;

    this.wallet = getWallet(startTokenTradingDto.privateKey.trim());
    // this.wallet = getWallet(this.configService.get('PRIVATE_KEY').trim());

    this.baseToken = startTokenTradingDto.tokenAddress.trim();

    this.quoteAta = getAssociatedTokenAddressSync(
      this.quoteToken.mint,
      this.wallet.publicKey,
    );

    // const baseAta = getAssociatedTokenAddressSync(
    //   new PublicKey(this.baseToken),
    //   this.wallet.publicKey,
    // );

    // console.log(quoteToken.mint.toBase58(), this.quoteAta);
    // console.log(this.baseToken, baseAta);

    const botConfig: BotConfig = {
      wallet: this.wallet,
      checkRenounced: false,
      checkFreezable: false,
      checkBurned: false,
      minPoolSizeAmount: null,
      maxPoolSizeAmount: null,
      quoteAmount: new TokenAmount(
        this.quoteToken,
        startTokenTradingDto.buyAmount, // this.configService.get('QUOTE_AMOUNT'),
        false,
      ),
      buySlippage: Number(startTokenTradingDto.buySlipage) || 50, // Number(this.configService.get('BUY_SLIPPAGE')),
      sellSlippage: Number(startTokenTradingDto.sellSlipage) || 50, // Number(this.configService.get('SELL_SLIPPAGE')),
      jitoCustomFee: Number(this.configService.get('CUSTOM_FEE')),
    };

    this.tradingBot = new TradingBot(this.connection, botConfig);

    this.algoDEMA = new AlgorithmDEMA();

    await this.listeners.startTokenTrading({
      walletPublicKey: this.wallet.publicKey,
      baseToken: startTokenTradingDto.tokenAddress.trim(),
      quoteToken: this.quoteToken,
    });
  }

  getTradingHistories() {
    return this.tradingCache.getActivities();
  }

  async stopSubscriptionForTokenTrading() {
    if (this.listeners) {
      await this.listeners.stopForTrading();
    }

    this.tradingCache?.clear();

    this.tradingBot = null;

    this.isRunningTokenTrading = false;
  }

  private subscribeToRaydiumPoolsForTrading = async (
    updatedAccountInfo: KeyedAccountInfo,
  ) => {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(
      updatedAccountInfo.accountInfo.data,
    );
    // const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
    // const exists = await poolCache.get(poolState.baseMint.toString());

    this.tradingPoolId = updatedAccountInfo.accountId.toString();

    const baseDecimal = Number(poolState.baseDecimal);
    const quoteDecimal = Number(poolState.quoteDecimal);

    // Get base and quote balance(Vault)
    const baseTokenBalance = await this.connection.getTokenAccountBalance(
      poolState.baseVault,
      this.connection.commitment,
    );
    const quoteTokenBalance = await this.connection.getTokenAccountBalance(
      poolState.quoteVault,
      this.connection.commitment,
    );
    /*
    const basePnl = Number(poolState.baseNeedTakePnl.toString());
    const quotePnl = Number(poolState.quoteNeedTakePnl.toString());

    const openOrders = await OpenOrders.load(
      this.connection,
      new PublicKey(poolState.openOrders),
      MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
    );

    const openOrdersBaseTokenTotal = Number(
      openOrders.baseTokenTotal.toString(),
    );
    const openOrdersQuoteTokenTotal = Number(
      openOrders.quoteTokenTotal.toString(),
    );

    const base =
      (Number(baseTokenBalance.value.amount) +
        openOrdersBaseTokenTotal -
        basePnl) /
      10 ** baseDecimal;
    const quote =
      (Number(quoteTokenBalance.value.amount) +
        openOrdersQuoteTokenTotal -
        quotePnl) /
      10 ** quoteDecimal;
*/
    const base = Number(baseTokenBalance.value.amount) / 10 ** baseDecimal;
    const quote = Number(quoteTokenBalance.value.amount) / 10 ** quoteDecimal;

    // The calculation price
    const priceOfQuoteInBase = base / quote;
    const priceOfBaseInQuote = quote / base;

    // Token USD
    const tokenPriceUSB = priceOfBaseInQuote * 181.09;

    const inOutChange: number[] = [];
    if (this.preSwapBaseInAmount !== '') {
      inOutChange[0] = Number(
        BigInt(poolState.swapBaseInAmount.toString()) -
          BigInt(this.preSwapBaseInAmount),
      );
      inOutChange[1] = Number(
        BigInt(poolState.swapBaseOutAmount.toString()) -
          BigInt(this.preSwapBaseOutAmount),
      );
      inOutChange[2] = Number(
        BigInt(poolState.swapQuoteInAmount.toString()) -
          BigInt(this.preSwapQuoteInAmount),
      );
      inOutChange[3] = Number(
        BigInt(poolState.swapQuoteOutAmount.toString()) -
          BigInt(this.preSwapQuoteOutAmount),
      );
    }

    this.preSwapBaseInAmount = poolState.swapBaseInAmount.toString();
    this.preSwapBaseOutAmount = poolState.swapBaseOutAmount.toString();

    this.preSwapQuoteInAmount = poolState.swapQuoteInAmount.toString();
    this.preSwapQuoteOutAmount = poolState.swapQuoteOutAmount.toString();

    if (inOutChange[0] > 0) {
      const activity = {
        transactionType: TransactionType.SELL,
        transactionBaseAmount: inOutChange[0] / 10 ** baseDecimal,
        transactionQuoteAmount: inOutChange[3] / 10 ** quoteDecimal,
        tokenPriceSOL: priceOfBaseInQuote,
        tokenPriceBase: priceOfQuoteInBase,
        tokenPriceUSB: tokenPriceUSB,
      };

      // await this.runBundle(activity);

      await this.runDEMA(activity);

      // this.printActivity(
      //   'Sell',
      //   inOutChange[0],
      //   inOutChange[3],
      //   tokenPriceUSB,
      //   priceOfBaseInQuote,
      // );
    }

    if (inOutChange[1] > 0) {
      const activity = {
        transactionType: TransactionType.BUY,
        transactionBaseAmount: inOutChange[1] / 10 ** baseDecimal,
        transactionQuoteAmount: inOutChange[2] / 10 ** quoteDecimal,
        tokenPriceSOL: priceOfBaseInQuote,
        tokenPriceBase: priceOfQuoteInBase,
        tokenPriceUSB: tokenPriceUSB,
      };

      // await this.runBundle(activity);

      await this.runDEMA(activity);

      // this.printActivity(
      //   'Buy',
      //   inOutChange[1],
      //   inOutChange[2],
      //   tokenPriceUSB,
      //   priceOfBaseInQuote,
      // );
    }
  };

  private runBundle = async (currActivity: TradingState) => {
    const lastTx = this.tradingCache.getLastActivity();
    if (lastTx) {
      // check condition
      if (
        currActivity.transactionType === TransactionType.SELL &&
        lastTx.TYPE === 'BUY'
      ) {
        const diff = currActivity.tokenPriceSOL - Number(lastTx.SOL);

        if (diff > 0) {
          // console.log(
          //   `Matched for Buy / sell => DIFF: ${diff}, BUY SLIPPAGE: ${this.configService.get('BUY_SLIPPAGE')}, SELL SLIPPAGE: ${this.configService.get('SELL_SLIPPAGE')}`,
          // );

          const bundle = {
            diff: diff,
            buySlippage: this.configService.get('BUY_SLIPPAGE'),
            sellSlippage: this.configService.get('SELL_SLIPPAGE'),
          };

          currActivity.bundle = bundle;
          // console.log(JSON.stringify(currActivity, null, 4));

          this.tradingCache.save(new Date().getTime(), currActivity);

          if (
            this.isRunningBundle &&
            this.tradingPoolId !== '' &&
            this.baseToken
          ) {
            // await this.tradingBot.buyAndSellWithCommon(this.poolId, this.baseToken);
            await this.tradingBot.buyWithCommon(
              this.tradingPoolId,
              this.baseToken,
            );
          }

          return;
        }
      }
    }

    this.tradingCache.save(new Date().getTime(), currActivity);
  };

  private runDEMA = async (currActivity: TradingState) => {
    if (this.algoDEMA && this.tradingPoolId !== '' && this.baseToken) {
      const calcuRes = await this.algoDEMA.checkDEMA(
        this.tradingPoolId,
        this.baseToken,
      );

      if (calcuRes) {
        const trading = {
          type: calcuRes.type,
          profit: calcuRes.profit,
        };

        currActivity.trading = trading;
        // console.log(JSON.stringify(currActivity, null, 4));

        this.tradingCache.save(new Date().getTime(), currActivity);

        if (this.tradingBot) {
          if (calcuRes.type === TransactionType.BUY) {
            await this.tradingBot.buyWithCommon(
              this.tradingPoolId,
              this.baseToken,
            );
          } else if (calcuRes.type === TransactionType.SELL) {
            await this.tradingBot.sellWithCommon(
              this.tradingPoolId,
              this.baseToken,
            );
          }
        }
      } else {
        this.tradingCache.save(new Date().getTime(), currActivity);
      }
    }
  };

  /***************************************************************************** */
  /******************************  Sniping Bot  ******************************** */
  /***************************************************************************** */

  async startSubscriptionForPoolSniping(
    startPoolSnipingDto: StartPoolSnipingDto,
  ) {
    if (this.isRunningPoolSniping) {
      return;
    }

    this.isRunningPoolSniping = true;

    this.wallet = getWallet(startPoolSnipingDto.privateKey.trim());
    // this.wallet = getWallet(this.configService.get('PRIVATE_KEY').trim());

    const quoteMinPoolSizeAmount = new TokenAmount(
      this.quoteToken,
      Number(startPoolSnipingDto.minPoolSizeAmount),
      false,
    );
    const quoteMaxPoolSizeAmount = new TokenAmount(
      this.quoteToken,
      Number(startPoolSnipingDto.maxPoolSizeAmount),
      false,
    );

    const botConfig: BotConfig = {
      wallet: this.wallet,
      checkRenounced: startPoolSnipingDto.checkLocked,
      checkFreezable: startPoolSnipingDto.checkLocked,
      checkBurned: false,
      minPoolSizeAmount: quoteMinPoolSizeAmount,
      maxPoolSizeAmount: quoteMaxPoolSizeAmount,
      quoteAmount: new TokenAmount(
        this.quoteToken,
        startPoolSnipingDto.buyAmount, // this.configService.get('QUOTE_AMOUNT'),
        false,
      ),
      buySlippage: Number(startPoolSnipingDto.buySlipage) || 50, // Number(this.configService.get('BUY_SLIPPAGE')),
      sellSlippage: Number(startPoolSnipingDto.sellSlipage) || 50, // Number(this.configService.get('SELL_SLIPPAGE')),
      jitoCustomFee: Number(this.configService.get('CUSTOM_FEE')),
    };

    this.snipingBot = new SnipingBot(this.connection, botConfig);

    this.sniperRunTimestamp = Math.floor(new Date().getTime() / 1000);

    await this.listeners.startPoolSniping({
      walletPublicKey: this.wallet.publicKey,
      quoteToken: this.quoteToken,
    });
  }

  async stopSubscriptionForPoolSniping() {
    if (this.listeners) {
      await this.listeners.stopForSniping();
    }

    // this.poolCache.clear();
    this.snipingCache?.clear();

    this.snipingBot = null;

    this.isRunningPoolSniping = false;
  }

  getSnipingHistories() {
    return this.snipingCache.getActivities();
  }

  private subscribeToRaydiumPoolsForSniping = async (
    updatedAccountInfo: KeyedAccountInfo,
  ) => {
    try {
      const key = updatedAccountInfo.accountId.toString();
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(
        updatedAccountInfo.accountInfo.data,
      );
      const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
      const existing = await this.poolCache.get(poolState.baseMint.toString());
      if (poolOpenTime > this.sniperRunTimestamp && !existing) {
        this.poolCache.save(key, poolState);

        const market = await getMinimalMarketV3(
          this.connection,
          new PublicKey(poolState.marketId.toString()),
          this.connection.commitment,
        );

        const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(
          updatedAccountInfo.accountId,
          poolState,
          market,
        );

        const response = await this.connection.getTokenAccountBalance(
          poolKeys.quoteVault,
          this.connection.commitment,
        );

        const poolSize = new TokenAmount(
          this.quoteToken,
          response.value.amount,
          true,
        );

        console.log('Pool Size of sse.service:', poolSize.toFixed());

        const availableSize = await this.snipingBot.checkPoolSize(poolSize);

        const isLocked = await this.snipingBot.checkLocked(poolKeys.baseMint);
        console.log(poolState.baseMint.toBase58(), isLocked);
        if (availableSize && isLocked) {
          const activity = {
            poolId: key,
            tokenAddress: poolState.baseMint.toBase58(),
            isLocked: isLocked ? 'Locked' : 'Unlocked',
            poolSize: poolSize.toFixed(),
            buying: {
              amount: 0,
            },
          };

          this.snipingCache.save(new Date().getTime(), activity);

          if (this.snipingBot) {
            this.snipingBot.buyWithCommon(key, poolState.baseMint.toBase58());
          }

          return;
        }

        const activity = {
          poolId: key,
          tokenAddress: poolState.baseMint.toBase58(),
          isLocked: isLocked ? 'Locked' : 'Unlocked',
          poolSize: poolSize.toFixed(),
        };
        this.snipingCache.save(new Date().getTime(), activity);
      }
    } catch (error) {}
  };

  /***************************************************************************** */
  /***************************  Wallet Subscription  *************************** */
  /***************************************************************************** */

  private subscribeToWalletChanges = async (
    updatedAccountInfo: KeyedAccountInfo,
  ) => {
    const accountData = AccountLayout.decode(
      updatedAccountInfo.accountInfo.data,
    );

    // console.log({ updatedAccountInfo });
    // console.log({ accountData });

    if (updatedAccountInfo.accountId.equals(this.quoteAta)) {
      return;
    }

    if (accountData.mint.toBase58() !== this.baseToken) {
      return;
    }

    if (accountData.amount === 0n) {
      return;
    }

    console.log(
      `Sell => Token Address: ${accountData.mint}, Token Balance: ${Number(accountData.amount)}`,
    );

    if (this.isRunningBundle && this.tradingPoolId !== '' && this.baseToken) {
      await this.tradingBot.sellWithCommon(this.tradingPoolId, this.baseToken);
    }
  };

  async testBuyAndSell() {
    console.log(this.tradingPoolId, this.baseToken);
    if (this.tradingPoolId !== '' && this.baseToken) {
      // await this.tradingBot.buyAndSellWithCommon(this.poolId, this.baseToken);
      await this.tradingBot.buyWithCommon(this.tradingPoolId, this.baseToken);
    }
    // await this.tradingBot.buyWithCommon(
    //   '7mtJbVNEtejYmCLRriwQhymZdzn4wGRFTvTZ5721b4BD',
    //   'HQ7DaoiUxzC2K1Dr7KXRHccNtXvEYgNvoUextXe8dmBh',
    // );
  }

  private printActivity(
    type: string,
    baseAmount: number,
    quoteAmount: number,
    priceUSD: number,
    priceSOL: number,
  ) {
    const transactioRes = {
      DATE: new Date(),
      TYPE: type,
      // USD: 0,
      TOKEN: baseAmount,
      SOL: quoteAmount,
      PRICE_USD: priceUSD,
      PRICE_SOL: priceSOL,
    };

    console.table({ Transaction: transactioRes });
  }

  private sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
}

// listeners.on('pool', async (updatedAccountInfo: string) => {
//   poolCache.save(new Date().getTime().toString(), updatedAccountInfo);
// });
