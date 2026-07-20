import { reactive } from 'vue';

class GlobalState {
  currentTime = Date.now();
  private currentTimeTimer: number | null = null;

  startCurrentTimeLoop(): void {
    this.currentTime = Date.now();
    if (this.currentTimeTimer !== null) return;
    this.currentTimeTimer = window.setInterval(() => {
      this.currentTime = Date.now();
    }, 10_000);
  }

  stopCurrentTimeLoop(): void {
    if (this.currentTimeTimer === null) return;
    window.clearInterval(this.currentTimeTimer);
    this.currentTimeTimer = null;
  }
}

export const globalStore = reactive(new GlobalState());
