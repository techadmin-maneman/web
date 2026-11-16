// Each alert's icon in the inbox, by what it is about: the visit's day, the technician on the way, money, an issue,
// photographs, an invite, or the bell for anything else.

import { CLIENT_ICONS, GLYPHS } from "@maneman/brand/icons";
import type { ClientAlert } from "../api.ts";

const BY_KIND: Readonly<Partial<Record<ClientAlert["kind"], string>>> = {
  consultation_confirmation: CLIENT_ICONS.calendar,
  visit_reminder: CLIENT_ICONS.calendar,
  reschedule_confirmation: CLIENT_ICONS.calendar,
  cancel_confirmation: CLIENT_ICONS.calendar,
  visit_cancelled: CLIENT_ICONS.calendar,
  visit_moved: CLIENT_ICONS.calendar,
  move_proposed: CLIENT_ICONS.calendar,
  next_service_reminder: CLIENT_ICONS.calendar,
  arrival_notice: GLYPHS.pin,
  technician_update: CLIENT_ICONS.truck,
  sign_off_asked: CLIENT_ICONS.layers,
  payment_receipt: CLIENT_ICONS.receipt,
  nothing_to_pay: CLIENT_ICONS.receipt,
  link_paid: CLIENT_ICONS.receipt,
  upi_received: CLIENT_ICONS.receipt,
  booking_refunded: CLIENT_ICONS.receipt,
  no_show_decided: CLIENT_ICONS.alert,
  no_show_dispute_ruled: CLIENT_ICONS.alert,
  concern_received: CLIENT_ICONS.flag,
  concern_answered: CLIENT_ICONS.flag,
  recall_notice: CLIENT_ICONS.alert,
  tryon_result: CLIENT_ICONS.camera,
  friend_fitted: CLIENT_ICONS.gift,
  friend_credited: CLIENT_ICONS.gift,
  referral_rejected: CLIENT_ICONS.gift,
  credits_expiring: CLIENT_ICONS.gift,
};

export const alertIcon = (kind: ClientAlert["kind"]): string => BY_KIND[kind] ?? GLYPHS.bell;
