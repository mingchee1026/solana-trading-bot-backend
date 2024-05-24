import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { RawMint } from '@solana/spl-token';
import { TxFailResult } from './errors';

//TODO: need in separate file
export type Web3SendTxInput = {
  ixs: TransactionInstruction[];
  signers?: Keypair[];
  lutsInfo?: AddressLookupTableAccount[];
};
export type Web3SendTxOpt = {
  txFee?: number;
  skipWalletsign?: boolean;
  passInfo?: any;
  skipSimulation?: boolean;
  skipIncTxFee?: boolean;
};
export type Web3SignedSendTxOpt = {
  passInfo?: any;
  skipSimulation?: boolean;
  blockhashInfo: Readonly<{
    blockhash: string;
    lastValidBlockHeight: number;
    skipSimulation?: boolean;
  }>;
};
export type Web3SendTxResult = Result<Web3PassTxResult, TxFailResult>;

export type Web3PassTxResult = TxPassResult & {
  input: Web3SendTxInput;
  passInfo?: any;
};
export type TransferInfoFromIxs = {
  address: string;
  amount: number;
  ata: string;
};

export type VolumeData = {
  poolId: string;
  tokenAddress: string;
  wallets: Wallet[];
  amounts: Amounts;
  // swapUnitPrice: number;
  // swapUnitLimit: number;
};

export type Amounts = {
  FUND?: number;
  BUY?: number;
  SELL?: number;
  REMOVE_LP?: number;
  BURN_LP?: number;
  REFRESH?: number;
};

export type Wallet = {
  address: PublicKey;
  privateKey: Keypair;
  sol?: number;
  tokenAmount?: number;
  selected?: boolean;
  rawSol?: number;
  rawTokenAmount?: number;
};

export type BaseRayInput = {
  rpcEndpointUrl: string;
};
export type Result<T, E = any> = {
  Ok?: T;
  Err?: E;
};
export type TxPassResult = {
  txSignature: string;
};
export type MPLTokenInfo = {
  address: PublicKey;
  mintInfo: RawMint;
  metadata: any;
};
