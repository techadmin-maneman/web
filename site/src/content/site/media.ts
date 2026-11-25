// Pictures and the people the home page shows: the film, the results, the stages, the steps, the founder's words; and
// the Gurgaon page's own films.

export interface Picture {
  readonly file: string;
  readonly alt: string;
}

/** The hero's footage: a wide film, a phone's upright cut, and the frame each opens on. */
export interface HeroFootage {
  readonly publish: boolean;
  readonly video: string;
  readonly phoneVideo: string;
  readonly poster: string;
  /** The frame the phone cut opens on; without one, a phone shows the wide poster's upright centre. */
  readonly phonePoster?: string;
  readonly tag: string;
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
} satisfies HeroFootage;

/**
 * The Gurgaon page's hero (docs/decisions/0321-the-gurgaon-page.md): clients and the founder before and after, from
 * the launch films, each poster the frame its cut opens on. The wide film is the upright one on its own blurred
 * ground, its edges feathered; the phone's is 406 x 720, without sound, under 800 KB, as the home page's is:
 * ffmpeg -i MM_Hero_Loop_9x16.mp4 -filter_complex "[0:v]split=2[a][b];[a]scale=1280:-2,crop=1280:720,boxblur=40:3[bg];
 *   [b]scale=406:720,format=yuva420p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='255*clip(min(X,W-1-X)/64,0,1)'[fg];
 *   [bg][fg]overlay=(W-w)/2:0,format=yuv420p" -an -c:v libx264 -preset slow -crf 28 gurgaon-hero.mp4
 */
export const gurgaonHeroFootage = {
  publish: true,
  video: "gurgaon-hero.mp4",
  phoneVideo: "gurgaon-hero-phone.mp4",
  poster: "gurgaon-hero-poster.jpg",
  phonePoster: "gurgaon-hero-phone-poster.jpg",
  tag: "Placeholder footage",
} satisfies HeroFootage;

/** A film that plays when it is tapped; what is said in it is written into the picture. */
export interface Film {
  readonly video: string;
  /** A frame of it, 4:5. */
  readonly poster: string;
  /** What it shows, as the film is named to a screen reader. */
  readonly name: string;
  /** A line beneath it, where the film's own words do not say who it is. */
  readonly caption?: string;
  readonly play: string;
}

/** Nitin's fit at home, on the Gurgaon page: before and after, then in his own words. */
export const gurgaonFilms = {
  publish: true,
  eyebrow: "Nitin’s fit",
  title: "Before and after, at home.",
  films: [
    {
      video: "gurgaon-transformation.mp4",
      poster: "gurgaon-transformation-poster.jpg",
      name: "Nitin, before and after a fit at home",
      play: "Play the before and after",
    },
    {
      video: "gurgaon-story-nitin.mp4",
      poster: "gurgaon-story-nitin-poster.jpg",
      name: "A fit at home, in Nitin’s own words",
      play: "Play Nitin’s story",
    },
  ] satisfies Film[],
};

/** The founder's own fit, step by step, beside his note on the Gurgaon page. */
export const founderFilm = {
  publish: true,
  video: "gurgaon-founder-film.mp4",
  poster: "gurgaon-founder-film-poster.jpg",
  name: "Rishabh’s own hair system fitted, step by step",
  caption: "Rishabh wears one too.",
  play: "Play Rishabh’s fit",
} satisfies Film & { readonly publish: boolean };

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
      // Nitin, framed alike from two clips of the shoot: facing the camera before, and in the technician's mirror
      // after, turned back the right way round.
      before: { file: "result-1-before.jpg", alt: "A man thinning on top, facing the camera, before the fit" },
      after: { file: "result-1-after.jpg", alt: "The same man after the fit, a full head of hair, smiling" },
      caption: "It looks very natural.",
    },
    {
      before: { file: "result-3-before.jpg", alt: "The back of the head before the fit, bald at the crown" },
      after: { file: "result-3-after.jpg", alt: "The back of the head after the fit, the crown covered" },
      caption: "Head held high again.",
    },
    {
      before: {
        file: "result-4-before.jpg",
        alt: "A man bald on top, taking a photo in a salon mirror, before the fit",
      },
      after: { file: "result-4-after.jpg", alt: "The same man after the fit, hair swept up and back" },
      caption: "Love it.",
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
  signature: "Co-founder, Mane Man",
  /** Unfolds the note past its first paragraph (ADR 0263); every word stays in the page. */
  more: "Read the full note",
};
