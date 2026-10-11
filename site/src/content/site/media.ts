// Pictures and the people the home page shows: the film, the stages, the technicians, the clients' words.

export interface Picture {
  readonly file: string;
  readonly alt: string;
}

export const heroFootage = {
  publish: false,
  video: "hero.mp4",
  /**
   * The same film for phones: its centre, upright, without sound, under 800 KB. Made from `video` with
   * ffmpeg -i hero.mp4 -vf crop=406:720 -an -c:v libx264 -preset slow -crf 24 -movflags +faststart hero-phone.mp4
   */
  phoneVideo: "hero-phone.mp4",
  poster: "hero-poster.jpg",
  tag: "Placeholder footage",
};

export const whatPlate = {
  publish: false,
  image: {
    file: "membrane-on-skin.jpg",
    alt: "A hair-system membrane laid against scalp skin, individual hairs passing through it",
  },
};

export const norwoodPhotos = {
  publish: false,
  /** Where the photographs are not cleared, the line-drawn profiles stand in: "photos" or "drawings". */
  use: "photos" as "photos" | "drawings",
  images: [
    { file: "nw-1.jpg", alt: "A man at Norwood stage I, seen in three-quarter view" },
    { file: "nw-2.jpg", alt: "A man at Norwood stage II, seen in three-quarter view" },
    { file: "nw-3.jpg", alt: "A man at Norwood stage III, seen in three-quarter view" },
    { file: "nw-4.jpg", alt: "A man at Norwood stage IV, seen in three-quarter view" },
    { file: "nw-5.jpg", alt: "A man at Norwood stage V, seen in three-quarter view" },
    { file: "nw-6.jpg", alt: "A man at Norwood stage VI, seen in three-quarter view" },
    { file: "nw-7.jpg", alt: "A man at Norwood stage VII, seen in three-quarter view" },
  ] satisfies Picture[],
};

/** The before/after pair in the try-on teaser. */
export const teaserPair = {
  publish: false,
  before: { file: "ba-before.jpg", alt: "Before, crown thinning" },
  after: { file: "ba-after.jpg", alt: "After a hair system is fitted" },
};

export const stepPhotos = {
  publish: false,
  images: [
    { file: "step-02-template.jpg", alt: "Hands laying strips of tape over cling film on the crown of a head" },
    { file: "step-03-fit.jpg", alt: "Barber’s scissors trimming hair at a bonded hairline" },
    {
      file: "step-04-kit.jpg",
      alt: "A technician’s canvas tool roll laid open, scissors, comb, adhesive remover and brush in order",
    },
  ] satisfies Picture[],
};

/** Two of the base materials up close, in "Materials and construction". */
export const basePhotos = {
  publish: false,
  images: [
    {
      file: "base-monofilament.jpg",
      alt: "Macro of a monofilament mesh base with hairs hand-tied into it as visible knots",
    },
    {
      file: "base-thinskin.jpg",
      alt: "Macro of a thin polyurethane base held between finger and thumb, hair passing through it",
    },
  ] satisfies Picture[],
};

export const technicians = {
  publish: false,
  title: "Who comes to your home",
  yearsLabel: "years fitting",
  fitsLabel: "fits completed",
  people: [
    {
      name: "Imran Qureshi",
      photo: { file: "tech-1.jpg", alt: "Imran Qureshi, hair-system technician" },
      years: "11",
      fits: "1,400",
    },
    {
      name: "Sandeep Rawat",
      photo: { file: "tech-2.jpg", alt: "Sandeep Rawat, hair-system technician" },
      years: "8",
      fits: "900",
    },
    {
      name: "Vikas Chauhan",
      photo: { file: "tech-3.jpg", alt: "Vikas Chauhan, hair-system technician" },
      years: "6",
      fits: "600",
    },
  ],
};

export const testimonials = {
  publish: false,
  title: "What clients say",
  intro: "Three men who had a system fitted at home in the last year.",
  quotes: [
    {
      photo: { file: "client-1.jpg", alt: "Portrait of a Mane Man client" },
      quote:
        "He came on a Sunday morning and was finished by eleven. I had a wedding that week and nobody said a word about my hair.",
      name: "Client name",
      meta: "Age · Norwood IV · Gurgaon",
    },
    {
      photo: { file: "client-2.jpg", alt: "Portrait of a Mane Man client" },
      quote:
        "The first fit took about ninety minutes. What I did not expect was the monthly visit — he lifts it, cleans the base, re-cuts it, and is gone inside an hour.",
      name: "Client name",
      meta: "Age · Norwood V · Noida",
    },
    {
      photo: { file: "client-3.jpg", alt: "Portrait of a Mane Man client" },
      quote:
        "I asked what happens if I hate it. He gave me the fourteen-day terms before taking any money, which is why I went ahead.",
      name: "Client name",
      meta: "Age · Norwood III · Delhi",
    },
  ],
};

export const founderNote = {
  publish: false,
  label: "A note from the founder",
  paragraphs: [
    "I started losing my hair at twenty-six. By thirty I had been to four clinics, and not one would tell me a price before I was sitting in the chair with a consultant beside me.",
    "So Mane Man does two things differently. The technician comes to your home, so nobody sees you walk in anywhere. And you hear the price at the free consultation, before anything is fitted or paid.",
  ],
  signature: "Founder, Mane Man",
};
