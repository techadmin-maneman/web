# 0162. Scanning labels

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Every hair system piece now carries a QR label (ADR 0161), but a movement that names no pieces takes them in line, so the units can drift from the pieces that really moved. The owner ruled on 11 October 2026 that labels are scanned with the phone camera in the tech app and the console, that stores may use a USB scanner, and that typing stays as the fallback.

## Decision

1. **A label is read three ways**: typed, typed by a USB scanner (which ends with Enter), or read by the camera. The back camera opens only while reading, and each frame is read for a QR code in a worker until one is found.
2. **The decoder is qr-scanner's worker, copied** with its licence notices (`packages/ui/qr-decoder.worker.js`): a trimmed jsQR of about 10 KB gzipped, where jsQR itself is 45 KB and would take the technician app, whose service worker keeps every script, over its 150 KB. The package starts the worker from a blob, which our content security policy forbids; served from our own origin it needs nothing loosened.
3. **The console grants itself the camera** (`camera=(self)`), as the tech app does.
4. **Sending, handing over or writing off a hair system names its pieces** by their labels: the count is the number scanned, and a label the place does not hold is refused (`units`).
5. **Receiving a hair system's transfer names the pieces that arrived**; those not scanned went missing on the way.
6. **A label scanned on the Stock page shows its piece**: the stock code, lot and expiry, where it is, and its history.

## Consequences

- The piece step scanning its piece from the kit, and the technician's Kit screen, use the same scanner.
- Tests: `test/worker/inventory/stock-scans.test.ts`, `test/node/packages/ui-scan.test.ts`, `e2e/ops/stock.e2e.ts`, `e2e/ops/console.e2e.ts`.
