// How a queue consumer sends a message back to try again later.

/** Retries the message after its first delay, doubled for each attempt it has already had: 1×, 2×, 4× and so on. */
export function retryWithBackoff(message: Message, firstDelaySeconds: number): void {
  message.retry({ delaySeconds: firstDelaySeconds * 2 ** (message.attempts - 1) });
}
