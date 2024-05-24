import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  AccountLayout as TokenAccountLayout,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  getAccount,
  createSyncNativeInstruction,
  createBurnInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Liquidity,
  LiquidityPoolInfo,
  LiquidityPoolKeys,
  Percent,
  PoolInfoLayout,
  SwapSide,
  Token,
  TokenAmount,
  TxVersion,
} from '@raydium-io/raydium-sdk';
import {
  // SendBuyersSideAirdropInput,
  // SendBuyersTxsResult,
  TransferInfoFromIxs as TransferInfoFromIxs,
  Web3PassTxResult,
  Web3SendTxInput,
  Web3SendTxOpt,
  Web3SendTxResult,
  Web3SignedSendTxOpt,
} from './types';

import { Result, TxPassResult } from './types';
import {
  TxFailReason,
  TxFailResult,
  Web3BundleError,
  Web3Error,
} from './errors';
import { getBlockhash } from './utils';
import { isBlockhashExpired } from './utils';
import { getPriorityFee } from './utils/priorityFee';
import { getPoolKeys } from './utils/ray';

const log = console.log;
const debug = log;

const MAX_TX_FEE = 800_000;

const SWAP_TX_PRIORITY_FEE_KEY = 'low';

export type RevokeTokenAuthorityInput = {
  minting?: boolean;
  freezing?: boolean;
  mint: string;
};

export type SwapInfoB = {
  inAmount: number;
  outAmount: number;
  inToken: Token;
  outToken: Token;
  keypair: Keypair;
};

export type SendMultiSwapTxsInput = {
  poolKeys: LiquidityPoolKeys;
  swapsInfo: SwapInfoB[];
  fixedSide: SwapSide;
};

export type SendMultiSwapTxsRes = {
  txsSignature: string[]; //TODO: temp
  successSwapers: string[];
  failSwapers: string[];
};

export class Connectivity {
  private payerKey: Keypair;
  private connection: Connection;
  private txCooldownLockGuard: boolean;

  constructor(connection: Connection, payer: Keypair) {
    this.payerKey = payer;
    this.connection = connection;
    this.txCooldownLockGuard = false;
  }

  private async sendSignedTransaction(
    tx: VersionedTransaction,
    txInfo: Web3SendTxInput,
    opt: Web3SignedSendTxOpt,
  ): Promise<Result<Web3PassTxResult, TxFailResult>> {
    let txSignature: undefined | string = undefined;
    const { passInfo, skipSimulation } = opt ?? {};
    try {
      tx.serialize();
    } catch (e) {
      return {
        Err: {
          reason: TxFailReason.SIGNATURE_VERIFICATION_FAILD,
          txInfo,
          passInfo,
        },
      };
    }

    try {
      const txStatus = {
        // value: false,
        isBlockhashExpired: 0,
        isNetworkIssue: false,
        // isError: false,
      };

      txSignature = await this.connection
        .sendRawTransaction(Buffer.from(tx.serialize()), {
          // skipPreflight: true,
          maxRetries: 20,
        })
        .catch((sendTransactionError) => {
          const message = sendTransactionError?.message;
          const stack = sendTransactionError?.stack;
          if (message == 'Failed to fetch') {
            txStatus.isNetworkIssue = true;
          }

          debug({ sendTransactionError });

          return undefined;
        });

      if (!txSignature) {
        if (txStatus.isNetworkIssue) {
          return {
            Err: { reason: TxFailReason.NETWORK_ISSUE, txInfo, passInfo },
          };
        }

        return { Err: { reason: TxFailReason.UNKNOWN, txInfo, passInfo } };
      }

      try {
        if (!skipSimulation) {
          const simulationInfo = (
            await this.connection.simulateTransaction(tx).catch(() => null)
          )?.value;
          if (simulationInfo?.err) {
            const err = simulationInfo?.err;
            if (err === 'BlockhashNotFound') {
              // debug({ simulationInfo });
              // return {
              //   Err: {
              //     reason: TxFailReason.EXPIRED,
              //     txInfo,
              //     txSignature,
              //     msg: 'Simulation failed (BlockhashNotFound)',
              //     passInfo,
              //   },
              // };
            } else if (err === 'AlreadyProcessed') {
              // const signatureInfo = (await this.connection.getSignatureStatus(txSignature).catch(() => null))?.value
              // if (signatureInfo?.err) {
              //   return {
              //     Err: {
              //       reason: TxFailReason.UNKNOWN,
              //       txInfo,
              //       txSignature,
              //       msg: 'Simulation failed (AlreadyProcessed)',
              //       passInfo,
              //     },
              //   };
              // }
            } else {
              debug({ simulationInfo });

              return {
                Err: {
                  reason: TxFailReason.UNKNOWN,
                  txInfo,
                  txSignature,
                  msg: 'Simulation failed',
                  passInfo,
                },
              };
            }
          }
        }
      } catch (failedToSimulateTx) {
        debug({ failedToSimulateTx });
      }

      const { lastValidBlockHeight, blockhash } = opt.blockhashInfo;

      for (let i = 0; i < 40; ++i) {
        await sleep(3_000);

        const info = (
          await this.connection
            .getSignatureStatus(txSignature, { searchTransactionHistory: true })
            .catch(async (getSignatureStatusError) => {
              // debug({ getSignatureStatusError })
              return null;
            })
        )?.value;

        if (info) {
          const { err, confirmationStatus } = info;

          if (err) {
            debug({ errTxSignatureStatusInfo: info });

            return {
              Err: {
                reason: TxFailReason.UNKNOWN,
                txInfo,
                msg: 'Tx Signature status error',
                passInfo,
                txSignature,
              },
            };
          }

          if (confirmationStatus) {
            if (
              confirmationStatus == 'confirmed' ||
              confirmationStatus == 'finalized'
            )
              return {
                Ok: {
                  input: txInfo,
                  txSignature,
                  passInfo,
                },
              };
          }
        }

        if (await isBlockhashExpired(this.connection, lastValidBlockHeight)) {
          txStatus.isBlockhashExpired += 1;
        }

        if (txStatus.isBlockhashExpired > 1) {
          debug('blockhash expired : ', i);
          return {
            Err: {
              reason: TxFailReason.EXPIRED,
              txInfo: txInfo,
              msg: 'Transaction blockhash expired',
              passInfo,
              txSignature,
            },
          };
        }
      }

      const signatureInfo = (
        await this.connection
          .getSignatureStatus(txSignature)
          .catch((getSignatureStatusError) => {
            debug({ getSignatureStatusError });
            return null;
          })
      )?.value;

      if (signatureInfo) {
        const err = signatureInfo?.err;
        if (err) {
          debug({ signatureInfo });
          if (err == 'BlockhashNotFound')
            return {
              Err: {
                reason: TxFailReason.EXPIRED,
                txInfo,
                txSignature,
                passInfo,
              },
            };
          return { Err: { reason: TxFailReason.UNKNOWN, txInfo, txSignature } };
        } else return { Ok: { txSignature, input: txInfo, passInfo } };
      }

      return {
        Err: { reason: TxFailReason.EXPIRED, txInfo, txSignature, passInfo },
      };
    } catch (sendSignedTransactionError) {
      debug({ sendSignedTransactionError });
      return { Err: { reason: TxFailReason.UNKNOWN, txInfo, passInfo } };
    }
  }

  async sendTransaction(
    txInfo: Web3SendTxInput,
    opt?: Web3SendTxOpt,
  ): Promise<Web3SendTxResult> {
    const txSignature: undefined | string = undefined;
    const passInfo = opt?.passInfo;

    txInfo.lutsInfo = txInfo.lutsInfo ?? [];
    // debug({ opt })
    try {
      const { ixs, signers } = txInfo;
      const { skipWalletsign, skipIncTxFee } = opt ?? {};
      const txFee = opt?.txFee ?? MAX_TX_FEE;
      const incTxFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: txFee,
      });

      while (this.txCooldownLockGuard) {
        await sleep(1_000);
      }

      this.txCooldownLockGuard = true;

      await sleep(5_000);

      // if (!skipWalletsign) {
      //   payerKey = this.provider.publicKey;
      // } else {
      //   if (!signers || signers.length < 1) {
      //     return {
      //       Err: { reason: TxFailReason.TX_SIGNER_NOT_FOUND, txInfo, passInfo },
      //     };
      //   }
      //   payerKey = signers[0].publicKey;
      // }

      const blockhashInfo = await getBlockhash(this.connection);
      if (!blockhashInfo) {
        return {
          Err: { reason: TxFailReason.NETWORK_ISSUE, txInfo, passInfo },
        };
      }

      const recentBlockhash = blockhashInfo.blockhash;
      const msg = new TransactionMessage({
        instructions: skipIncTxFee ? ixs : [incTxFeeIx, ...ixs],
        payerKey: this.payerKey.publicKey,
        recentBlockhash,
      }).compileToV0Message(txInfo.lutsInfo);

      let tx = new VersionedTransaction(msg);

      // debug(`len: ${tx.serialize().length}`)
      // if (!skipWalletsign) {
      //   const signedTx = await this.provider.wallet.signTransaction(tx).catch(() => null);
      //   if (!signedTx) {
      //     this.txCooldownLockGuard = false;
      //     return {
      //       Err: { reason: TxFailReason.FAILED_TO_SIGN_TX, txInfo, passInfo },
      //     };
      //   }
      //   tx = signedTx;
      // }

      if (signers && signers.length > 0) {
        tx.sign(signers);
      }

      this.txCooldownLockGuard = false;

      return this.sendSignedTransaction(tx, txInfo, {
        blockhashInfo,
        passInfo,
        skipSimulation: opt?.skipSimulation,
      });
    } catch (sendTransactionError) {
      debug({ sendTransactionError, passInfo });
      this.txCooldownLockGuard = false;
      return {
        Err: { reason: TxFailReason.UNKNOWN, txInfo, txSignature, passInfo },
      };
    }
  }

  private async getSwapIxs(
    user: PublicKey,
    input: SwapInfoB,
    poolKeys: LiquidityPoolKeys,
    fixedSide: SwapSide,
  ) {
    try {
      const { inToken, outToken } = input;
      const inAmount = input.inAmount;
      const outAmount = input.outAmount;
      const tokenAccountIn = getAssociatedTokenAddressSync(inToken.mint, user);
      const tokenAccountOut = getAssociatedTokenAddressSync(
        outToken.mint,
        user,
      );
      const accountInfos = await this.connection
        .getMultipleAccountsInfo([tokenAccountIn, tokenAccountOut])
        .catch(async () => {
          await sleep(1000);
          return this.connection
            .getMultipleAccountsInfo([tokenAccountIn, tokenAccountOut])
            .catch((getMultipleAccountsInfoError) => {
              debug({ getMultipleAccountsInfoError });
              return null;
            });
        });
      if (!accountInfos) throw 'failed to fetch some data';
      const ixs: TransactionInstruction[] = [];
      const [inAtaInfo, outAtaInfo] = accountInfos;
      if (!inAtaInfo)
        ixs.push(
          createAssociatedTokenAccountInstruction(
            user,
            tokenAccountIn,
            user,
            inToken.mint,
          ),
        );
      if (!outAtaInfo)
        ixs.push(
          createAssociatedTokenAccountInstruction(
            user,
            tokenAccountOut,
            user,
            outToken.mint,
          ),
        );
      if (inToken.mint.toBase58() == NATIVE_MINT.toBase58()) {
        const sendSolIx = SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: tokenAccountIn,
          lamports: BigInt(inAmount),
        });
        const syncWSolAta = createSyncNativeInstruction(
          tokenAccountIn,
          TOKEN_PROGRAM_ID,
        );
        ixs.push(sendSolIx, syncWSolAta);
      }
      const swapIxs = Liquidity.makeSwapInstruction({
        amountIn: inAmount.toString(),
        amountOut: outAmount.toString(),
        fixedSide,
        poolKeys,
        userKeys: {
          owner: user,
          tokenAccountIn,
          tokenAccountOut,
        },
      }).innerTransaction.instructions;
      ixs.push(...swapIxs);
      return ixs;
    } catch (getSwapIxsError) {
      debug({ getSwapIxsError });
      return null;
    }
  }

  private async getMultiSwapTxxInfo(
    input: SwapInfoB[],
    poolKeys: LiquidityPoolKeys,
    fixedSide: SwapSide,
  ) {
    try {
      const txsInfo: { ixs: TransactionInstruction[]; keypairs: Keypair[] }[] =
        [];
      let ixs: TransactionInstruction[] = [];
      const CHUNK_SIZE = 2;
      let kps: Keypair[] = [];
      for (let i = 1; i <= input.length; ++i) {
        const info = input[i - 1];
        const kp = info.keypair;
        const user = kp.publicKey;
        kps.push(kp);
        const _ixs = await this.getSwapIxs(user, info, poolKeys, fixedSide);
        if (!_ixs) throw 'FAILED TO PREAPRE BUY TXS';
        ixs.push(..._ixs);
        if (i % CHUNK_SIZE == 0) {
          txsInfo.push({ ixs, keypairs: kps });
          ixs = [];
          kps = [];
        }
      }
      if (ixs.length > 0) {
        txsInfo.push({ ixs, keypairs: kps });
        ixs = [];
        kps = [];
      }
      return txsInfo;
    } catch (getBuyerSwapIxsError) {
      debug({ getBuyerSwapIxsError });
      return null;
    }
  }

  async getMultiSwapTxs(input: SendMultiSwapTxsInput): Promise<
    Result<
      {
        ixs: TransactionInstruction[];
        keypairs: Keypair[];
      },
      string
    >
  > {
    try {
      const { swapsInfo, poolKeys, fixedSide } = input;
      const txsInfo = await this.getMultiSwapTxxInfo(
        swapsInfo,
        poolKeys,
        fixedSide,
      );
      if (!txsInfo || !txsInfo[0]) {
        return { Err: 'FAILED TO PREPARE FAILED TXS' };
      }

      return { Ok: txsInfo[0] };
    } catch (getTxsBundlesError) {
      debug({ getTxsBundlesError });
      return { Err: Web3BundleError.BUNDLER_FAILED_TO_PREPARE };
    }
  }

  async sendMultiSwapTxs(
    input: SendMultiSwapTxsInput,
  ): Promise<Result<SendMultiSwapTxsRes, string>> {
    try {
      const { swapsInfo, poolKeys, fixedSide } = input;
      const txsInfo = await this.getMultiSwapTxxInfo(
        swapsInfo,
        poolKeys,
        fixedSide,
      );
      if (!txsInfo) {
        return { Err: 'FAILED TO PREPARE FAILED TXS' };
      }

      const priorityFeeInfo = getPriorityFee();
      const txFee = (priorityFeeInfo as any)[SWAP_TX_PRIORITY_FEE_KEY];
      const txsHandler: Promise<Web3SendTxResult>[] = [];
      for (const info of txsInfo) {
        const opt: Web3SendTxOpt = {
          skipSimulation: true,
          txFee,
          skipWalletsign: true,
        };
        opt.passInfo = info.keypairs.map((e) => e.publicKey.toBase58());

        txsHandler.push(
          this.sendTransaction(
            { ixs: info.ixs, signers: info.keypairs },
            opt,
          ).then((res) => {
            if (
              res.Err?.reason == TxFailReason.EXPIRED ||
              res.Err?.reason == TxFailReason.NETWORK_ISSUE
            ) {
              return this.sendTransaction(res.Err.txInfo, opt);
            }
            return res;
          }),
        );
      }

      const txsSignature: string[] = [];
      const successSwapers: string[] = [];
      const failSwapers: string[] = [];

      for (const handler of txsHandler) {
        const res = await handler;
        if (res.Ok) {
          txsSignature.push(res.Ok.txSignature);
          successSwapers.push(...res.Ok.passInfo);
        } else if (res.Err) {
          failSwapers.push(...res.Err.passInfo);
        }
      }

      return {
        Ok: {
          txsSignature,
          successSwapers,
          failSwapers,
        },
      };
    } catch (innerLaunchBundleError) {
      debug({ innerLaunchBundleError });
      return { Err: Web3BundleError.BUNDLER_FAILED_TO_PREPARE };
    }
  }
}

export const sleep = (ms = 0) =>
  new Promise((resolve) => setTimeout(resolve, ms));
