// Try-on test data. The "photos" are synthetic: a valid JPEG or PNG header
// with the size we ask for and no picture at all. No real photograph is ever
// used as a fixture (see the prompt's rules for the AILabTools harness).

import { env } from "cloudflare:workers";
import { NOW } from "./helpers.ts";

/** A PNG signature and IHDR chunk. The CRC is not checked by anything we test. */
export function syntheticPng(width: number, height: number, marker = ""): Uint8Array {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.push(0, 0, 0, 13, ...ascii("IHDR"), ...u32(width), ...u32(height), 8, 2, 0, 0, 0, 0, 0, 0, 0);
  if (marker !== "") bytes.push(...u32(marker.length), ...ascii("tEXt"), ...ascii(marker), 0, 0, 0, 0);
  bytes.push(0, 0, 0, 0, ...ascii("IEND"), 0xae, 0x42, 0x60, 0x82);
  return Uint8Array.from(bytes);
}

/** SOI, a JFIF header, an optional comment, a baseline frame header with the size, and EOI. */
export function syntheticJpeg(width: number, height: number, marker = ""): Uint8Array {
  const bytes = [0xff, 0xd8];
  bytes.push(0xff, 0xe0, 0, 16, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  if (marker !== "") bytes.push(0xff, 0xfe, ...u16(marker.length + 2), ...ascii(marker));
  bytes.push(0xff, 0xc0, 0, 17, 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export async function insertPerson(id: string, mobileE164: string, name = "Arjun Mehta"): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?, ?, ?, ?, 0)",
  )
    .bind(id, NOW.toISOString(), mobileE164, name)
    .run();
}

/** Inserts a job with every required column filled; `columns` sets or overrides any of them. */
export async function insertJob(columns: Record<string, string | number | null> & { id: string }): Promise<void> {
  const row: Record<string, string | number | null> = {
    created_at: NOW.toISOString(),
    upload_key: `uploads/${columns.id}`,
    state: "queued",
    photo_consent_version: "photo-v1",
    photo_consent_at: NOW.toISOString(),
    ip_hash: "ip-hash",
    request_id: "request",
    ...columns,
  };
  const names = Object.keys(row);
  await env.DB.prepare(`INSERT INTO tryon_jobs (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .bind(...names.map((name) => row[name] ?? null))
    .run();
}
