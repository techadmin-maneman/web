// One photograph, opened from a row: large, then Photos' download line.
// The file goes to the phone's gallery: on an iPhone through the share sheet,
// whose "Save Image" puts it in Photos; elsewhere as a download, which the
// gallery lists. The sheet rises from the bottom (docs/prompts/phase2-frontend.md,
// "Motion").

import { ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Sheet, SheetPanel } from "@maneman/ui/Sheet";
import { useEffect, useRef, useState } from "react";
import { photos } from "../content.ts";
import { Thumb, type OpenPhoto } from "./PhotoRow.tsx";
import type { Relink } from "./relink.ts";
import shared from "./photos.module.css";
import styles from "./photo-sheet.module.css";

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
      <Icon d={ICONS.download} size="sm" />
      {photos.download}
    </>
  );
  if (file !== null && navigator.canShare({ files: [file] })) {
    return (
      <Button
        variant="outline"
        size="small"
        className={styles.download}
        onClick={() => {
          void navigator.share({ files: [file] }).catch(() => undefined);
        }}
      >
        {content}
      </Button>
    );
  }
  return (
    <ButtonLink variant="outline" size="small" className={styles.download} href={url} download={name}>
      {content}
    </ButtonLink>
  );
}

export function PhotoSheet({ photo, onClose, relink }: { photo: OpenPhoto; onClose: () => void; relink: Relink }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  // A tap on the ground around the sheet closes it, as Close does.
  return (
    <Sheet ref={dialog} labelledBy="photo-title" onClose={onClose}>
      <SheetPanel>
        {failed ? (
          <InlineMessage tone="error">{photos.largeFailed}</InlineMessage>
        ) : (
          <Thumb
            link={photo.link}
            alt={photo.alt}
            className={shared.large}
            eager
            onFailed={() => {
              setFailed(true);
            }}
          />
        )}
        <div className={styles.save}>
          <p className={styles.photoOf} id="photo-title">
            {photo.title}
          </p>
          {failed ? (
            // The row reads fresh links, and the photograph opens again from it.
            <Button
              variant="outline"
              size="small"
              className={styles.download}
              onClick={() => {
                relink.reload();
                dialog.current?.close();
              }}
            >
              {photos.reloadPhotos}
            </Button>
          ) : (
            <Download url={photo.link.url} name={photo.fileName} />
          )}
        </div>
        <p className={styles.gallery}>{photos.downloaded}</p>
        <Button variant="quiet" size="control" className={styles.close} onClick={() => dialog.current?.close()}>
          {photos.close}
        </Button>
      </SheetPanel>
    </Sheet>
  );
}
