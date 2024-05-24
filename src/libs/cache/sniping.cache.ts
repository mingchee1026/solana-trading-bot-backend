import { SnipingState } from 'src/sse/sse.service';

export class SnipingCache {
  private readonly keys: Map<number, { id: number; state: SnipingState }> =
    new Map<number, { id: number; state: SnipingState }>();

  private lastTime: number = 0;

  public save(id: number, state: SnipingState) {
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

  public remove(id: number) {
    for (const key of this.keys.keys()) {
      if (key <= id) {
        this.keys.delete(key);
      }
    }
  }

  public clear() {
    this.keys.clear();
  }
}
