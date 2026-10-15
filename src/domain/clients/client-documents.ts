// A client's issued invoices and receipts, as PDFs. Books makes each, and none changes once issued, so the first view
// keeps a copy in the client-photos bucket, under the client, and every later view is served from it: Books is asked
// only for a document not yet kept, so a Zoho outage or a spent daily quota leaves a client's documents opening. The
// storage meter counts each copy (src/domain/platform/storage-meter.ts); an erasure deletes them with the client's
// photographs (src/domain/privacy/erasure-files.ts), while Books keeps its own for the tax record.

import { putCounted } from "../platform/storage-meter.ts";

type DocumentKind = "invoice" | "receipt";

/** Where a client's kept documents are, as one prefix an erasure deletes. */
export const documentsOf = (personId: string): string => `documents/${personId}/`;

/** A document of a client's, by what it is and its id in Books. */
export interface ClientDocument {
  readonly personId: string;
  readonly kind: DocumentKind;
  readonly booksId: string;
}

/**
 * The document's PDF: the copy kept, or Books' own, kept now for the next view. Null while Books has none to give.
 */
export async function documentPdf(
  env: { readonly DB: D1Database; readonly CLIENT_PHOTOS: R2Bucket },
  document: ClientDocument,
  fromBooks: () => Promise<{ readonly body: ReadableStream<Uint8Array> } | null>,
): Promise<ReadableStream<Uint8Array> | Uint8Array | null> {
  const key = `${documentsOf(document.personId)}${document.kind}-${document.booksId}.pdf`;
  const kept = await env.CLIENT_PHOTOS.get(key);
  if (kept !== null) return kept.body;
  const pdf = await fromBooks();
  if (pdf === null) return null;
  const bytes = new Uint8Array(await new Response(pdf.body).arrayBuffer());
  await putCounted({ db: env.DB, bucket: env.CLIENT_PHOTOS, key, bytes, contentType: "application/pdf" });
  return bytes;
}
