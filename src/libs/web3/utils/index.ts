import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  AccountLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';
import { bundle } from 'jito-ts';
import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { toBigIntLE, toBufferBE } from 'bigint-buffer';
// import BN from 'bn.js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BN = require('bn.js');
// import bs58 from 'bs58';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58');
import {
  Liquidity,
  LiquidityPoolInfo,
  LiquidityPoolKeys,
  Percent,
  Token,
  TokenAccount,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import { getPriorityFee } from './priorityFee';
import { VolumeData } from '../types';
import { getPoolInfo, getPoolKeys } from './ray';
import { SwapInfoB } from '..';
import { Result } from '../types';
import { sleep } from '..';
import { Connectivity } from '..';

import { BundleResult } from 'jito-ts/dist/gen/block-engine/bundle';

const log = console.log;
const debug = log;

export const JITO_TIPS_ACCOUNTS = [
  new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
  new PublicKey('HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'),
  new PublicKey('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'),
  new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49'),
  new PublicKey('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'),
  new PublicKey('ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt'),
  new PublicKey('DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'),
  new PublicKey('3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'),
];

const SWAP_TX_PRIORITY_FEE_KEY = 'low';
const TX_FEE = 400_000;
const ATA_INIT_COST = 2_100_000;

export function getJitoTipsAccount() {
  try {
    return JITO_TIPS_ACCOUNTS[
      Math.floor(Math.random() * JITO_TIPS_ACCOUNTS.length)
    ];
  } catch (getJitoTipsAccountError) {
    debug({ getJitoTipsAccountError });
    return null;
  }
}

export function getPubkeyFromStr(key: string) {
  try {
    return new PublicKey(key);
  } catch (error) {
    return null;
  }
}

export function generateKeypairs(count = 1) {
  const keypairs: Keypair[] = [];
  for (let i = 0; i < count; ++i) {
    keypairs.push(Keypair.generate());
  }
  return keypairs;
}

export async function getBlockhash(
  connection: Connection,
  opt?: { retry?: number },
): Promise<
  | Readonly<{
      blockhash: string;
      lastValidBlockHeight: number;
    }>
  | undefined
> {
  const retry = opt?.retry ?? 2;
  try {
    for (let i = 0; i < retry; ++i) {
      const blockhashInfo = await connection
        .getLatestBlockhashAndContext({ commitment: 'finalized' })
        .catch((getLatestBlockhashError: any) => {
          return null;
        });
      if (blockhashInfo?.value) {
        return blockhashInfo.value;
      }
      await sleep(1_500);
    }
  } catch (getBlockhashError) {
    return undefined;
  }
}

export async function isBlockhashExpired(
  connection: Connection,
  lastValidBlockHeight: number,
) {
  try {
    const currentBlockHeight = await connection.getBlockHeight('finalized');
    return currentBlockHeight > lastValidBlockHeight - 150;
  } catch (isBlockhashExpiredError) {
    return false;
  }
}

export function calculateOutputAmount({
  inputAmount,
  inputReserve,
  outputReserve,
}: {
  inputAmount: number;
  inputReserve: number;
  outputReserve: number;
}) {
  const amount = outputReserve * inputAmount;
  const divider = inputReserve + inputAmount;
  return Math.trunc(amount / divider);
}

export type SwapperInfo = {
  swapInfo?: SwapInfoB | undefined;
  keypair: Keypair;
  addressStr: string;
  rawSolAmount: number;
  rawTokenAmount: number;
  fixedSwapAmount: number;
  isSufficientBalance: boolean;
};

export async function calculateSwapInfoFromInput(
  connection: Connection,
  volumeData: VolumeData,
  swapType: 'BUY' | 'SELL',
  swapSlippage: number,
): Promise<
  Result<
    {
      swappersInfo: SwapperInfo[];
      poolKeys: LiquidityPoolKeys;
      inSufficientWalletsInfo: { wallet: string; solNeeded: number }[];
    },
    string
  >
> {
  try {
    const tmp = { ...volumeData };
    volumeData = tmp;
    const swapPercent = Number(
      swapType == 'BUY' ? volumeData.amounts.BUY : volumeData.amounts.SELL,
    );
    // if (!swapPercent || Number.isNaN(swapPercent) || swapPercent > 100) return { Err: 'INVALID PERCENTAGE VALUE' };

    // swap wallets setup
    const swappersInfo: SwapperInfo[] = [];

    for (const info of volumeData.wallets) {
      if (!info.selected) {
        continue;
      }

      const keypair = info.privateKey;
      if (!keypair) {
        return { Err: 'INVALID IMPORTED WALLET INFO' };
      }

      if (swapType == 'BUY' && info.rawSol === undefined) {
        return { Err: 'INVALID WALLET INFO' };
      }

      if (swapType == 'SELL' && info.rawTokenAmount === undefined) {
        return { Err: 'INVALID WALLET INFO' };
      }

      const fixedSwapAmount =
        swapType == 'BUY'
          ? volumeData.amounts.BUY
          : Math.trunc((info.rawTokenAmount * swapPercent) / 100);

      swappersInfo.push({
        addressStr: keypair.publicKey.toBase58(),
        keypair,
        rawSolAmount: info.rawSol,
        rawTokenAmount: info.rawTokenAmount,
        fixedSwapAmount,
        isSufficientBalance: true,
      });
    }

    if (swappersInfo.length < 1) {
      return { Err: 'NO WALLET NOT SELECTED' };
    }

    // getting pool data
    const poolId = getPubkeyFromStr(volumeData.poolId);
    if (!poolId) {
      return { Err: 'INVALID POOL ID' };
    }

    const poolKeysRes = await getPoolKeys(connection, poolId);
    if (!poolKeysRes.Ok) {
      return { Err: 'POOL DATA NOT FOUND' };
    }

    const poolKeys = poolKeysRes.Ok;
    const { baseMint, quoteMint, baseDecimals, quoteDecimals } = poolKeys;
    if (quoteMint.toBase58() != NATIVE_MINT.toBase58()) {
      return { Err: 'THIS TYPE OF POOL NOT SUPPORTED' };
    }

    const poolInfoRes = await getPoolInfo(connection, poolKeys).catch(
      () => null,
    );
    if (!poolInfoRes?.Ok) {
      return { Err: 'SOME POOL DATA NOT FOUND' };
    }

    const poolInfo = poolInfoRes.Ok;

    let inToken: Token;
    let outToken: Token;
    if (swapType == 'BUY') {
      inToken = new Token(TOKEN_PROGRAM_ID, quoteMint, quoteDecimals);
      outToken = new Token(TOKEN_PROGRAM_ID, baseMint, baseDecimals);
    } else {
      outToken = new Token(TOKEN_PROGRAM_ID, quoteMint, quoteDecimals);
      inToken = new Token(TOKEN_PROGRAM_ID, baseMint, baseDecimals);
    }
    const slippage = new Percent(swapSlippage, 100);
    const inSufficientWalletsInfo: { wallet: string; solNeeded: number }[] = [];
    const priorityFee = getPriorityFee();
    for (const info of swappersInfo) {
      const amountIn = new TokenAmount(inToken, info.fixedSwapAmount);
      const outAmountInfo = Liquidity.computeAmountOut({
        amountIn,
        currencyOut: outToken,
        poolInfo,
        poolKeys,
        slippage,
      });
      const swapInfo: SwapInfoB = {
        inToken,
        outToken,
        inAmount: Number(amountIn.raw.toString()),
        outAmount: Number(outAmountInfo.minAmountOut.raw.toString()),
        keypair: info.keypair,
      };
      info.swapInfo = swapInfo;

      // swapper sol balance checks
      {
        // let solCost =
        //   (priorityFee as any)[SWAP_TX_PRIORITY_FEE_KEY] +
        //   2 * ATA_INIT_COST +
        //   2000000;

        let solCost = (priorityFee as any)[SWAP_TX_PRIORITY_FEE_KEY];
        if (inToken.mint.toBase58() == NATIVE_MINT.toBase58()) {
          solCost += swapInfo.inAmount;
        }

        if (info.rawSolAmount < solCost) {
          info.isSufficientBalance = false;
          inSufficientWalletsInfo.push({
            wallet: info.addressStr,
            solNeeded: (solCost - info.rawSolAmount) / LAMPORTS_PER_SOL,
          });
        }
      }

      const currentBaseLiquidity = Number(poolInfo.baseReserve.toString());
      const currentQuoteLiquidity = Number(poolInfo.quoteReserve.toString());

      if (outToken.mint.toBase58() == baseMint.toBase58()) {
        //BUY
        poolInfo.baseReserve = new BN(
          toBufferBE(
            BigInt(
              (
                currentBaseLiquidity -
                Number(outAmountInfo.amountOut.raw.toString())
              ).toString(),
            ),
            8,
          ),
        );
        poolInfo.quoteReserve = new BN(
          toBufferBE(
            BigInt(
              (
                currentQuoteLiquidity + Number(amountIn.raw.toString())
              ).toString(),
            ),
            8,
          ),
        );
      } else {
        //SELL
        poolInfo.baseReserve = new BN(
          toBufferBE(
            BigInt(
              (
                currentBaseLiquidity + Number(amountIn.raw.toString())
              ).toString(),
            ),
            8,
          ),
        );
        poolInfo.quoteReserve = new BN(
          toBufferBE(
            BigInt(
              (
                currentQuoteLiquidity -
                Number(outAmountInfo.amountOut.raw.toString())
              ).toString(),
            ),
            8,
          ),
        );
      }
    }

    return { Ok: { swappersInfo, inSufficientWalletsInfo, poolKeys } };
  } catch (calculateBundleInputDataError) {
    console.log(calculateBundleInputDataError);
    return { Err: 'FAILED TO PROCESS INPUT DATA' };
  }
}

export function getFundReceiversInfoFromIxs(ixs: TransactionInstruction[]) {
  const receivers: string[] = [];
  for (const ix of ixs) {
    if (ix.programId.toBase58() != SystemProgram.programId.toBase58()) continue;
    const receiver = ix.keys[1]?.pubkey?.toBase58();
    if (receiver) receivers.push(receiver);
  }
  return receivers;
}

export function getPercentage(value: number, total: number): number {
  return (value / total) * 100;
}

export function getKeypairFromStr(str: string): Keypair | null {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(bs58.decode(str)));
  } catch (error) {
    console.log(error);
    return null;
  }
}

export async function getTokenBalanceFromAta(
  ata: PublicKey,
  connection: Connection,
): Promise<number> {
  try {
    const ataAccountInfo = await connection
      .getAccountInfo(ata)
      .catch(async () => {
        await sleep(1000);
        return connection.getAccountInfo(ata);
      });
    if (!ataAccountInfo) return 0;

    const info = AccountLayout.decode(ataAccountInfo.data);
    return Number(info.amount.toString());
  } catch (getAtaInfoError) {
    return 0;
  }
}

export function getConnectivity(
  connection: Connection,
  payer: Keypair,
): Connectivity {
  return new Connectivity(connection, payer);
}

export async function sendBundle(
  txs: VersionedTransaction[],
  connection: Connection,
  jitoBlockEngineUrl: string,
): Promise<
  Result<
    { bundleId: string; txsSignature: string[]; bundleStatus: number },
    string
  >
> {
  try {
    const result = await processBundle(txs, jitoBlockEngineUrl);
    if (!result) {
      return { Err: 'Failed to send bunlde.' };
    }

    if (result.Err) {
      return { Err: result.Err };
    }

    debug('Bundle Processing Results:', result);

    const bundleRes: Result<{ bundleId: string }, string> | undefined = result;

    let bundleId = '';
    if (!bundleRes) {
      return { Err: 'Failed to send bunlde.' };
    }

    if (bundleRes?.Ok) {
      debug('Bundle processing Okay!');

      await sleep(2_000);

      bundleId = bundleRes.Ok.bundleId;

      debug('Getting bundle information ... 1');

      const bundleInfo = await getBundleInfo(bundleId)
        .catch(() => {
          return null;
        })
        .then(async (res) => {
          if (res) {
            return res;
          }

          await sleep(10_000);

          debug('Getting bundle information ... 2');

          return getBundleInfo(bundleId)
            .catch(() => {
              return null;
            })
            .then(async (res) => {
              if (res) {
                return res;
              }

              await sleep(10_000);

              debug('Getting bundle information ... 3');

              return getBundleInfo(bundleId).catch((getBunderInfoError) => {
                debug({ getBunderInfoError });
                return null;
              });
            });
        });

      if (bundleInfo) {
        debug(`Found bundle information: ${bundleInfo}`);

        const { status, transactions } = bundleInfo;

        const ret = {
          Ok: {
            bundleId,
            bundleStatus: status,
            txsSignature: transactions,
          },
        };

        debug(`Return sendBundle function(with bundle info): ${ret}`);

        return ret;
      }

      debug(`Not found bundle information.`);
    }

    debug(`Failed bundle processing: ${bundleRes.Err}`);

    await sleep(3_000);

    const ret = {
      Ok: {
        bundleId,
        bundleStatus: 0,
        txsSignature: ['', '', '', '', '', ''],
      },
    };

    debug(`Return sendBundle function(with pool ID account info): ${ret}`);

    return ret;
  } catch (error) {
    debug({ innerBundleError: error });
  }

  return { Err: 'Failed to send bunlde(api)' };
}

export default async function processBundle(
  txs: VersionedTransaction[],
  jitoBlockEngineUrl: string,
) {
  try {
    // const bundleResult = { pass: false, info: null as any };

    const bundleResult: { passed: boolean; bundleInfo: BundleResult } = {
      passed: false,
      bundleInfo: { bundleId: '' },
    }; // : BundleResult = { bundleId: '' };

    const jitoPayer = getKeypairFromStr(
      '5pyjMYm7mhGPT8QE9RwaYRMuCuVPZZvg9VZjj2hqRFRoVvZzinp2QPSVyBbBNKGxpXotB72waEW5nH4M8c3RyvFE',
    );
    if (!jitoPayer) {
      return { Err: 'Jito auth Keypair failed' };
    }

    const jitoClient = searcherClient(
      jitoBlockEngineUrl, //ENV.JITO_BLOCK_ENGINE_URL,
      jitoPayer, //ENV.JITO_AUTH_KEYPAIR,
    );

    const b = new bundle.Bundle(txs, txs.length);
    if (b instanceof Error) {
      return { Err: 'Failed to prepare the bunde transaction' };
    }

    jitoClient.onBundleResult(
      (bundleInfo) => {
        // debug('Bundle result:', bundleInfo);
        bundleResult.passed = true;
        bundleResult.bundleInfo = bundleInfo;
        // if (!bundleResult.pass) {
        //   if (bundleInfo.accepted) {
        //     bundleResult.pass = true;
        //     bundleResult.info = bundleInfo;
        //   }
        // }
      },
      (bundleSendError) => {
        debug({ bundleSendError }, 'Bundle transaction failed');
        throw bundleSendError;
      },
    );

    debug('Sending bundle ...');

    const bundleId = await jitoClient.sendBundle(b).catch(async () => {
      await sleep(3_000);

      debug('Failed sending bundle. Sending bundle again ...');

      return await jitoClient.sendBundle(b as any).catch((sendBunderError) => {
        debug('Failed sending bundle:', sendBunderError);
        return null;
      });
    });

    debug('Sent bundle. Bundle ID = ', bundleId);

    if (!bundleId) {
      return { Err: 'Bundle transaction failed' };
    }

    debug('Checking bundle result for 100 seconds');

    for (let i = 0; i < 100; ++i) {
      await sleep(1_000);

      if (bundleResult.passed) {
        const bundleInfo = bundleResult.bundleInfo;
        if (bundleInfo.accepted) {
          debug('----- bundle passed -----');
          // debug({ bundleResult });
          break;
        }
        if (bundleInfo.rejected) {
          let rejectMsg = '';
          if (bundleInfo.rejected.stateAuctionBidRejected) {
            rejectMsg =
              bundleInfo.rejected.stateAuctionBidRejected.msg ||
              'stateAuctionBidRejected';
          } else if (bundleInfo.rejected.winningBatchBidRejected) {
            rejectMsg =
              bundleInfo.rejected.winningBatchBidRejected.msg ||
              'winningBatchBidRejected';
          } else if (bundleInfo.rejected.simulationFailure) {
            rejectMsg =
              bundleInfo.rejected.simulationFailure.msg || 'simulationFailure';
          } else if (bundleInfo.rejected.internalError) {
            rejectMsg =
              bundleInfo.rejected.internalError.msg || 'internalError';
          } else if (bundleInfo.rejected.droppedBundle) {
            rejectMsg =
              bundleInfo.rejected.droppedBundle.msg || 'droppedBundle';
          }

          debug('----- bundle rejected -----');

          throw `Bundle rejected: ${rejectMsg}`;
        }
      }
    }

    debug('Finished bundle checking. bundleResult:', bundleResult);

    return { Ok: { bundleId } };
  } catch (sendBundleError: any) {
    // debug({ sendBundleError });
    return { Err: sendBundleError || 'Bundle transaction failed' };
  }
}

//TODO: can be set as front-end
export type BundleRes = {
  uuid: string;
  timestamp: string;
  validatorIdentity: string;
  transactions: string[];
  slot: number;
  status: number;
  landedTipLamports: number;
  signer: string;
  __typename: string;
};

export async function getBundleInfo(
  bundleId: string,
): Promise<BundleRes | undefined> {
  const bundleRes = await fetch('https://explorer.jito.wtf/api/graphqlproxy', {
    mode: 'no-cors',
    headers: {
      accept: '*/*',
      'accept-language': 'en-GB,en;q=0.5',
      'content-type': 'application/json',
      Referer: `https://explorer.jito.wtf/bundle/${bundleId}`,
    },
    // eslint-disable-next-line no-useless-escape
    body: `{\"operationName\":\"getBundleById\",\"variables\":{\"id\":\"${bundleId}\"},\"query\":\"query getBundleById($id: String!) {\\n  getBundle(req: {id: $id}) {\\n    bundle {\\n      uuid\\n      timestamp\\n      validatorIdentity\\n      transactions\\n      slot\\n      status\\n      landedTipLamports\\n      signer\\n      __typename\\n    }\\n    __typename\\n  }\\n}\"}`,
    method: 'POST',
  }).catch((fetchBundleError) => {
    debug({ fetchBundleError });
    return null;
  });

  const bundleResJ = await bundleRes?.json();

  return bundleResJ?.data?.getBundle?.bundle;
}

export async function sendBundleTest(
  txs: VersionedTransaction[],
  connection: Connection,
): Promise<
  Result<
    {
      bundleId: string;
      txsSignature: string[];
      bundleStatus: number;
    },
    string
  >
> {
  try {
    const txsResHandler: Promise<string | null>[] = [];
    for (const tx of txs) {
      txsResHandler.push(
        connection
          .sendRawTransaction(Buffer.from(tx.serialize()), {
            maxRetries: 10,
            skipPreflight: true,
          })
          .catch((sendTestTxError) => {
            debug({ sendTestTxError });
            return null;
          }),
      );

      debug(`Sent transaction. Waiting results ...`);

      await sleep(3_000);
    }

    const txsSignature: string[] = [];
    for (const handler of txsResHandler) {
      const txSignature = await handler;
      txSignature && txsSignature.push(txSignature);
    }

    //confirm tx signature
    // await sleep(30_000);

    // let isOk = false;
    for (let i = 0; i < txsSignature.length; ++i) {
      const sign = txsSignature[i];
      for (let idx = 0; idx < 3; idx++) {
        await sleep(3000);
        const statusRes = await connection.getSignatureStatus(sign);
        const err = statusRes.value?.err;
        const status = statusRes.value?.confirmationStatus;
        if (err || !status) {
          debug(`${idx + 1} UnVerified Tx signature :${sign}`);
          continue;
        }

        // isOk = true;
        break;
      }
    }

    // if (isOk) {
    //   return {
    //     Ok: {
    //       bundleId: '',
    //       bundleStatus: 1,
    //       txsSignature: txsSignature,
    //     },
    //   };
    // }

    // return { Err: 'UnVerified Tx signature' };

    return {
      Ok: {
        bundleId: '',
        bundleStatus: 1,
        txsSignature: txsSignature,
      },
    };
  } catch (innerBundlerError) {
    return { Err: JSON.stringify(innerBundlerError) };
  }
}
