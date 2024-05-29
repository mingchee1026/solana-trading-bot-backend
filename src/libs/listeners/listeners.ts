import { Metaplex } from '@metaplex-foundation/js';
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  MAINNET_PROGRAM_ID,
  Token,
} from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
// import bs58 from 'bs58';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58');
import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';

export class Listeners extends EventEmitter {
  private subscriptionsForTrading: number[] = [];
  private subscriptionsForSniping: number[] = [];
  private metaplex;

  constructor(private readonly connection: Connection) {
    super();

    this.metaplex = new Metaplex(connection);
  }

  public async startTokenTrading(config: {
    walletPublicKey: PublicKey;
    baseToken: string;
    quoteToken: Token;
    autoSell?: boolean;
    cacheNewMarkets?: boolean;
  }) {
    // if (config.cacheNewMarkets) {
    //   const openBookSubscription =
    //     await this.subscribeToOpenBookMarkets(config);
    //   this.subscriptions.push(openBookSubscription);
    // }

    const raydiumTokenSubscription =
      await this.subscribeToRaydiumPoolsForTrading(config);
    this.subscriptionsForTrading.push(raydiumTokenSubscription);

    // if (config.autoSell) {
    const walletSubscription = await this.subscribeToWalletChanges(config);
    this.subscriptionsForTrading.push(walletSubscription);
    // }

    // const logSubsciption = await this.subscribeToTransactionLogs(config);
    // this.subscriptions.push(logSubsciption);
  }

  public async startPoolSniping(config: {
    walletPublicKey: PublicKey;
    quoteToken: Token;
  }) {
    const raydiumPoolSubscription =
      await this.subscribeToRaydiumPoolsForSniping(config);
    this.subscriptionsForSniping.push(raydiumPoolSubscription);
  }

  private async subscribeToRaydiumPoolsForTrading(config: {
    baseToken: string;
  }) {
    console.log(`Starting listener for token ${config.baseToken} ...`);
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo) => {
        this.emit('listenPoolForTrading', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
            bytes: config.baseToken,
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
    );
  }

  private async subscribeToRaydiumPoolsForSniping(config: {
    quoteToken: Token;
  }) {
    console.log(`Starting listener for new pool ...`);
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo) => {
        this.emit('listenPoolForSniping', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
    );
  }

  private async subscribeToWalletChanges(config: {
    walletPublicKey: PublicKey;
  }) {
    console.log(
      `Starting listener for wallet ${config.walletPublicKey.toBase58()} ...`,
    );
    return this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        this.emit('wallet', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: config.walletPublicKey.toBase58(),
          },
        },
      ],
    );
  }

  public async stopForTrading() {
    console.log('Stopping trading listener ...');
    for (let i = this.subscriptionsForTrading.length; i >= 0; --i) {
      const subscription = this.subscriptionsForTrading[i];
      await this.connection.removeAccountChangeListener(subscription);
      this.subscriptionsForTrading.splice(i, 1);
    }
  }

  public async stopForSniping() {
    console.log('Stopping pool listener ...');
    for (let i = this.subscriptionsForSniping.length; i >= 0; --i) {
      const subscription = this.subscriptionsForSniping[i];
      await this.connection.removeAccountChangeListener(subscription);
      this.subscriptionsForSniping.splice(i, 1);
    }
  }
}
