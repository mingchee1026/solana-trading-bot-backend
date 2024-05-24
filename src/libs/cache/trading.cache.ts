import { TradingState, TransactionType } from 'src/sse/sse.service';

export class TradingCache {
  private readonly keys: Map<number, { id: number; state: TradingState }> =
    new Map<number, { id: number; state: TradingState }>();

  private lastTime: number = 0;

  public save(id: number, state: TradingState) {
    // console.log(`Caching new activity for pool: ${state.transactionType}`);
    this.keys.set(new Date().getTime(), { id, state });
  }

  public getActivities() {
    const activities = [];

    for (const [key, value] of this.keys) {
      if (key > this.lastTime) {
        activities.push(value);
        this.lastTime = key;
      }
    }

    return JSON.stringify(activities);
  }

  public getLastActivity() {
    // Convert Map entries to an array and get the last element
    const entriesArray = [...this.keys.entries()];

    // Get the last entry
    const lastEntry = entriesArray[entriesArray.length - 1];
    if (lastEntry) {
      const [lastKey, lastValue] = lastEntry;
      return {
        DATE: lastKey,
        TYPE:
          lastValue.state.transactionType === TransactionType.BUY
            ? 'BUY'
            : 'SELL',
        SOL: lastValue.state.tokenPriceSOL.toFixed(14),
        USD: lastValue.state.tokenPriceUSB.toFixed(14),
      };
    } else {
      return null;
    }
  }

  public getLastPair() {
    // Convert Map entries to an array and get the last element
    const entriesArray = [...this.keys.entries()];

    // Get the last two elements
    const lastTwoEntries = entriesArray.slice(-2);

    // Check if there are last two entries
    if (lastTwoEntries.length === 2) {
      const [penultimateKey, penultimateValue] = lastTwoEntries[0];
      const [lastKey, lastValue] = lastTwoEntries[1];
      return {
        Last: {
          DATE: lastKey,
          TYPE:
            lastValue.state.transactionType === TransactionType.BUY
              ? 'BUY'
              : 'SELL',
          SOL: lastValue.state.tokenPriceSOL.toFixed(14),
          USD: lastValue.state.tokenPriceUSB.toFixed(14),
        },
        Pre: {
          DATE: penultimateKey,
          TYPE:
            penultimateValue.state.transactionType === TransactionType.BUY
              ? 'BUY'
              : 'SELL',
          SOL: penultimateValue.state.tokenPriceSOL.toFixed(14),
          USD: penultimateValue.state.tokenPriceUSB.toFixed(14),
        },
      };
    } else {
      return null;
    }
  }

  public remove(id: number) {
    for (const key of this.keys.keys()) {
      if (key <= id) {
        this.keys.delete(key);
      }
    }
  }

  public calculateProfits = () => {
    let totalProfit = 0;

    this.keys.forEach(({ state }) => {
      if (state.transactionType === TransactionType.BUY) {
        totalProfit -= state.tokenPriceUSB; // Subtract the buying value
      } else if (state.transactionType === TransactionType.SELL) {
        totalProfit += state.tokenPriceUSB; // Add the selling value
      }
    });

    return totalProfit;
  };

  public clear() {
    this.keys.clear();
  }
}
