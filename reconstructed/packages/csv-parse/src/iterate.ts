interface Emitter {
  on(event: "data", listener: (record: Record<string, string>) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export async function* asyncIterateParser(
  parser: Emitter,
  onReturn?: () => void
): AsyncGenerator<Record<string, string>> {
  const queue: Record<string, string>[] = [];
  let done = false;
  let error: Error | undefined;
  let notify: (() => void) | undefined;
  let returned = false;

  parser.on("data", (record) => {
    if (returned) return;
    queue.push(record);
    notify?.();
  });
  parser.on("end", () => {
    done = true;
    notify?.();
  });
  parser.on("error", (err) => {
    if (returned) return;
    error = err;
    notify?.();
  });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (error) throw error;
      if (done) return;
      await new Promise<void>((r) => {
        notify = r;
      });
    }
  } finally {
    returned = true;
    // Clear notify so no pending event can resolve a dangling promise
    notify = undefined;
    onReturn?.();
  }
}
