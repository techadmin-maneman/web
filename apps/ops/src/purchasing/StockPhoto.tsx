// A photograph of stock for a write-off or a claim (docs/decisions/0170-stock-photos.md): taken or chosen, made small
// in the browser as the technician's camera makes its photographs, stored, and shown once stored.

import { Button } from "@maneman/ui/Button";
import { errorText } from "@maneman/web-kit/refusal";
import { smallJpeg } from "@maneman/web-kit/small-jpeg";
import { useId, useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import styles from "./purchasing.module.css";

type Stored = { photo_id: string };

/** The file made small and stored: its ID, or the refusal's code. */
async function stored(file: File): Promise<{ id: string } | { code: string }> {
  const bitmap = await createImageBitmap(file);
  const small = await smallJpeg(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  const answer = await client.request<Stored>("POST", "/api/stock-photos", {
    body: small.blob,
    headers: { "Content-Type": "image/jpeg" },
  });
  return answer.ok ? { id: answer.body.photo_id } : { code: answer.code };
}

export function StockPhoto({
  label,
  photoId,
  onPhoto,
}: {
  label: string;
  photoId: string | null;
  onPhoto: (id: string | null) => void;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const choose = async (file: File) => {
    setBusy(true);
    setFailed(null);
    try {
      const result = await stored(file);
      if ("id" in result) onPhoto(result.id);
      else setFailed(result.code);
    } catch {
      setFailed("photo_invalid_file");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={form.field}>
      <label className={form.fieldLabel} htmlFor={inputId}>
        {label}
      </label>
      {photoId === null ? (
        <input
          className={form.file}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/webp"
          capture="environment"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void choose(file);
          }}
        />
      ) : (
        <>
          <img className={styles.photo} src={`/api/stock-photos/${photoId}`} alt={copy.photo.alt} />
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              onPhoto(null);
            }}
          >
            {copy.photo.remove}
          </Button>
        </>
      )}
      {busy && (
        <p className={form.hint} role="status">
          {copy.photo.storing}
        </p>
      )}
      {failed !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, { code: failed, fields: [] })}
        </p>
      )}
    </div>
  );
}
