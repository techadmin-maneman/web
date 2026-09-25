// One photograph, opened from a row: large, then board D3's download line.
// The file goes to the phone's gallery: on an iPhone through the share sheet,
// whose "Save Image" puts it in Photos; elsewhere as a download, which the
// gallery lists. The sheet rises from the bottom (docs/prompts/phase2-frontend.md,
// "Motion").

import { ICONS } from "@maneman/brand/icons";
import { fullDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { photos } from "../content.ts";
import { Thumb, type OpenPhoto } from "./PhotoRow.tsx";
import styles from "./photos.module.css";

const onIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function Download({ url, name }: { url: string; name: string }) {
  const [file, setFile] = useState<File | null>(null);

  // The share sheet must open on the tap itself, so the file is fetched before it.
  useEffect(() => {
    if (!onIphone()) return;
    let current = true;
    void fetch(url, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (current && blob !== null) setFile(new File([blob], name, { type: blob.type }));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [url, name]);

  const content = (
    <>
      <Icon d={ICONS.download} size={17} />
      {photos.download}
    </>
  );
  if (file !== null && navigator.canShare({ files: [file] })) {
    return (
      <button
        className={styles.download}
        type="button"
        onClick={() => {
          void navigator.share({ files: [file] }).catch(() => undefined);
        }}
      >
        {content}
      </button>
    );
  }
  return (
    <a className={styles.download} href={url} download={name}>
      {content}
    </a>
  );
}

export function PhotoSheet({ photo, onClose }: { photo: OpenPhoto; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const angle = photos.angles[photo.link.angle];
  const date = fullDate(photo.date);
  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby="photo-title"
      onClose={onClose}
      // A tap on the ground around the sheet closes it.
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <Thumb link={photo.link} alt={photos.alt(angle, photo.phase, date)} className={styles.large} eager />
      <div className={styles.save}>
        <p className={styles.photoOf} id="photo-title">
          {photos.photoOf(angle, date)}
        </p>
        <Download url={photo.link.url} name={`mane-man-${photo.date}-${photo.phase}-${photo.link.angle}.jpg`} />
      </div>
      <p className={styles.gallery}>{photos.downloaded}</p>
      <button className={styles.close} type="button" onClick={() => dialog.current?.close()}>
        {photos.close}
      </button>
    </dialog>
  );
}
