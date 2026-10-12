# 0162. Scanning labels

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Every hair system piece now carries a QR label (ADR 0161), but a movement that names no pieces takes them in line, so the units can drift from the pieces that really moved. The owner ruled on 11 October 2026 that labels are scanned with the phone camera in the tech app and the console, that stores may use a USB scanner, and that typing stays as the fallback.

## Decision

1. **A label is read three ways**: typed, typed by a USB scanner (which ends with Enter), or read by the camera. The back camera opens only while reading; each frame is read for a QR code, by a decoder loaded only then, and the first found is taken.
2. **The console grants itself the camera** (`camera=(self)`), as the tech app does.
3. **Sending, handing over or writing off a hair system names its pieces** by their labels: the count is the number scanned, and a label the place does not hold is refused (`units`).
4. **Receiving a hair system's transfer names the pieces that arrived**; those not scanned went missing on the way.
5. **A label scanned on the Stock page shows its piece**: the stock code, lot and expiry, where it is, and its history.

## Consequences

- The piece step scanning its piece from the kit, and the technician's Kit screen, use the same scanner.
- Tests: `test/worker/ops/stock-scans.test.ts`, `test/node/packages/ui-scan.test.ts`, `e2e/ops/stock.e2e.ts`, `e2e/ops/console.e2e.ts`.
