// A photograph of stock for a write-off or a claim (docs/decisions/0170-stock-photos.md): taken or chosen, made small
// in the browser as the technician's camera makes its photographs, stored, and shown once stored.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Field, FileInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { errorText } from "@maneman/web-kit/refusal";
import { smallJpeg } from "@maneman/web-kit/small-jpeg";
import { useState } from "react";
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
  const [busy, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);
  const choose = (file: File) =>
    once(async () => {
      setFailed(null);
      try {
        const result = await stored(file);
        if ("id" in result) onPhoto(result.id);
        else setFailed(result.code);
      } catch {
        setFailed("photo_invalid_file");
      }
    });
  const refused = failed === null ? null : errorText(copy.errors, { code: failed, fields: [] });
  return (
    <>
      <Field label={label} className={form.field} error={refused} announce look={{ error: form.error }}>
        {(control) =>
          photoId === null ? (
            <FileInput
              {...control}
              className={form.file}
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
          )
        }
      </Field>
      {busy && (
        <p className={form.hint} role="status">
          {copy.photo.storing}
        </p>
      )}
    </>
  );
}
