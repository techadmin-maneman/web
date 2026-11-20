// Growth's campaign links (docs/decisions/0288-attribution-and-conversions.md, docs/tracking.md): a society activation,
// with its society, pincode, day and costs, at /s/<slug>; or an offer for an ad, a post or a newsletter at /o/<slug>.
// Each sends the visitor to /book with its tags and its code, and may carry one of Finance's discount codes for the
// first fit. A society's costs are spend entries on its link. A link is retired rather than deleted: its touches and
// spend keep pointing at it.

import { PUBLIC_ORIGIN, type EnvironmentName } from "../../config/environments.ts";
import { REF_ALPHABET } from "../../config/ref-tokens.ts";
import { failedUniqueOn } from "../../lib/d1-errors.ts";
import {
  landingOf,
  LINK_PATH,
  slugFrom,
  SOCIETY_MEDIUM,
  SOCIETY_SOURCE,
  societyCampaign,
  type LinkKind,
} from "../../policy/campaign-links.ts";
import { cityHeld, spendStatement, type CostLine } from "../money/spend.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

export interface CampaignLink {
  readonly id: string;
  readonly kind: LinkKind;
  readonly slug: string;
  readonly code: string;
  readonly name: string;
  readonly utm_source: string;
  readonly utm_medium: string;
  readonly utm_campaign: string;
  readonly city: string | null;
  readonly pincode: string | null;
  readonly held_date: string | null;
  readonly discount_code: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly retired_at: string | null;
  /** What was spent on it, in paise before GST. */
  readonly spent: number;
  /** The visits, chats and calls that came through it, and the people they were. */
  readonly touches: number;
  readonly people: number;
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

export interface SocietyCost {
  readonly line: CostLine;
  /** Paise, before GST. */
  readonly amount: number;
  readonly note: string | null;
}

export type NewLink =
  | {
      readonly kind: "society";
      readonly name: string;
      readonly pincode: string;
      readonly heldDate: string;
      readonly costs: readonly SocietyCost[];
      readonly discountCodeId: string | null;
    }
  | {
      readonly kind: "offer";
      readonly name: string;
      readonly utmSource: string;
      readonly utmMedium: string;
      readonly utmCampaign: string;
      readonly city: string | null;
      readonly discountCodeId: string | null;
    };

/** A link's code: six of the letters no one misreads, for a society to put on its posters and say aloud. */
const CODE_LENGTH = 6;

function newCode(): string {
  const picks = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...picks].map((pick) => REF_ALPHABET[pick % REF_ALPHABET.length] ?? "").join("");
}

/** The first of slug, slug-2, slug-3 … no link has. */
async function freeSlug(db: D1Database, base: string): Promise<string> {
  const { results } = await db
    .prepare("SELECT slug FROM campaign_links WHERE slug = ?1 OR slug LIKE ?1 || '-%'")
    .bind(base)
    .all<{ slug: string }>();
  const taken = new Set(results.map((row) => row.slug));
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? "" : `-${String(number)}`;
    const slug = `${base.slice(0, 40 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(slug)) return slug;
  }
}

const LISTED = `SELECT l.id, l.kind, l.slug, l.code, l.name, l.utm_source, l.utm_medium, l.utm_campaign, l.city, l.pincode,
    l.held_date, d.code AS discount_code, l.created_by, l.created_at, l.retired_at,
    COALESCE((SELECT SUM(s.amount) FROM spend_entries s WHERE s.link_id = l.id AND s.removed_at IS NULL), 0) AS spent,
    (SELECT COUNT(*) FROM touches t WHERE t.link_id = l.id) AS touches,
    (SELECT COUNT(DISTINCT t.person_id) FROM touches t WHERE t.link_id = l.id AND t.person_id IS NOT NULL) AS people
  FROM campaign_links l LEFT JOIN discount_codes d ON d.id = l.discount_code_id`;

/** Every link, the newest first. */
export async function campaignLinks(db: D1Database): Promise<CampaignLink[]> {
  const { results } = await db.prepare(`${LISTED} ORDER BY l.created_at DESC`).all<CampaignLink>();
  return results;
}

/** Why a link cannot be made as asked. */
export type LinkRefusal = "no_city" | "no_pincode" | "no_discount_code";

/** A discount code a link may carry: Finance's, switched on, and one that covers a first fit. */
async function discountUsable(db: D1Database, id: string | null): Promise<boolean> {
  if (id === null) return true;
  const row = await db
    .prepare("SELECT 1 FROM discount_codes WHERE id = ?1 AND switched_off_at IS NULL AND covers_first_fit = 1")
    .bind(id)
    .first();
  return row !== null;
}

/** A society's city, by its pincode: the served pincode's, none for one only the directory has, or null for neither. */
async function cityOfPincode(db: D1Database, pincode: string): Promise<{ readonly city: string | null } | null> {
  const served = await db
    .prepare("SELECT city FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pincode)
    .first<{ city: string | null }>();
  if (served !== null) return { city: served.city };
  const listed = await db.prepare("SELECT 1 FROM pincode_directory WHERE pincode = ?1").bind(pincode).first();
  return listed === null ? null : { city: null };
}

/** A society's costs, as spend entries on its link, on its day, under its campaign. */
function societyCosts(
  db: D1Database,
  link: Extract<NewLink, { kind: "society" }>,
  on: { readonly id: string; readonly city: string | null; readonly campaign: string },
  by: { readonly actorId: string; readonly at: Date },
): D1PreparedStatement[] {
  return link.costs.map(
    (cost) =>
      spendStatement(
        db,
        {
          spent_date: link.heldDate,
          city: on.city,
          channel: "society",
          campaign: on.campaign,
          amount: cost.amount,
          note: cost.note,
          source: "link",
          link_id: on.id,
          cost_line: cost.line,
        },
        by,
      ).statement,
  );
}

/** Makes a link, and a society's costs as spend on it, audited together. */
export async function addCampaignLink(
  db: D1Database,
  change: Change & { readonly link: NewLink },
): Promise<CampaignLink | LinkRefusal> {
  const { link } = change;
  if (!(await discountUsable(db, link.discountCodeId))) return "no_discount_code";
  const placed = link.kind === "society" ? await cityOfPincode(db, link.pincode) : { city: link.city };
  if (placed === null) return "no_pincode";
  const { city } = placed;
  if (!(await cityHeld(db, city))) return "no_city";
  const slug = await freeSlug(db, slugFrom(link.name) || link.kind);
  const tags =
    link.kind === "society"
      ? { source: SOCIETY_SOURCE, medium: SOCIETY_MEDIUM, campaign: societyCampaign(slug, link.heldDate) }
      : { source: link.utmSource, medium: link.utmMedium, campaign: link.utmCampaign };
  const id = crypto.randomUUID();
  const at = change.now.toISOString();
  const costs =
    link.kind === "society"
      ? societyCosts(db, link, { id, city, campaign: tags.campaign }, { actorId: change.actor.id, at: change.now })
      : [];
  for (let tried = 0; tried < 4; tried += 1) {
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO campaign_links (id, kind, slug, code, name, utm_source, utm_medium, utm_campaign, city, pincode,
               held_date, discount_code_id, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
          )
          .bind(
            id,
            link.kind,
            slug,
            newCode(),
            link.name,
            tags.source,
            tags.medium,
            tags.campaign,
            city,
            link.kind === "society" ? link.pincode : null,
            link.kind === "society" ? link.heldDate : null,
            link.discountCodeId,
            change.actor.id,
            at,
          ),
        ...costs,
        auditStatement(
          db,
          {
            surface: "ops",
            actor: change.actor,
            action: "campaign_link.add",
            subject: { kind: "campaign_link", id },
            requestId: change.requestId,
            detail: { kind: link.kind, slug, campaign: tags.campaign },
          },
          change.now,
        ),
      ]);
      break;
    } catch (error) {
      // Another link drew the same code: draw again.
      if (!failedUniqueOn(error, "campaign_links") || tried === 3) throw error;
    }
  }
  const made = await db.prepare(`${LISTED} WHERE l.id = ?1`).bind(id).first<CampaignLink>();
  if (made === null) throw new Error("campaign_link_missing");
  return made;
}

/** Retires a link; false for one already retired or not ours. */
export async function retireCampaignLink(db: D1Database, change: Change & { readonly id: string }): Promise<boolean> {
  const [retired] = await db.batch([
    db
      .prepare("UPDATE campaign_links SET retired_by = ?2, retired_at = ?3 WHERE id = ?1 AND retired_at IS NULL")
      .bind(change.id, change.actor.id, change.now.toISOString()),
  ]);
  if ((retired?.meta.changes ?? 0) === 0) return false;
  await auditStatement(
    db,
    {
      surface: "ops",
      actor: change.actor,
      action: "campaign_link.retire",
      subject: { kind: "campaign_link", id: change.id },
      requestId: change.requestId,
    },
    change.now,
  ).run();
  return true;
}

/** Where a live link sends the visitor, by its kind's path and slug; null for one retired or not ours. */
export async function landingOfLink(db: D1Database, kind: "s" | "o", slug: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT kind, code, utm_source, utm_medium, utm_campaign FROM campaign_links
       WHERE slug = ?1 AND kind = ?2 AND retired_at IS NULL`,
    )
    .bind(slug, kind === "s" ? "society" : "offer")
    .first<{ kind: LinkKind; code: string; utm_source: string; utm_medium: string; utm_campaign: string }>();
  if (row === null) return null;
  return landingOf({
    kind: row.kind,
    code: row.code,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
  });
}

/** A link's short address on the site, as its QR code and the console show it. */
export const shortLinkOf = (environment: EnvironmentName, link: { kind: LinkKind; slug: string }): string =>
  `${PUBLIC_ORIGIN[environment]}${LINK_PATH[link.kind]}${link.slug}`;
