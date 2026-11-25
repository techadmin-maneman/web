// The Gurgaon page's films (docs/decisions/0321-the-gurgaon-page.md): its own clients' footage in the hero, and films
// that fetch nothing until they are tapped, then play in their poster's place and take focus. The home page keeps its
// own hero and has no founder's film.
import { expect, test } from "./support.ts";
import { founderFilm, gurgaonFilms } from "../site/src/content/site.ts";

test("leads with its own clients' footage, and fetches a film only once it is tapped", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) fetched.push(request.url());
  });
  await page.goto("/gurgaon");
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

test("leaves the home page its own hero, with no founder's film", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hero-video]")).toHaveAttribute("data-phone-film", /fit-film-phone/);
  await expect(page.getByRole("button", { name: founderFilm.play, exact: true })).toHaveCount(0);
});
