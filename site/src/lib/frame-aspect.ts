// A photograph's own shape, for the frame that shows it.
//
// The try-on's frames were a fixed height with object-fit: cover, which is right
// for the design's sample images and wrong for a real one: a phone's portrait
// photograph was cropped from the centre, and the hairline someone came to look
// at could be the part that was cut off. The frame now takes the photograph's
// aspect ratio, and the image is contained inside it, so nothing is ever cut.
//
// The ratio is written as a custom property through the CSSOM, which the content
// security policy allows where an inline style attribute would not.

/** The ratio a frame falls back to before any photograph has loaded. */
export const DEFAULT_ASPECT = 4 / 3;

/** Reads the photographs inside `frame` and gives it the shape of the tallest. */
export function fitFrameToPhotos(frame: HTMLElement | null): () => void {
  if (frame === null) return () => undefined;

  const apply = () => {
    const ratios = [...frame.querySelectorAll("img")]
      .filter((image) => image.naturalWidth > 0 && image.naturalHeight > 0)
      .map((image) => image.naturalWidth / image.naturalHeight);
    if (ratios.length === 0) return;
    // The narrowest ratio is the tallest photograph, and it must fit whole.
    frame.style.setProperty("--frame-aspect", String(Math.min(...ratios)));
  };

  apply();
  const images = [...frame.querySelectorAll("img")];
  for (const image of images) image.addEventListener("load", apply);
  return () => {
    for (const image of images) image.removeEventListener("load", apply);
  };
}
