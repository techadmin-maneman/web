// Pictures and the people the home page shows: the film, the results, the stages, the steps, the founder's words.

export interface Picture {
  readonly file: string;
  readonly alt: string;
}

/** A fit filmed at a client's home: the hair system trimmed, its lace cut at the hairline, the hair styled. */
export const heroFootage = {
  publish: true,
  video: "fit-film.mp4",
  /**
   * The same film for phones: upright, without sound, under 800 KB. Both are cut from one montage of the fit's
   * clips; the wide film is its middle band:
   * ffmpeg -i montage.mp4 -vf crop=1080:608:0:576,scale=1280:720 -an -c:v libx264 -preset slow -crf 27 fit-film.mp4
   * ffmpeg -i montage.mp4 -vf scale=406:720,crop=406:720 -an -c:v libx264 -preset slow -crf 30 fit-film-phone.mp4
   */
  phoneVideo: "fit-film-phone.mp4",
  /** The montage's first frame, upright: a phone shows it whole and a wide screen its middle. */
  poster: "fit-film-poster.jpg",
  tag: "Placeholder footage",
};

export interface ResultPair {
  readonly before: Picture;
  readonly after: Picture;
  readonly caption: string;
  /** Made by AI, not taken of a client: tagged so. */
  readonly illustration?: true;
}

/** The before-and-after strip beneath the hero. */
export const resultPairs = {
  publish: true,
  pairs: [
    {
      before: { file: "result-2-before.jpg", alt: "A man bald on top, in a barber’s cape, before the fit" },
      after: { file: "result-2-after.jpg", alt: "The same man after the fit, hair swept back" },
      caption: "Life-changing.",
    },
    {
      before: { file: "result-1-before.jpg", alt: "A man with thinning hair on top, before the fit" },
      after: { file: "result-1-after.jpg", alt: "The same man smiling, with a full head of hair" },
      caption: "Ten years younger.",
    },
    {
      before: { file: "result-3-before.jpg", alt: "The back of the head before the fit, bald at the crown" },
      after: { file: "result-3-after.jpg", alt: "The back of the head after the fit, the crown covered" },
      caption: "Head held high again.",
    },
    {
      before: { file: "result-4-before.jpg", alt: "A young man in a mirror, checking thinning hair" },
      after: { file: "result-4-after.jpg", alt: "The same young man with full hair" },
      caption: "Love it.",
      illustration: true,
    },
  ] satisfies ResultPair[],
};

/** Stages III to VII, in order, one man at each, made with an AI tool: the stages, not a client's own. */
export const norwoodPhotos = {
  publish: true,
  /** Where the photographs are not cleared, the line-drawn profiles stand in: "photos" or "drawings". */
  use: "photos" as "photos" | "drawings",
  images: [
    { file: "norwood-3.jpg", alt: "A man at Norwood stage III: deep recession at both temples" },
    { file: "norwood-4.jpg", alt: "The same man at stage IV: the front thinning further back" },
    { file: "norwood-5.jpg", alt: "The same man at stage V: the front bare, fine hair on top" },
    { file: "norwood-6.jpg", alt: "The same man at stage VI: bare from the forehead over the top" },
    { file: "norwood-7.jpg", alt: "The same man at stage VII: hair only around the sides and back" },
  ] satisfies Picture[],
};

/** The scale's last card: the same man with a full hairline. Made with an AI tool like the stages, so it says so. */
export const norwoodRestored = {
  publish: true,
  illustration: true,
  image: { file: "norwood-restored.jpg", alt: "The same man with a full head of hair" },
};

/** The try-on teaser's pair: a photograph, and the try-on's look on it. */
export const teaserPair = {
  publish: true,
  before: { file: "tryon-before.jpg", alt: "A man’s photo before the try-on, thinning on top" },
  after: { file: "tryon-after.jpg", alt: "The same photo in the try-on’s side part look" },
};

export const stepPhotos = {
  publish: true,
  images: [
    { file: "step-consultation.jpg", alt: "A technician measuring a client’s head with a tape" },
    { file: "step-first-fit.jpg", alt: "A client smiling after the first fit" },
    {
      file: "step-service.jpg",
      alt: "A technician’s tool roll laid open: scissors, comb, adhesive remover, cotton pads, brush and tweezers",
    },
  ] satisfies Picture[],
};

export const founderNote = {
  publish: true,
  label: "A note from the founder",
  paragraphs: [
    "I started losing my hair at twenty-four. By thirty, I’d had a transplant and spent years on medication, trying to hold on to what I was losing. Over time, I realised these came with trade-offs I didn’t like. I was fighting a losing battle.",
    "Hair loss is hard enough. Navigating an industry that can make you feel worse about yourself shouldn’t be part of it.",
    "Losing your hair is natural. It’s nobody’s fault, and it doesn’t define you. You can own it, do something about it, or simply move on. What matters is feeling good about the person you see in the mirror, and getting on with being the best version of yourself.",
    "That’s why I started Mane Man. A more private, straightforward way to get your hair back, on your terms.",
  ],
  name: "Rishabh Gupta",
  signature: "Founder, Mane Man",
};
