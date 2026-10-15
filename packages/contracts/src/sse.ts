export type SseEvent = { event: string; data: string };

/** Incremental SSE parser; handles UTF-8 chunks split in the middle of lines or CRLF. */
export class SseDecoder {
  private line = '';
  private event = 'message';
  private data: string[] = [];
  private skipNextLf = false;

  push(chunk: string): SseEvent[] {
    const events: SseEvent[] = [];
    for (const char of chunk) {
      if (char === '\r') {
        this.readLine(events);
        this.skipNextLf = true;
      } else if (char === '\n') {
        if (!this.skipNextLf) this.readLine(events);
        this.skipNextLf = false;
      } else {
        this.skipNextLf = false;
        this.line += char;
      }
    }
    return events;
  }

  finish(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.line) this.readLine(events);
    this.emit(events);
    return events;
  }

  private readLine(events: SseEvent[]): void {
    const line = this.line;
    this.line = '';
    if (!line) {
      this.emit(events);
    } else if (line.startsWith('event:')) {
      this.event = line.slice(6).trimStart();
    } else if (line.startsWith('data:')) {
      this.data.push(line.slice(5).trimStart());
    }
  }

  private emit(events: SseEvent[]): void {
    if (this.data.length) events.push({ event: this.event, data: this.data.join('\n') });
    this.event = 'message';
    this.data = [];
  }
}
