// A job's photographs: their upload links, their sets and the storage they take.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { readMeter } from "../../../src/domain/storage-meter.ts";
import { MAX_PHOTO_BYTES, MAX_THUMBNAIL_BYTES } from "../../../src/domain/tech-photos.ts";
import { PHASE_2_SHARE_BYTES, RUNAWAY_CEILING_BYTES } from "../../../src/policy/storage-share.ts";
import { NOW, request } from "../helpers.ts";
import { syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";
import {
  AS_THE_BOARD_SHOWS_IT,
  bindings,
  cookie,
  deps,
  insertJob,
  opsPost,
  OTHER_JOB,
  post,
  SAMEER,
  startJob,
  tech,
  TODAY_JOB,
  useFieldDay,
} from "./field-fixtures.ts";

useFieldDay();

describe("the photographs", () => {
  it("takes the bytes through the API and keeps them in the bucket", async () => {
    await startJob();
    const link = await opsFreeUploadLink();
    const put = await request(
      tech,
      link,
      {
        method: "PUT",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
        body: syntheticJpeg(1200, 1600),
      },
      bindings(),
    );
    expect(put.status).toBe(200);

    const confirmed = await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "before" }, "event-photos-01");
    expect(confirmed.status).toBe(202);

    const stored = await env.DB.prepare(
      `SELECT p.r2_key, p.bytes FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id WHERE s.appointment_id = ?1`,
    )
      .bind(TODAY_JOB)
      .first<{ r2_key: string; bytes: number }>();
    expect(stored?.bytes).toBeGreaterThan(0);
    expect(await env.CLIENT_PHOTOS.head(stored?.r2_key ?? "")).not.toBeNull();
  });

  /** A JPEG of this size in pixels, padded to exactly `length` bytes. */
  function jpegOf(length: number, width = 1200, height = 1600): Uint8Array {
    const header = syntheticJpeg(width, height);
    const padded = new Uint8Array(length);
    padded.set(header.subarray(0, header.length - 2));
    padded.set([0xff, 0xd9], length - 2);
    return padded;
  }

  const putPhoto = (link: string, body: Uint8Array) =>
    request(
      tech,
      link,
      {
        method: "PUT",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
        body,
      },
      bindings(),
    );

  it("takes a photograph of up to 2 MB, and refuses a larger one, which no build of the app sends", async () => {
    await startJob();
    expect((await putPhoto(await opsFreeUploadLink(), jpegOf(MAX_PHOTO_BYTES))).status).toBe(200);
    const refused = await putPhoto(await opsFreeUploadLink(), jpegOf(MAX_PHOTO_BYTES + 1));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "photo_invalid_file" } });
    expect(MAX_PHOTO_BYTES).toBe(2 * 1024 * 1024);
  });

  it("counts each photograph it stores on the storage meter", async () => {
    await startJob();
    const bytes = syntheticJpeg(1200, 1600, "front");
    await putPhoto(await opsFreeUploadLink(), bytes);
    expect((await readMeter(env.DB)).bytes).toBe(bytes.byteLength);
  });

  it("stores a photograph when the share of R2 is full, as the owner ruled", async () => {
    await startJob();
    await env.DB.prepare("UPDATE storage_meter SET bytes = ?1")
      .bind(PHASE_2_SHARE_BYTES * 1.5)
      .run();
    expect((await putPhoto(await opsFreeUploadLink(), syntheticJpeg(1200, 1600))).status).toBe(200);
    expect(deps.alerts).toEqual([]);
  });

  it("refuses a photograph past the runaway ceiling, which waits on the phone, and tells ops", async () => {
    await startJob();
    await env.DB.prepare("UPDATE storage_meter SET bytes = ?1")
      .bind(RUNAWAY_CEILING_BYTES - 10)
      .run();
    const refused = await putPhoto(await opsFreeUploadLink(), syntheticJpeg(1200, 1600));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "busy" } });
    expect(deps.alerts).toEqual([expect.stringContaining("past the runaway ceiling of 20 GB")]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS photos FROM photos").first("photos")).toBe(0);
  });

  const heldPhoto = () =>
    env.DB.prepare("SELECT r2_key, thumbnail_key FROM photos").first<{
      r2_key: string;
      thumbnail_key: string | null;
    }>();

  /** The photograph, and the take it names, which its thumbnail's upload sends back. */
  async function putTake(link: string, body: Uint8Array): Promise<string> {
    const answer = await putPhoto(link, body);
    expect(answer.status).toBe(200);
    const { take } = await answer.json<{ take: string }>();
    return take;
  }

  const putThumbnail = (link: string, take: string, body: Uint8Array) => putPhoto(`${link}?take=${take}`, body);

  it("takes the small copy after the photograph and keeps it beside it, counted", async () => {
    await startJob();
    const links = await uploadLinks();
    const photo = syntheticJpeg(1200, 1600, "front");
    const small = syntheticJpeg(300, 400, "front, small");
    const take = await putTake(links.upload_url, photo);
    expect((await putThumbnail(links.small_upload_url, take, small)).status).toBe(204);

    const held = await heldPhoto();
    expect(held?.r2_key).toBe(`visits/${TODAY_JOB}/before-front-${take}.jpg`);
    expect(held?.thumbnail_key).toBe(`visits/${TODAY_JOB}/before-front-${take}-small.jpg`);
    expect((await env.CLIENT_PHOTOS.head(held?.thumbnail_key ?? ""))?.size).toBe(small.byteLength);
    expect((await readMeter(env.DB)).bytes).toBe(photo.byteLength + small.byteLength);
  });

  it("refuses a small copy before its photograph, so none is ever held without one", async () => {
    await startJob();
    const refused = await putThumbnail(
      (await uploadLinks()).small_upload_url,
      crypto.randomUUID(),
      syntheticJpeg(300, 400),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "upload_missing" } });
    expect((await env.CLIENT_PHOTOS.list({ prefix: "visits/" })).objects).toEqual([]);
  });

  it("refuses a small copy that is not a small JPEG", async () => {
    await startJob();
    const links = await uploadLinks();
    const take = await putTake(links.upload_url, syntheticJpeg(1200, 1600));
    for (const wrong of [
      syntheticJpeg(1200, 1600),
      syntheticPng(300, 400),
      jpegOf(MAX_THUMBNAIL_BYTES + 1, 300, 400),
    ]) {
      expect((await putThumbnail(links.small_upload_url, take, wrong)).status).toBe(422);
    }
    expect((await heldPhoto())?.thumbnail_key).toBeNull();
  });

  it("takes a small copy sent again once, as a phone that lost the answer sends it", async () => {
    await startJob();
    const links = await uploadLinks();
    const photo = syntheticJpeg(1200, 1600);
    const small = syntheticJpeg(300, 400);
    const take = await putTake(links.upload_url, photo);
    await putThumbnail(links.small_upload_url, take, small);
    const first = (await heldPhoto())?.thumbnail_key;

    expect((await putThumbnail(links.small_upload_url, take, small)).status).toBe(204);
    expect((await heldPhoto())?.thumbnail_key).toBe(first);
    expect((await readMeter(env.DB)).bytes).toBe(photo.byteLength + small.byteLength);
  });

  it("forgets the small copy of a photograph taken again, which then shows itself until its own arrives", async () => {
    await startJob();
    const links = await uploadLinks();
    const first = await putTake(links.upload_url, syntheticJpeg(1200, 1600, "first take"));
    await putThumbnail(links.small_upload_url, first, syntheticJpeg(300, 400, "first take"));
    await putTake(links.upload_url, syntheticJpeg(1200, 1600, "second take"));
    expect((await heldPhoto())?.thumbnail_key).toBeNull();
    // The first take's small copy cannot be claimed for the second.
    expect((await putThumbnail(links.small_upload_url, first, syntheticJpeg(300, 400))).status).toBe(409);
  });

  // Open point 92: a job given away while its photographs wait names whom it went to, as a refused write does.
  // A job he has begun stays his, so this one was given away before he reached it, from a phone still holding it.
  it("answers an upload link for a job ops gave away as superseded, naming whom, by first name, and when", async () => {
    await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "technician_unavailable",
    });

    const answer = await askForUploadLink(TODAY_JOB);

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    expect(error).toEqual({
      code: "superseded",
      request_id: expect.any(String) as string,
      fields: ["technician"],
      moved: { technician: "Sameer", at: NOW.toISOString() },
    });
  });

  it("answers an upload link for a job cancelled while its photographs wait as superseded, naming nobody", async () => {
    await startJob();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(TODAY_JOB).run();

    const answer = await askForUploadLink(TODAY_JOB);

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    expect(error).toMatchObject({ code: "superseded", fields: ["status"] });
    expect(error).not.toHaveProperty("moved");
  });

  it("answers not found for a job that was never this technician's, and names nobody", async () => {
    await insertJob(OTHER_JOB, { start: "2026-09-21T07:30:00.000Z", technician: SAMEER });

    const answer = await askForUploadLink(OTHER_JOB);

    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ error: { code: "not_found" } });
  });

  function askForUploadLink(jobId: string): Promise<Response> {
    return request(
      tech,
      `/api/tech/jobs/${jobId}/photos/upload-url`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "before", angle: "front" }),
      },
      bindings(),
    );
  }

  async function uploadLinks(): Promise<{ upload_url: string; small_upload_url: string }> {
    const answer = await request(
      tech,
      `/api/tech/jobs/${TODAY_JOB}/photos/upload-url`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "before", angle: "front" }),
      },
      bindings(),
    );
    return answer.json();
  }

  async function opsFreeUploadLink(): Promise<string> {
    const answer = await request(
      tech,
      `/api/tech/jobs/${TODAY_JOB}/photos/upload-url`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "before", angle: "front" }),
      },
      bindings(),
    );
    const { upload_url: url } = await answer.json<{ upload_url: string }>();
    return url;
  }
});
