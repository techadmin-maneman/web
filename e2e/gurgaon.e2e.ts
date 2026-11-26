// Gurgaon's page and its films (docs/decisions/0321-the-gurgaon-page.md, docs/decisions/0326-one-page-per-city.md): its
// own clients' footage in the hero, and films that fetch nothing until they are tapped, then play in their poster's
// place and take focus. The home page keeps its own hero and has no founder's film.
import { expect, test } from "./support.ts";
import { founderFilm, founderNote, gurgaonFilms } from "../site/src/content/site.ts";

test("leads with its own clients' footage, and fetches a film only once it is tapped", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) fetched.push(request.url());
  });
  await page.goto("/areas/gurgaon");
  await expect(page.locator("[data-hero-video]")).toHaveAttribute("data-phone-film", /gurgaon-hero-phone/);
  const story = gurgaonFilms.films[1];
  if (story === undefined) throw new Error("the Gurgaon page has a second film");
  const play = page.getByRole("button", { name: story.play, exact: true });
  await play.scrollIntoViewIfNeeded();
  expect(fetched.filter((url) => url.includes("gurgaon-story-nitin"))).toEqual([]);

  await play.click();
  const film = page.locator(`video[aria-label="${story.name}"]`);
  await expect(film).toBeFocused();
  await expect(film).toHaveAttribute("controls", "");
  await expect(play).toHaveCount(0);
  await expect.poll(() => fetched.some((url) => url.includes("gurgaon-story-nitin"))).toBe(true);
  await expect.poll(() => film.evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);

  // One voice at a time: starting the founder's film, from the keyboard, pauses Nitin's. The film takes focus, and
  // nothing around it clips the ring that shows it.
  await page.getByRole("button", { name: founderFilm.play, exact: true }).focus();
  await page.keyboard.press("Enter");
  const founder = page.locator(`video[aria-label="${founderFilm.name}"]`);
  await expect(founder).toBeFocused();
  expect(await founder.evaluate((video) => getComputedStyle(video.parentElement ?? video).overflow)).toBe("visible");
  expect(await film.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
});

// On a laptop the guarantee and the note run down the left, and the film stands beside both at the column's right edge;
// the note keeps its place as it unfolds.
test("stands the founder's film beside the guarantee and the note, which unfolds in place", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/areas/gurgaon");
  const band = page.locator('[data-section="guarantee"]');
  const guarantee = band.locator(".guarantee-part");
  const note = band.locator('[data-section="founder"]');
  const film = band.locator(".founder-film");
  await film.scrollIntoViewIfNeeded();
  const top = async (part: typeof film) => Math.round((await part.boundingBox())?.y ?? -1);

  expect(await top(film)).toBe(await top(guarantee));
  expect(Math.round((await note.boundingBox())?.x ?? -1)).toBe(Math.round((await guarantee.boundingBox())?.x ?? 0));
  const column = await band.locator(".container").evaluate((container) => {
    return container.getBoundingClientRect().right - parseFloat(getComputedStyle(container).paddingRight);
  });
  const filmBox = await film.boundingBox();
  expect(Math.round((filmBox?.x ?? 0) + (filmBox?.width ?? 0))).toBe(Math.round(column));

  const noteTop = await top(note);
  const filmTop = await top(film);
  await note.locator("summary", { hasText: founderNote.more }).click();
  await expect(note.locator("details")).toHaveAttribute("open", "");
  expect(await top(note)).toBe(noteTop);
  expect(await top(film)).toBe(filmTop);
});

test("leaves the home page its own hero, with no founder's film", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hero-video]")).toHaveAttribute("data-phone-film", /fit-film-phone/);
  await expect(page.getByRole("button", { name: founderFilm.play, exact: true })).toHaveCount(0);
});
