import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export const MAX_TX_FEE = 800_000;
export const TX_FEE = 400_000;
export const ATA_INIT_COST = 2_100_000;
export const DEFAULT_TX_COST = 200_000;
export const PRIORITY_FEE_LOCAL_STORAGE_KEY = 'PRIORITY_FEE';

interface GetPriorityFeeRequestPayload {
  method: string;
  params: {
    last_n_blocks: number;
    account: string;
  };
  id: number;
  jsonrpc: string;
}

export interface FeeEstimates {
  extreme: number;
  high: number;
  low: number;
  medium: number;
  percentiles: {
    [key: string]: number;
  };
}

interface ResponseData {
  jsonrpc: string;
  result: {
    context: {
      slot: number;
    };
    per_compute_unit: FeeEstimates;
    per_transaction: FeeEstimates;
  };
  id: number;
}

export interface EstimatePriorityFeesParams {
  /** defaut `100` */
  last_n_blocks?: number;
  /** Program address */
  account?: string;
  endpoint: string;
}

// export async function fetchEstimatePriorityFees({
//   last_n_blocks,
//   account,
//   endpoint,
// }: EstimatePriorityFeesParams): Promise<ResponseData> {
//   if (endpoint == ENV.RPC_ENDPOINT_DEV) {
//     const fee: FeeEstimates = {
//       extreme: MAX_TX_FEE,
//       high: TX_FEE,
//       low: TX_FEE,
//       medium: TX_FEE,
//       percentiles: { 90: TX_FEE, 85: TX_FEE },
//     };
//     return {
//       id: 0,
//       jsonrpc: '0',
//       result: {
//         context: { slot: 0 },
//         per_compute_unit: fee,
//         per_transaction: fee,
//       },
//     };
//   }
//   const params: any = {};
//   if (last_n_blocks !== undefined) {
//     params.last_n_blocks = last_n_blocks ?? 100;
//   }
//   if (account !== undefined) {
//     params.account = account;
//   }
//   const payload: GetPriorityFeeRequestPayload = {
//     method: 'qn_estimatePriorityFees',
//     params,
//     id: 1,
//     jsonrpc: '2.0',
//   };
//   const response = await fetch(endpoint, {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify(payload),
//   });
//   if (!response.ok) {
//     throw new Error(`HTTP error! status: ${response.status}`);
//   }
//   const data: ResponseData = await response.json();
//   return data;
// }

export type PriorityFeeInfo = {
  low: number;
  medium: number;
  high: number;
  higher: number;
  extreme: number;
};

const defaultPriorityFee: PriorityFeeInfo = {
  low: TX_FEE / 2,
  medium: TX_FEE,
  high: Math.trunc(1.5 * TX_FEE),
  higher: MAX_TX_FEE,
  extreme: Math.trunc(1.5 * MAX_TX_FEE),
};
/*
export async function setPriorityFee(account?: string): Promise<PriorityFeeInfo> {
  try {
    const endpoint = ENV.RPC_ENDPOINT;
    if (endpoint == ENV.RPC_ENDPOINT_DEV) {
      localStorage.setItem(PRIORITY_FEE_LOCAL_STORAGE_KEY, JSON.stringify(defaultPriorityFee));
      return defaultPriorityFee;
    }
    const feeInfoRes = await fetchEstimatePriorityFees({ endpoint, account: web3.SystemProgram.programId.toBase58() });
    const feeInfo = feeInfoRes?.result?.per_compute_unit;
    if (!feeInfo) return defaultPriorityFee;
    const { low, medium, high, extreme, percentiles } = feeInfo;
    const res: PriorityFeeInfo = {
      low: 2 * medium,
      medium: Math.trunc(percentiles['90'] * 1.5),
      high: percentiles['90'] * 2,
      higher: extreme,
      extreme: Math.trunc(extreme * 1.5),
    };
    localStorage.setItem(PRIORITY_FEE_LOCAL_STORAGE_KEY, JSON.stringify(res));
    return res;
  } catch (fetchEstimatePriorityFeesError) {
    debug({ fetchEstimatePriorityFeesError });
    localStorage.setItem(PRIORITY_FEE_LOCAL_STORAGE_KEY, JSON.stringify(defaultPriorityFee));
    return defaultPriorityFee;
  }
}
*/
export function getPriorityFee() {
  try {
    const info_str = localStorage.getItem(PRIORITY_FEE_LOCAL_STORAGE_KEY);
    if (!info_str) {
      return defaultPriorityFee;
    }

    const info: PriorityFeeInfo = JSON.parse(info_str);
    return info;
  } catch (_) {
    return defaultPriorityFee;
  }
}

export function convertPriorityFeeToUi(info: PriorityFeeInfo): PriorityFeeInfo {
  const { extreme, high, higher, low, medium } = info;
  return {
    low: low / LAMPORTS_PER_SOL,
    medium: medium / LAMPORTS_PER_SOL,
    high: high / LAMPORTS_PER_SOL,
    higher: higher / LAMPORTS_PER_SOL,
    extreme: extreme / LAMPORTS_PER_SOL,
  };
}
