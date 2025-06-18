export default class Timer {
  private startTime: number | null = null;
  private endTime: number | null = null;
  private running: boolean = false;
  private pausedTime: number = 0;

  start(): void {
    if (!this.running) {
      this.startTime = Date.now() - this.pausedTime;
      this.endTime = null;
      this.running = true;
    }
  }

  stop(): void {
    if (this.running && this.startTime !== null) {
      this.endTime = Date.now();
      this.running = false;
      this.pausedTime = 0;
    }
  }

  pause(): void {
    if (this.running && this.startTime !== null) {
      this.pausedTime = Date.now() - this.startTime;
      this.running = false;
    }
  }

  resume(): void {
    if (!this.running && this.pausedTime > 0) {
      this.start();
    }
  }

  reset(): void {
    this.startTime = null;
    this.endTime = null;
    this.running = false;
    this.pausedTime = 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  getElapsedTime(): number {
    if (this.startTime === null) {
      return 0;
    }

    if (this.running) {
      return Date.now() - this.startTime;
    }

    if (this.endTime !== null) {
      return this.endTime - this.startTime;
    }

    return this.pausedTime;
  }

  getElapsedSeconds(): number {
    return Math.round((this.getElapsedTime() / 1000) * 100) / 100;
  }

  getElapsedMinutes(): number {
    return Math.round((this.getElapsedSeconds() / 60) * 100) / 100;
  }
}
