// The raise screen's photographs (./RaiseScreen.tsx): up to three, each re-encoded small on the phone, so nothing of
// the original's metadata goes with it (no place, device or time), shown as they will be sent, each with a way to take
// it out.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { IconButton } from "@maneman/ui/IconButton";
import { PhotoPick } from "@maneman/ui/PhotoPick";
import { smallJpeg } from "@maneman/web-kit/small-jpeg";
import { PROBLEM_PHOTOS_MAX } from "@rules/policy/problems.ts";
import { useEffect, useState } from "react";
import { issues } from "../content.ts";
import styles from "./raise.module.css";

/** A page address for each photograph, given back as they go. */
function useShown(photos: readonly Blob[]): readonly string[] {
  const [urls, setUrls] = useState<readonly string[]>([]);
  useEffect(() => {
    const made = photos.map((photo) => URL.createObjectURL(photo));
    setUrls(made);
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [photos]);
  return urls;
}

/** A photograph re-encoded small, as every one the client sends goes. */
export async function small(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return (await smallJpeg(bitmap, bitmap.width, bitmap.height)).blob;
  } finally {
    bitmap.close();
  }
}

export function RaisePhotos({
  photos,
  onChange,
}: {
  photos: readonly Blob[];
  onChange: (photos: readonly Blob[]) => void;
}) {
  const copy = issues.raise;
  const shown = useShown(photos);
  const [failed, setFailed] = useState(false);
  const add = async (files: readonly File[]) => {
    const picked = files.slice(0, PROBLEM_PHOTOS_MAX - photos.length);
    try {
      onChange([...photos, ...(await Promise.all(picked.map(small)))]);
      setFailed(false);
    } catch {
      // A file the browser cannot draw, as a HEIC some browsers do not read.
      setFailed(true);
    }
  };
  return (
    <section aria-labelledby="photos">
      <h2 className={styles.title} id="photos">
        {copy.photos} <span className={styles.hint}>{copy.photosHint}</span>
      </h2>
      <div className={styles.photos}>
        {shown.map((url, index) => (
          <div key={url} className={styles.photo}>
            <img src={url} alt="" />
            <IconButton
              className={styles.remove}
              d={ICONS.cross}
              size="sm"
              label={copy.removePhoto(index + 1)}
              onClick={() => {
                onChange(photos.filter((_, at) => at !== index));
              }}
            />
          </div>
        ))}
        {photos.length < PROBLEM_PHOTOS_MAX && (
          <PhotoPick look="tile" label={copy.addPhotos} multiple onPick={(files) => void add(files)}>
            <Icon d={ICONS.plus} size="md" />
          </PhotoPick>
        )}
      </div>
      {failed && (
        <p className={styles.problem} role="alert">
          {copy.photoUnread}
        </p>
      )}
    </section>
  );
}
