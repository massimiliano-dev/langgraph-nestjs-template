export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Minimal SSE reader for fetch() responses (EventSource cannot send POST bodies). */
export async function* readEvents(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!block.trim() || block.startsWith(':')) continue;
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      try {
        yield { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} };
      } catch {
        // Ignore malformed events.
      }
    }
  }
}
