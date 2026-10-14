// Settings' calls to mm-api, and those of the sections that were its tabs: the rules, prices and services, technicians'
// pay, partners' commission, blackout days, discount codes, consumables, the job sheet, suppliers, standard costs and
// the Staff list. Each is the console's client's (../api.ts), one function a route, so a call is found, and changed, in
// one place.

import type { Sent } from "@maneman/web-kit/api";
import {
  client,
  type OpsSetting,
  type SettingValue,
  type DiscountCodesNew,
  type Kind,
  type JobSheetItemSent,
  type StaffSave,
  type VisitType,
  type BlackoutAdd,
  type BlackoutRemove,
  type ConsumableChange,
  type NewConsumable,
  type PartnerPayout,
  type PayRateSet,
  type PriceChange,
  type PriceCorrection,
  type PriceWithdrawal,
  type ServiceAdd,
  type ServiceUsage,
  type StaffTokenAdd,
  setOnly,
} from "../api.ts";
import type { paths } from "../api-schema.ts";

export const settingsApi = {
  addHairSystem: (body: Sent<paths["/api/hair-systems"]["post"]>) => client.post("/api/hair-systems", { body }),
  addSupplier: (body: Sent<paths["/api/suppliers"]["post"]>) => client.post("/api/suppliers", { body }),
  changeSupplier: (id: string, body: Sent<paths["/api/suppliers/{id}"]["post"]>) =>
    client.post("/api/suppliers/{id}", { path: { id }, body }),
  removeSupplierItem: (id: string, code: string) =>
    client.post("/api/suppliers/{id}/items/{code}/remove", { path: { id, code } }),
  setStandardCost: (body: Sent<paths["/api/standard-costs"]["post"]>) => client.post("/api/standard-costs", { body }),
  setSupplierItem: (id: string, body: Sent<paths["/api/suppliers/{id}/items"]["post"]>) =>
    client.post("/api/suppliers/{id}/items", { path: { id }, body }),
  standardCosts: () => client.get("/api/standard-costs"),
  suppliers: () => client.get("/api/suppliers"),
  retireSupplier: (id: string) => client.post("/api/suppliers/{id}/retire", { path: { id } }),
  restoreSupplier: (id: string) => client.post("/api/suppliers/{id}/restore", { path: { id } }),
  /** Every rule ops may change, with its unit, its bounds and who last set it (ADR 0061). */
  settings: () => client.get("/api/settings"),
  /** What the photographs and referral cards hold in R2, against their share (ADR 0093). */
  storage: () => client.get("/api/storage"),
  /** One rule. A null value puts the figure in the code back and removes the row. */
  setSetting: (name: OpsSetting["name"], value: SettingValue | null) =>
    client.post("/api/settings/{name}", { path: { name }, body: { value } }),
  /** A price from the day it applies. The book gains a row; nothing already invoiced moves. */
  setPrice: (price: PriceChange) => client.post("/api/prices", { body: price }),
  /** A price still to come, taken back. The route refuses the one in force and every spent one. */
  withdrawPrice: (row: PriceWithdrawal) => client.post("/api/prices/withdraw", { body: row }),
  /** A price still to come, taken back and set again, from its own day or another, in one go. */
  correctPrice: (correction: PriceCorrection) => client.post("/api/prices/correct", { body: correction }),
  /** Every service, offered or retired, with every price it has had and is to have, and the two late fees. */
  services: () => client.get("/api/services"),
  /** Added last in its kind; clients see it once it has a price. */
  addService: (service: ServiceAdd) => client.post("/api/services", { body: service }),
  /** Its code stays, and with it every price it has and every visit sold under them. */
  renameService: (kind: Kind, tier: string, name: string) =>
    client.post("/api/services/{kind}/{tier}/name", { path: { kind, tier }, body: { name } }),
  /** The line clients read under its name as they choose; an empty one clears it. */
  describeService: (kind: Kind, tier: string, description: string) =>
    client.post("/api/services/{kind}/{tier}/description", { path: { kind, tier }, body: { description } }),
  /** How long visits booked from now on are held and booked for. */
  setServiceLength: (kind: Kind, tier: string, minutes: number) =>
    client.post("/api/services/{kind}/{tier}/length", { path: { kind, tier }, body: { minutes } }),
  /** Every one of a kind's codes, once, first to last. */
  orderServices: (kind: Kind, tiers: readonly string[]) =>
    client.post("/api/services/{kind}/order", { path: { kind }, body: { tiers: [...tiers] } }),
  /** No longer offered from a day, today or later. The route keeps every kind one service to book. */
  retireService: (kind: Kind, tier: string, from: string) =>
    client.post("/api/services/{kind}/{tier}/retire", { path: { kind, tier }, body: { from } }),
  restoreService: (kind: Kind, tier: string) =>
    client.post("/api/services/{kind}/{tier}/restore", { path: { kind, tier } }),
  partnerStatements: (month: string | null) => client.get("/api/partner-statements", { query: setOnly({ month }) }),
  recordPartnerPayout: (id: string, payout: PartnerPayout) =>
    client.post("/api/partner-statements/{id}/payouts", { path: { id }, body: payout }),
  deletePartnerPayout: (id: string, month: string) =>
    client.post("/api/partner-statements/{id}/payouts/{month}/delete", { path: { id, month } }),
  technicianPay: () => client.get("/api/technician-pay"),
  payStatement: (month: string) => client.get("/api/technician-pay/statement", { query: { month } }),
  addPayGrade: (name: string) => client.post("/api/technician-pay/grades", { body: { name } }),
  renamePayGrade: (id: string, name: string) =>
    client.patch("/api/technician-pay/grades/{id}", { path: { id }, body: { name } }),
  /** Refused, as in_use, while a technician holds it or a rate has named it. */
  deletePayGrade: (id: string) => client.post("/api/technician-pay/grades/{id}/delete", { path: { id } }),
  /** From today or later; an amount of null leaves the grade no rate of its own from that day. */
  setPayRate: (rate: PayRateSet) => client.post("/api/technician-pay/rates", { body: rate }),
  setPayGradeOf: (technicianId: string, gradeId: string | null) =>
    client.post("/api/technician-pay/technicians/{id}", { path: { id: technicianId }, body: { grade_id: gradeId } }),
  /** Every day from today on that no visit is offered, with what is still booked on each. */
  blackouts: () => client.get("/api/blackouts"),
  /** The visits still booked on the days from the first to the last, which closing them strands. */
  blackoutsBooked: (period: BlackoutRemove) => client.get("/api/blackouts/booked", { query: period }),
  /** Every day from the first to the last, both included. A day already blacked out takes this reason. */
  addBlackouts: (period: BlackoutAdd) => client.post("/api/blackouts", { body: period }),
  /** The days from the first to the last are offered again. */
  removeBlackouts: (period: BlackoutRemove) => client.post("/api/blackouts/remove", { body: period }),
  /** The latest codes made, or the one with this text, each with its uses and what it has given. */
  discountCodes: (code: string | null = null) =>
    client.get("/api/discount-codes", code === null ? {} : { query: { code } }),
  /** One code typed, or one or more generated; more than one generated are single-use. */
  makeDiscountCodes: (codes: DiscountCodesNew) => client.post("/api/discount-codes", { body: codes }),
  /** No booking takes it from now on; the bookings that carry it keep it. */
  switchOffDiscountCode: (id: string) => client.post("/api/discount-codes/{id}/off", { path: { id } }),
  /** Refused, as in_use, once a booking has taken it. */
  deleteDiscountCode: (id: string) => client.post("/api/discount-codes/{id}/delete", { path: { id } }),
  /** Every consumable, and each service's expected use. */
  consumables: () => client.get("/api/consumables"),
  addConsumable: (added: NewConsumable) => client.post("/api/consumables", { body: added }),
  /** Only the fields sent change; a null level clears it. */
  changeConsumable: (code: string, change: ConsumableChange) =>
    client.post("/api/consumables/{code}", { path: { code }, body: change }),
  /** No longer offered from the day given, today or later. Nothing already recorded moves. */
  retireConsumable: (code: string, from: string) =>
    client.post("/api/consumables/{code}/retire", { path: { code }, body: { from } }),
  restoreConsumable: (code: string) => client.post("/api/consumables/{code}/restore", { path: { code } }),
  /** Refused, as in_use, once stock of it has moved or a job used it. */
  deleteConsumable: (code: string) => client.post("/api/consumables/{code}/delete", { path: { code } }),
  /** A service's whole list: a consumable left out is expected no more. */
  setServiceUsage: (usage: ServiceUsage) => client.post("/api/service-usage", { body: usage }),
  jobSheet: () => client.get("/api/job-sheet"),
  /** A kind of visit's whole checklist, in its order. An item left out is retired, not forgotten. */
  setChecklist: (type: VisitType, items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/checklists/{visit_type}", { path: { visit_type: type }, body: { items: [...items] } }),
  setPartialReasons: (items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/partial-reasons", { body: { items: [...items] } }),
  setLostReasons: (items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/lost-reasons", { body: { items: [...items] } }),
  /** The Staff list, narrowed to the places the caller may see. */
  staff: () => client.get("/api/staff"),
  /** A person added, or their grants and whether they are let in replaced whole. */
  saveStaff: (person: StaffSave) => client.post("/api/staff", { body: person }),
  deleteStaff: (email: string) => client.post("/api/staff/delete", { body: { email } }),
  setEnforcement: (on: boolean) => client.post("/api/staff/enforcement", { body: { on } }),
  addServiceToken: (token: StaffTokenAdd) => client.post("/api/staff/service-tokens", { body: token }),
  removeServiceToken: (clientId: string) =>
    client.post("/api/staff/service-tokens/remove", { body: { client_id: clientId } }),
};
