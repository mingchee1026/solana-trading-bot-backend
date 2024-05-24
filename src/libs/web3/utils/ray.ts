import { Connection, PublicKey } from '@solana/web3.js';
import {
  LIQUIDITY_STATE_LAYOUT_V5,
  Liquidity,
  LiquidityPoolInfo,
  LiquidityPoolKeys,
  LiquidityStateV4,
  LiquidityStateV5,
  MARKET_VERSION_TO_STATE_LAYOUT,
  Market,
  Structure,
} from '@raydium-io/raydium-sdk';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';
import { Result } from '../types';
import { sleep } from '..';
import { BN } from 'bn.js';
import { toBufferBE } from 'bigint-buffer';
import { AccountLayout, MintLayout } from '@solana/spl-token';

export enum GetPoolKeysError {
  INVALID_POOL_DATA_LENGTH = 'INVALID_POOL_DATA_LENGTH',
  INVALID_POOL_ID = 'INVALID_POOL_ID',
  POOL_NOT_FOUND = 'POOL_NOT_FOUND',
  MARKET_INFO_NOT_FOUND = 'MARKET_INFO_NOT_FOUND',
  INVALID_POOL_INFO_FOUND = 'INVALID_POOL_INFO_FOUND',
  UNKNWON_ERROR = 'UNKNWON_ERROR',
}
export enum GetMarketStateError {
  MARKET_INFO_NOT_FOUND,
}
export enum GetPoolInfoError {
  INVALID_INFO,
  UNKNWON_ERROR = 'UNKNWON_ERROR',
}

const todo = null as any;
const log = console.log;
export async function getMarketState(
  connection: Connection,
  marketId: PublicKey,
): Promise<Result<any, GetMarketStateError>> {
  const marketAccountInfo = await connection
    .getAccountInfo(marketId)
    .catch((error) => null)
    .then(async (res) => {
      await sleep(1200);
      return connection.getAccountInfo(marketId);
    });
  //TODO: extra check about the market id
  if (!marketAccountInfo)
    return { Err: GetMarketStateError.MARKET_INFO_NOT_FOUND };
  const marketState = Market.getLayouts(3).state.decode(marketAccountInfo.data);
  return { Ok: marketState };
}

export async function getPoolKeys(
  connection: Connection,
  poolId: PublicKey,
): Promise<Result<LiquidityPoolKeys, GetPoolKeysError>> {
  try {
    const accountInfo = await connection
      .getAccountInfo(poolId)
      .catch(() => null)
      .then(async (res) => {
        if (res) return res;
        await sleep(1_200);
        return connection.getAccountInfo(poolId);
      });
    if (!accountInfo) return { Err: GetPoolKeysError.POOL_NOT_FOUND };
    let poolState: LiquidityStateV4 | LiquidityStateV5 | undefined = undefined;
    let version: 4 | 5 | undefined = undefined;
    const poolAccountOwner = accountInfo.owner;
    if (accountInfo.data.length == LIQUIDITY_STATE_LAYOUT_V4.span) {
      poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);
      version = 4;
    } else if (accountInfo.data.length == LIQUIDITY_STATE_LAYOUT_V5.span) {
      poolState = LIQUIDITY_STATE_LAYOUT_V5.decode(accountInfo.data);
      version = 5;
    } else return { Err: GetPoolKeysError.INVALID_POOL_DATA_LENGTH };
    if (!poolState || !version)
      return { Err: GetPoolKeysError.INVALID_POOL_ID };

    const {
      authority,
      baseDecimals,
      baseMint,
      baseVault,
      configId,
      id,
      lookupTableAccount,
      lpDecimals,
      lpMint,
      lpVault,
      marketAuthority,
      marketId,
      marketProgramId,
      marketVersion,
      nonce,
      openOrders,
      programId,
      quoteDecimals,
      quoteMint,
      quoteVault,
      targetOrders,
      // version,
      withdrawQueue,
    } = Liquidity.getAssociatedPoolKeys({
      baseMint: poolState.baseMint,
      baseDecimals: poolState.baseDecimal.toNumber(),
      quoteMint: poolState.quoteMint,
      quoteDecimals: poolState.quoteDecimal.toNumber(),
      marketId: poolState.marketId,
      marketProgramId: poolState.marketProgramId,
      marketVersion: 3,
      programId: poolAccountOwner,
      version,
    });
    if (lpMint.toBase58() != poolState.lpMint.toBase58()) {
      return { Err: GetPoolKeysError.INVALID_POOL_INFO_FOUND };
    }
    let marketState: any | undefined = undefined;
    try {
      const marketStateRes = await getMarketState(connection, marketId);
      if (!marketStateRes.Ok)
        return { Err: GetPoolKeysError.MARKET_INFO_NOT_FOUND };
      marketState = marketStateRes.Ok;
    } catch (getMarketStateError) {
      log({ getMarketStateError });
    }
    if (!marketState) return { Err: GetPoolKeysError.MARKET_INFO_NOT_FOUND };
    const {
      baseVault: marketBaseVault,
      quoteVault: marketQuoteVault,
      eventQueue: marketEventQueue,
      bids: marketBids,
      asks: marketAsks,
    } = marketState;
    const res: LiquidityPoolKeys = {
      baseMint,
      quoteMint,
      quoteDecimals,
      baseDecimals,
      authority,
      baseVault,
      quoteVault,
      id,
      lookupTableAccount,
      lpDecimals,
      lpMint,
      lpVault,
      marketAuthority,
      marketId,
      marketProgramId,
      marketVersion,
      openOrders,
      programId,
      targetOrders,
      version,
      withdrawQueue,
      marketAsks,
      marketBids,
      marketBaseVault,
      marketQuoteVault,
      marketEventQueue,
    };
    return { Ok: res };
  } catch (getPoolKeysError) {
    console.log({ getPoolKeysError });
    return { Err: GetPoolKeysError.UNKNWON_ERROR };
  }
}

export async function getPoolInfo(
  connection: Connection,
  poolKeys: LiquidityPoolKeys,
): Promise<Result<LiquidityPoolInfo, GetPoolInfoError>> {
  try {
    const [lpAccountInfo, baseVAccountInfo, quoteVAccountInfo] =
      await connection
        .getMultipleAccountsInfo([
          poolKeys.lpMint,
          poolKeys.baseVault,
          poolKeys.quoteVault,
        ])
        .catch(() => null)
        .then(async (res) => {
          if (res) return res;
          await sleep(1200);
          return connection.getMultipleAccountsInfo([
            poolKeys.lpMint,
            poolKeys.baseVault,
            poolKeys.quoteVault,
          ]);
        });
    if (!lpAccountInfo || !baseVAccountInfo || !quoteVAccountInfo)
      return { Err: GetPoolInfoError.INVALID_INFO };
    const lpSupply = new BN(
      toBufferBE(MintLayout.decode(lpAccountInfo.data).supply, 8),
    );
    const baseReserve = new BN(
      toBufferBE(AccountLayout.decode(baseVAccountInfo.data).amount, 8),
    );
    const quoteReserve = new BN(
      toBufferBE(AccountLayout.decode(quoteVAccountInfo.data).amount, 8),
    );
    const poolInfo: LiquidityPoolInfo = {
      baseDecimals: poolKeys.baseDecimals,
      quoteDecimals: poolKeys.quoteDecimals,
      lpDecimals: poolKeys.lpDecimals,
      lpSupply,
      baseReserve,
      quoteReserve,
      startTime: null as any,
      status: null as any,
    };
    return { Ok: poolInfo };
  } catch (getPoolInfoError) {
    console.log({ getPoolInfoError });
    return { Err: GetPoolInfoError.UNKNWON_ERROR };
  }
}
