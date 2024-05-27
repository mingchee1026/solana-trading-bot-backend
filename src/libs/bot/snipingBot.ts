import {
  PublicKey,
  ComputeBudgetProgram,
  Connection,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getMint,
  MintLayout,
  AccountLayout,
} from '@solana/spl-token';
import { Currency, CurrencyAmount, TokenAmount } from '@raydium-io/raydium-sdk';
import { VolumeData } from '../web3/types';
import { SwapInfoB } from '../web3';
import { calculateSwapInfoFromInput, getPubkeyFromStr } from '../web3/utils';
import { getConnectivity, getBlockhash } from '../web3/utils';
import { Result } from '../web3/types';
import { sendBundle, sendBundleTest } from '../web3/utils';
import { JITO_TIPS_ACCOUNTS } from '../web3/utils';
import { getPriorityFee } from '../web3/utils/priorityFee';
import { BotConfig } from './tradingBot';

export class SnipingBot {
  constructor(
    private readonly connection: Connection,
    readonly config: BotConfig,
  ) {}

  private async checkMintable(vault: PublicKey) {
    try {
      const { data } = await this.connection
        .getAccountInfo(vault)
        .catch(async () => {
          await this.sleep(1000);
          return this.connection.getAccountInfo(vault).catch(() => null);
        });

      if (!data) {
        return false;
      }

      const deserialize = MintLayout.decode(data);
      return deserialize.mintAuthorityOption === 0;
    } catch (e) {
      console.log('error in checking mint');
      console.log(`mint: ${vault}, Failed to check if mint is renounced`);
    }

    return false;
  }

  public async shouldBuy(poolSize: TokenAmount, baseMint: PublicKey) {
    // if (!this.config.minPoolSizeAmount.isZero()) {
    //   if (poolSize.lt(this.config.minPoolSizeAmount)) {
    //     return false;
    //   }
    // }

    // if (!this.config.maxPoolSizeAmount.isZero()) {
    //   if (poolSize.gt(this.config.maxPoolSizeAmount)) {
    //     return false;
    //   }
    // }

    if (
      poolSize.lt(this.config.minPoolSizeAmount) ||
      poolSize.gt(this.config.maxPoolSizeAmount)
    ) {
      return false;
    }

    if (this.config.checkRenounced) {
      const mintOption = await this.checkMintable(baseMint);

      if (mintOption !== true) {
        return false;
      }
    }

    return true;
  }

  public async buyAndSellWithBundle(
    poolId: string,
    tokenAddress: string,
    txType: 'BUNDLE' | 'COMMON',
  ) {
    try {
      const accountInfo = await this.connection
        .getAccountInfo(this.config.wallet.publicKey)
        .catch(async () => {
          await this.sleep(1000);
          return this.connection
            .getAccountInfo(this.config.wallet.publicKey)
            .catch(() => null);
        });

      if (!accountInfo) {
        console.log('FAILED TO FETCH THE WALLETS INFO');
        return;
      }

      const rawSol = accountInfo.lamports ?? 0;
      const sol = (accountInfo.lamports ?? 0) / LAMPORTS_PER_SOL;

      const mint = getPubkeyFromStr(tokenAddress);
      if (!mint) {
        console.log('FAILED TO FETCH THE MINT INFO');
        return;
      }

      let runSellTx = false;
      let tokenAmount = 0;
      let rawTokenAmount = 0;
      try {
        const mintInfo = await getMint(this.connection, mint).catch(() => null);
        if (!mintInfo) {
          throw 'TOKEN INFO NOT FOUND';
        }

        const mintAta = getAssociatedTokenAddressSync(
          mint,
          this.config.wallet.publicKey,
        );
        const ataAccountInfo = await this.connection
          .getAccountInfo(mintAta)
          .catch(async () => {
            await this.sleep(1000);
            return this.connection.getAccountInfo(mintAta).catch(() => null);
          });

        console.log({ ataAccountInfo });
        if (!ataAccountInfo) {
          throw 'failed to fetch atas info';
        }

        const DEVIDER = 10 ** mintInfo.decimals;
        // const rawBalance = ataAccountInfo ? Number(AccountLayout.decode(ataAccountInfo.data).amount.toString()) : 0;
        const rawBalance =
          Number(this.config.quoteAmount.raw) /
          (0.0000000958 * LAMPORTS_PER_SOL);
        tokenAmount = rawBalance / DEVIDER;
        rawTokenAmount = rawBalance;
        console.log(mintInfo.decimals, rawBalance / DEVIDER, rawTokenAmount);

        console.log(AccountLayout.decode(ataAccountInfo.data));

        // tokenAmount = rawBalance / DEVIDER;
        // rawTokenAmount = rawBalance;
        // console.log(mintInfo.decimals, tokenAmount, rawBalance);

        runSellTx = true;
      } catch (getBalanceError) {
        console.log({ getBalanceError }, 'Fetching token balance');
        // return;
      }

      const volumeData: VolumeData = {
        poolId,
        tokenAddress,
        wallets: [
          {
            address: this.config.wallet.publicKey,
            privateKey: this.config.wallet,
            sol,
            rawSol,
            tokenAmount,
            rawTokenAmount,
            selected: true,
          },
        ],
        amounts: {
          BUY: Number(this.config.quoteAmount.raw),
          SELL: 100,
        },
        // swapUnitPrice: this.config.unitPrice,
        // swapUnitLimit: this.config.unitLimit,
      };

      const _versionedTxs = [];

      {
        // create buy tx
        console.log('Creating buy tx');

        const buyTxsInfo = await this.getBundleTxsInfo(
          volumeData,
          'BUY',
          this.config.buySlippage,
        );
        if (buyTxsInfo.Err) {
          console.log(buyTxsInfo.Err);
          return;
        }

        const buyInfoRes = buyTxsInfo.Ok;
        if (!buyInfoRes) {
          console.log('Failed generate Buy Bundle data');
          return;
        }

        const buyRecentBlockhash = await getBlockhash(this.connection);
        if (!buyRecentBlockhash) {
          console.log(`Error getting buy blockhash`);
          return;
        }

        const priorityFeeInfo = getPriorityFee();
        const txFee = (priorityFeeInfo as any)['medium'];
        const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: txFee,
        });

        const jitoFee = new CurrencyAmount(
          Currency.SOL,
          this.config.jitoCustomFee,
          false,
        ).raw.toNumber();

        const jitoTipTx = SystemProgram.transfer({
          fromPubkey: this.config.wallet.publicKey,
          toPubkey: JITO_TIPS_ACCOUNTS[3],
          lamports: LAMPORTS_PER_SOL * jitoFee, // ENV.BUNDLE_FEE,
        });

        const buyTxMsg = new TransactionMessage({
          // instructions: [incTxFeeIx, ...buyInfoRes?.ixs],
          instructions: [
            ...(txType === 'COMMON' ? [incTxFeeIx] : [jitoTipTx]),
            ...buyInfoRes?.ixs,
          ],
          payerKey: this.config.wallet.publicKey,
          recentBlockhash: buyRecentBlockhash.blockhash,
        }).compileToV0Message([]);

        const _buyTx = new VersionedTransaction(buyTxMsg);
        _buyTx.sign([...buyInfoRes.keypairs]);

        _versionedTxs.push(_buyTx);
      }

      if (runSellTx) {
        // create sell tx
        console.log('Creating sell tx');

        const sellTxsInfo = await this.getBundleTxsInfo(
          volumeData,
          'SELL',
          this.config.sellSlippage,
        );

        if (sellTxsInfo.Err) {
          console.log(sellTxsInfo.Err);
          return;
        }

        const sellInfoRes = sellTxsInfo.Ok;
        if (!sellInfoRes) {
          console.log('Failed generate Sell Bundle data');
          return;
        }

        const sellRecentBlockhash = await getBlockhash(this.connection);
        if (!sellRecentBlockhash) {
          console.log(`Error getting sell blockhash`);
          return;
        }

        const priorityFeeInfo = getPriorityFee();
        const txFee = (priorityFeeInfo as any)['medium'];
        const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: txFee,
        });

        const sellTxMsg = new TransactionMessage({
          instructions: [incTxFeeIx, ...sellInfoRes?.ixs],
          payerKey: this.config.wallet.publicKey,
          recentBlockhash: sellRecentBlockhash.blockhash,
        }).compileToV0Message([]);

        const _sellTx = new VersionedTransaction(sellTxMsg);
        _sellTx.sign([...sellInfoRes.keypairs]);

        _versionedTxs.push(_sellTx);
      }

      let bundleRes: Result<
        {
          bundleId: string;
          txsSignature?: string[];
          bundleStatus?: number;
        },
        string
      > | null = null;

      if (txType === 'BUNDLE') {
        // Jito bundle
        bundleRes = await sendBundle(
          _versionedTxs,
          this.connection,
          'tokyo.mainnet.block-engine.jito.wtf',
        ).catch((sendBundleError) => {
          console.log({ sendBundleError }, 'Bundle error:');
          return null;
        });
      } else {
        // Common transaction
        bundleRes = await sendBundleTest(_versionedTxs, this.connection).catch(
          (sendBundleError) => {
            console.log({ sendBundleError }, 'Bundle error:');
            return null;
          },
        );
      }

      // console.log({ bundleRes }, `Swap results:`);

      if (!bundleRes || !bundleRes.Ok) {
        console.log(`Swap failed:`);
        return;
      }

      const { bundleId, txsSignature } = bundleRes.Ok;

      if (txType === 'COMMON') {
        console.log(`Check buy:  'https://solscan.io/tx/${txsSignature![0]}'`);
        console.log(`Check sell: 'https://solscan.io/tx/${txsSignature![1]}'`);
      } else {
        console.log(`Check 'https://explorer.jito.wtf/bundle/${bundleId}'`);
      }
    } catch (error) {
      console.log(error);
      console.log(`buy and sell: ${error}`);
    }
  }

  public async buyAndSellWithCommon(poolId: string, tokenAddress: string) {
    try {
      {
        // create buy tx
        console.log('Creating buy tx');

        const buyVolumeData = await this.getVolumeData(poolId, tokenAddress);
        if (!buyVolumeData) {
          console.log('Failed to get volume data for buy.');
          return;
        }

        const buyTxsInfo = await this.getBundleTxsInfo(
          buyVolumeData,
          'BUY',
          this.config.buySlippage,
        );
        if (buyTxsInfo.Err) {
          console.log(buyTxsInfo.Err);
          return;
        }

        const buyInfoRes = buyTxsInfo.Ok;
        if (!buyInfoRes) {
          console.log('Failed generate Buy Bundle data');
          return;
        }

        const buyRecentBlockhash = await getBlockhash(this.connection);
        if (!buyRecentBlockhash) {
          console.log(`Error getting buy blockhash`);
          return;
        }

        const priorityFeeInfo = getPriorityFee();
        const txFee = (priorityFeeInfo as any)['medium'];
        const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: txFee,
        });

        const buyTxMsg = new TransactionMessage({
          instructions: [incTxFeeIx, ...buyInfoRes?.ixs],
          payerKey: this.config.wallet.publicKey,
          recentBlockhash: buyRecentBlockhash.blockhash,
        }).compileToV0Message([]);

        const _buyTx = new VersionedTransaction(buyTxMsg);
        _buyTx.sign([...buyInfoRes.keypairs]);

        const buyRes: Result<
          {
            bundleId: string;
            txsSignature?: string[];
            bundleStatus?: number;
          },
          string
        > | null = await sendBundleTest([_buyTx], this.connection).catch(
          (sendBundleError) => {
            console.log({ sendBundleError }, 'Bundle error:');
            return null;
          },
        );

        if (!buyRes || !buyRes.Ok) {
          console.log(`Swap transaction failed(Buy):`);
          return;
        }

        const { txsSignature } = buyRes.Ok;

        console.log(`Check buy:  'https://solscan.io/tx/${txsSignature![0]}'`);
      }

      {
        // create sell tx
        console.log('Creating sell tx');

        const sellVolumeData = await this.getVolumeData(poolId, tokenAddress);
        if (!sellVolumeData) {
          console.log('Failed to get volume data for sell.');
          return;
        }

        const sellTxsInfo = await this.getBundleTxsInfo(
          sellVolumeData,
          'SELL',
          this.config.sellSlippage,
        );

        if (sellTxsInfo.Err) {
          console.log(sellTxsInfo.Err);
          return;
        }

        const sellInfoRes = sellTxsInfo.Ok;
        if (!sellInfoRes) {
          console.log('Failed generate Sell Bundle data');
          return;
        }

        const sellRecentBlockhash = await getBlockhash(this.connection);
        if (!sellRecentBlockhash) {
          console.log(`Error getting sell blockhash`);
          return;
        }

        const priorityFeeInfo = getPriorityFee();
        const txFee = (priorityFeeInfo as any)['medium'];
        const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: txFee,
        });

        const sellTxMsg = new TransactionMessage({
          instructions: [incTxFeeIx, ...sellInfoRes?.ixs],
          payerKey: this.config.wallet.publicKey,
          recentBlockhash: sellRecentBlockhash.blockhash,
        }).compileToV0Message([]);

        const _sellTx = new VersionedTransaction(sellTxMsg);
        _sellTx.sign([...sellInfoRes.keypairs]);

        const sellRes: Result<
          {
            bundleId: string;
            txsSignature?: string[];
            bundleStatus?: number;
          },
          string
        > | null = await sendBundleTest([_sellTx], this.connection).catch(
          (error) => {
            console.log({ error }, 'Sell transaction failed.');
            return null;
          },
        );

        if (!sellRes || !sellRes.Ok) {
          console.log(`Sell transaction failed.`);
          return;
        }

        const { txsSignature } = sellRes.Ok;

        console.log(`Check sell:  'https://solscan.io/tx/${txsSignature![0]}'`);
      }
    } catch (error) {
      console.log(error);
      console.log(`buy and sell: ${error}`);
    }
  }

  public async buyWithCommon(poolId: string, tokenAddress: string) {
    try {
      // create buy tx
      console.log('Creating buy tx');

      const buyVolumeData = await this.getVolumeData(poolId, tokenAddress);
      if (!buyVolumeData) {
        console.log('Failed to get volume data for buy.');
        return;
      }
      console.log('buyVolumeData', buyVolumeData);
      const buyTxsInfo = await this.getBundleTxsInfo(
        buyVolumeData,
        'BUY',
        this.config.buySlippage,
      );
      if (buyTxsInfo.Err) {
        console.log(buyTxsInfo.Err);
        return;
      }

      const buyInfoRes = buyTxsInfo.Ok;
      if (!buyInfoRes) {
        console.log('Failed generate Buy Bundle data');
        return;
      }

      const buyRecentBlockhash = await getBlockhash(this.connection);
      if (!buyRecentBlockhash) {
        console.log(`Error getting buy blockhash`);
        return;
      }

      const priorityFeeInfo = getPriorityFee();
      const txFee = (priorityFeeInfo as any)['medium'];
      const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: txFee,
      });

      const buyTxMsg = new TransactionMessage({
        instructions: [incTxFeeIx, ...buyInfoRes?.ixs],
        payerKey: this.config.wallet.publicKey,
        recentBlockhash: buyRecentBlockhash.blockhash,
      }).compileToV0Message([]);

      const _buyTx = new VersionedTransaction(buyTxMsg);
      _buyTx.sign([...buyInfoRes.keypairs]);

      const buyRes: Result<
        {
          bundleId: string;
          txsSignature?: string[];
          bundleStatus?: number;
        },
        string
      > | null = await sendBundleTest([_buyTx], this.connection).catch(
        (sendBundleError) => {
          console.log({ sendBundleError }, 'Bundle error:');
          return null;
        },
      );

      if (!buyRes || !buyRes.Ok) {
        console.log(`Swap transaction failed(Buy):`);
        return;
      }

      const { txsSignature } = buyRes.Ok;

      console.log(`Check buy:  'https://solscan.io/tx/${txsSignature![0]}'`);
    } catch (error) {
      console.log(`Buy error: ${error}`);
    }
  }

  public async sellWithCommon(poolId: string, tokenAddress: string) {
    try {
      // create sell tx
      console.log('Creating sell tx');

      const sellVolumeData = await this.getVolumeData(poolId, tokenAddress);
      if (!sellVolumeData) {
        console.log('Failed to get volume data for sell.');
        return;
      }
      console.log('sellVolumeData', sellVolumeData);
      const sellTxsInfo = await this.getBundleTxsInfo(
        sellVolumeData,
        'SELL',
        this.config.sellSlippage,
      );

      if (sellTxsInfo.Err) {
        console.log(sellTxsInfo.Err);
        return;
      }

      const sellInfoRes = sellTxsInfo.Ok;
      if (!sellInfoRes) {
        console.log('Failed generate Sell Bundle data');
        return;
      }

      const sellRecentBlockhash = await getBlockhash(this.connection);
      if (!sellRecentBlockhash) {
        console.log(`Error getting sell blockhash`);
        return;
      }

      const priorityFeeInfo = getPriorityFee();
      const txFee = (priorityFeeInfo as any)['medium'];
      const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: txFee,
      });

      const sellTxMsg = new TransactionMessage({
        instructions: [incTxFeeIx, ...sellInfoRes?.ixs],
        payerKey: this.config.wallet.publicKey,
        recentBlockhash: sellRecentBlockhash.blockhash,
      }).compileToV0Message([]);

      const _sellTx = new VersionedTransaction(sellTxMsg);
      _sellTx.sign([...sellInfoRes.keypairs]);

      const sellRes: Result<
        {
          bundleId: string;
          txsSignature?: string[];
          bundleStatus?: number;
        },
        string
      > | null = await sendBundleTest([_sellTx], this.connection).catch(
        (error) => {
          console.log({ error }, 'Sell transaction failed.');
          return null;
        },
      );

      if (!sellRes || !sellRes.Ok) {
        console.log(`Sell transaction failed.`);
        return;
      }

      const { txsSignature } = sellRes.Ok;

      console.log(`Check sell:  'https://solscan.io/tx/${txsSignature![0]}'`);
    } catch (error) {
      console.log(`Sell error: ${error}`);
    }
  }

  private async getVolumeData(poolId: string, tokenAddress: string) {
    try {
      const accountInfo = await this.connection
        .getAccountInfo(this.config.wallet.publicKey)
        .catch(async (e) => {
          console.log('error', e);
          await this.sleep(1000);
          return this.connection
            .getAccountInfo(this.config.wallet.publicKey)
            .catch(() => null);
        });

      if (!accountInfo) {
        console.log('FAILED TO FETCH THE WALLETS INFO');
        throw 'FAILED TO FETCH THE WALLETS INFO';
      }

      const rawSol = accountInfo.lamports ?? 0;
      const sol = (accountInfo.lamports ?? 0) / LAMPORTS_PER_SOL;

      const mint = getPubkeyFromStr(tokenAddress);
      if (!mint) {
        console.log('FAILED TO FETCH THE MINT INFO');
        throw 'FAILED TO FETCH THE MINT INFO';
      }

      let tokenAmount = 0;
      let rawTokenAmount = 0;
      try {
        const mintInfo = await getMint(this.connection, mint).catch(() => null);
        if (!mintInfo) {
          throw 'TOKEN INFO NOT FOUND';
        }

        const mintAta = getAssociatedTokenAddressSync(
          mint,
          this.config.wallet.publicKey,
        );
        const ataAccountInfo = await this.connection
          .getAccountInfo(mintAta)
          .catch(async () => {
            await this.sleep(1000);
            return this.connection.getAccountInfo(mintAta).catch(() => null);
          });

        if (!ataAccountInfo) {
          throw 'Failed to fetch atas info';
        }

        const DEVIDER = 10 ** mintInfo.decimals;
        const rawBalance = ataAccountInfo
          ? Number(AccountLayout.decode(ataAccountInfo.data).amount.toString())
          : 0;
        tokenAmount = rawBalance / DEVIDER;
        rawTokenAmount = rawBalance;
      } catch (getBalanceError) {
        console.log({ getBalanceError }, 'Fetching token balance');
        // return;
      }

      const volumeData: VolumeData = {
        poolId,
        tokenAddress,
        wallets: [
          {
            address: this.config.wallet.publicKey,
            privateKey: this.config.wallet,
            sol,
            rawSol,
            tokenAmount,
            rawTokenAmount,
            selected: true,
          },
        ],
        amounts: {
          BUY: Number(this.config.quoteAmount.raw),
          SELL: 100,
        },
        // swapUnitPrice: this.config.unitPrice,
        // swapUnitLimit: this.config.unitLimit,
      };

      return volumeData;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  private async getBundleTxsInfo(
    volumeData: VolumeData,
    swapType: 'BUY' | 'SELL',
    swapSlippage: number,
  ) {
    console.log(`Getting ${swapType} transactions ...`);

    const calcInputDataRes = await calculateSwapInfoFromInput(
      this.connection,
      volumeData,
      swapType,
      swapSlippage,
    ).catch(() => {
      return;
    });

    if (!calcInputDataRes) {
      throw 'FAILED TO PROCESS INPUT DATA';
    }

    if (!calcInputDataRes?.Ok) {
      const err = calcInputDataRes?.Err ?? 'FAILED TO PROCESS INPUT DATA';
      console.log({ calcInputDataRes: err }, 'Calculate input data:');
      throw 'FAILED TO PROCESS INPUT DATA';
    }

    const { swappersInfo, poolKeys, inSufficientWalletsInfo } =
      calcInputDataRes.Ok;
    if (inSufficientWalletsInfo.length > 0) {
      //TODO: may be need to show info which wallet dose not have enough sol to perform swap
      console.log(
        {
          calcInputDataRes1: 'SOME WALLETS DOSE NOT HAVE ENOUGH SOL',
          inSufficientWalletsInfo,
        },
        'Calculate input data:',
      );
      throw 'SOME WALLETS DOSE NOT HAVE ENOUGH SOL';
    }

    const swapsInfo: SwapInfoB[] = [];

    for (const info of swappersInfo) {
      if (info.isSufficientBalance) {
        if (!info.swapInfo) {
          // return { Err: 'FAILED TO CALCULATE SOME AMOUNT' }; //PERF: MAY BE NEVER TRUE
          throw 'FAILED TO CALCULATE SOME AMOUNT';
        }

        swapsInfo.push(info.swapInfo);
      }
    }

    if (swapsInfo.length < 1) {
      console.log(
        { calcInputDataRes3: 'NOT BUY WALLET FOUND' },
        'Check swapper info:',
      );
      throw 'NOT BUY WALLET FOUND';
    }

    const connectivity = getConnectivity(this.connection, this.config.wallet);
    const buyTxsInfo = await connectivity.getMultiSwapTxs({
      swapsInfo,
      fixedSide: 'in',
      poolKeys,
    });

    return buyTxsInfo;
  }

  private sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
}
