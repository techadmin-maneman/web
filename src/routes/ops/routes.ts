// Every route the console's surface answers, behind Access, in the order they are registered (src/app.ts).

import type { App } from "../../http/context.ts";
import { registerClientErrors } from "../client-errors.ts";
import { registerHealth } from "../health.ts";
import { registerOpsActivity } from "./activity.ts";
import { registerOpsAlerts } from "./alerts.ts";
import { registerOpsBlackouts } from "./blackouts.ts";
import { registerOpsCareNumbers } from "./care-numbers.ts";
import { registerOpsCarePeople } from "./care-people.ts";
import { registerOpsCareRota } from "./care-rota.ts";
import { registerOpsCities } from "./cities.ts";
import { registerOpsCityMatters } from "./city-matters.ts";
import { registerOpsClientAddress } from "./client-address.ts";
import { registerOpsClientConsents } from "./client-consents.ts";
import { registerOpsClientPhotos } from "./client-photos.ts";
import { registerOpsClientPieces } from "./client-pieces.ts";
import { registerOpsClientRecord } from "./client-record.ts";
import { registerOpsClientReferral } from "./client-referral.ts";
import { registerOpsClients } from "./clients.ts";
import { registerOpsConsumables } from "./consumables.ts";
import { registerOpsConversations } from "./conversations.ts";
import { registerOpsCountTasks } from "./count-tasks.ts";
import { registerOpsCredits } from "./credits.ts";
import { registerOpsCustomOrders } from "./custom-orders.ts";
import { registerOpsDemandEvents } from "./demand-events.ts";
import { registerOpsDiscountCodes } from "./discount-codes.ts";
import { registerOpsDispatchDay } from "./dispatch-day.ts";
import { registerOpsDispatchMoves } from "./dispatch-moves.ts";
import { registerOpsDispatch } from "./dispatch.ts";
import { registerOpsDisputes } from "./disputes.ts";
import { registerOpsErasure } from "./erasure.ts";
import { registerOpsField } from "./field.ts";
import { registerOpsGrievances } from "./grievances.ts";
import { registerOpsHairProfile } from "./hair-profile.ts";
import { registerOpsHairSystems } from "./hair-systems.ts";
import { registerOpsJobSheet } from "./job-sheet.ts";
import { registerOpsNoShowRulings } from "./no-show-rulings.ts";
import { registerOpsNoShows } from "./no-shows.ts";
import { registerOpsPartnerStatements } from "./partner-statements.ts";
import { registerOpsPaymentLinks } from "./payment-links.ts";
import { registerOpsPaymentRefunds } from "./payment-refunds.ts";
import { registerOpsPayments } from "./payments.ts";
import { registerOpsPrices } from "./prices.ts";
import { registerOpsProfile } from "./profile.ts";
import { registerOpsClaims } from "./purchasing.claims.ts";
import { registerOpsStockPhotos } from "./purchasing.photos.ts";
import { registerOpsReceipts } from "./purchasing.receipts.ts";
import { registerOpsScorecard } from "./purchasing.scorecard.ts";
import { registerOpsPurchasing } from "./purchasing.ts";
import { registerOpsQuickReplies } from "./quick-replies.ts";
import { registerOpsRecalls } from "./recalls.ts";
import { registerOpsReferralChannels } from "./referral-channels.ts";
import { registerOpsReferrals } from "./referrals.ts";
import { registerOpsRemedies } from "./remedies.ts";
import { registerOpsServiceArea } from "./service-area.ts";
import { registerOpsServices } from "./services.ts";
import { registerOpsSettings } from "./settings.ts";
import { registerOpsSlotTimes } from "./slot-times.ts";
import { registerOpsSpend } from "./spend.ts";
import { registerOpsStaff } from "./staff.ts";
import { registerOpsStandardCosts } from "./standard-costs.ts";
import { registerOpsForecast } from "./stock-forecast.ts";
import { registerOpsStockMatch } from "./stock-match.ts";
import { registerOpsStockQuality } from "./stock-quality.ts";
import { registerOpsStockUsage } from "./stock-usage.ts";
import { registerOpsStockPlaces } from "./stock.places.ts";
import { registerOpsStockDemand } from "./stock.read.ts";
import { registerOpsStockTransit } from "./stock.transit.ts";
import { registerOpsStock } from "./stock.ts";
import { registerOpsStockUnits } from "./stock.units.ts";
import { registerOpsStorage } from "./storage.ts";
import { registerOpsStrangers } from "./strangers.ts";
import { registerOpsSuppliers } from "./suppliers.ts";
import { registerOpsSupplyPlan } from "./supply-plan.ts";
import { registerOpsTargets } from "./targets.ts";
import { registerOpsTasks } from "./tasks.ts";
import { registerOpsTechnicianLeave } from "./technician-leave.ts";
import { registerOpsTechnicianPay } from "./technician-pay.ts";
import { registerOpsTechnicianPhones } from "./technician-phones.ts";
import { registerOpsTechnicians } from "./technicians.ts";
import { registerOpsVisitChanges } from "./visit-changes.ts";
import { registerOpsVisitLostReason } from "./visit-lost-reason.ts";
import { registerOpsVisits } from "./visits.ts";
import { registerOpsWaitlist } from "./waitlist.ts";
import { registerOpsWhoami } from "./whoami.ts";
import { registerOpsWords } from "./words.ts";

export const OPS_ROUTES: readonly ((app: App) => void)[] = [
  registerHealth,
  registerClientErrors,
  registerOpsClients,
  registerOpsClientRecord,
  registerOpsClientPhotos,
  registerOpsClientConsents,
  registerOpsCredits,
  // A visit ops book for a client: at once, or by a payment link.
  registerOpsVisits,
  // A visit ops cancel for a client, or close by hand for a technician whose phone was lost.
  registerOpsVisitChanges,
  registerOpsClientReferral,
  // An address a client gives ops on the phone (docs/decisions/0092-task-owners.md).
  registerOpsClientAddress,
  // A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md).
  registerOpsHairProfile,
  // The stock code a client's profile matches, and where its pieces are (docs/decisions/0173-matching-a-client-to-stock.md).
  registerOpsStockMatch,
  // Custom orders, paid in full before they are ordered (docs/decisions/0174-custom-orders.md).
  registerOpsCustomOrders,
  // The demand forecast (docs/decisions/0179-demand-forecast.md).
  registerOpsForecast,
  // The supply plan drafted from it (docs/decisions/0180-supply-plan.md).
  registerOpsSupplyPlan,
  // The events calendar the forecast reads (docs/decisions/0182-the-events-calendar.md).
  registerOpsDemandEvents,
  // Cycle counts, blind, with recounts and sign-off (docs/decisions/0185-cycle-counts.md).
  registerOpsCountTasks,
  // Usage against expected, and shrinkage (docs/decisions/0186-usage-and-shrinkage.md).
  registerOpsStockUsage,
  // Recalls: a lot blocked everywhere, and who wears it (docs/decisions/0187-recalls.md).
  registerOpsRecalls,
  // Failure rates and value at risk (docs/decisions/0188-failure-rates-and-value-at-risk.md).
  registerOpsStockQuality,
  // Erasing a client from their page, the day they ask.
  registerOpsErasure,
  registerOpsProfile,
  registerOpsReferrals,
  // Partners who send us clients on their own code (docs/decisions/0123-partner-referral-channels.md).
  registerOpsPartnerStatements,
  registerOpsConversations,
  registerOpsCarePeople,
  registerOpsCareRota,
  registerOpsCityMatters,
  registerOpsStrangers,
  registerOpsQuickReplies,
  registerOpsSpend,
  registerOpsStandardCosts,
  registerOpsTargets,
  registerOpsVisitLostReason,
  registerOpsRemedies,
  registerOpsCareNumbers,
  registerOpsReferralChannels,
  registerOpsWords,
  registerOpsGrievances,
  registerOpsActivity,
  registerOpsWaitlist,
  registerOpsDispatch,
  registerOpsDispatchDay,
  registerOpsDispatchMoves,
  registerOpsNoShows,
  registerOpsClientPieces,
  registerOpsField,
  registerOpsTechnicianLeave,
  registerOpsTechnicianPhones,
  registerOpsNoShowRulings,
  registerOpsDisputes,
  registerOpsTasks,
  // The alerts on Tasks' "Needs a hand".
  registerOpsAlerts,
  registerOpsPayments,
  registerOpsPaymentRefunds,
  // A one visit's payment link texted to the client again.
  registerOpsPaymentLinks,
  registerOpsTechnicians,
  // What technicians are paid for each visit (docs/decisions/0122-technician-pay-per-visit.md).
  registerOpsTechnicianPay,
  registerOpsSettings,
  registerOpsPrices,
  registerOpsServiceArea,
  // Our cities, their GST registrations, and what a city sets apart (docs/decisions/0198-cities-as-data.md).
  registerOpsCities,
  // The day's half-slot times, from a day nothing is booked or bookable on (docs/decisions/0102-window-times.md).
  registerOpsSlotTimes,
  // The days no visit is offered (docs/decisions/0088-every-policy-in-the-console.md).
  registerOpsBlackouts,
  // The services clients book (docs/decisions/0085-services-ops-can-edit.md).
  registerOpsServices,
  // The consumables, the job sheet and the stock (docs/decisions/0087-consumables-and-stock.md).
  registerOpsConsumables,
  // A hair system's stock code (docs/decisions/0156-hair-systems-in-stock.md).
  registerOpsHairSystems,
  registerOpsJobSheet,
  registerOpsStock,
  // Where stock is kept, as a tree (docs/decisions/0155-the-stock-place-tree.md).
  registerOpsStockPlaces,
  // Transfers in transit (docs/decisions/0158-transfers-in-transit.md).
  registerOpsStockTransit,
  // What the weeks ahead will use (docs/decisions/0160-demand-and-opening-counts.md).
  registerOpsStockDemand,
  // Pieces as units, and labels (docs/decisions/0161-pieces-as-units.md).
  registerOpsStockUnits,
  // Suppliers, and what each supplies (docs/decisions/0165-suppliers.md).
  registerOpsSuppliers,
  // Purchase orders (docs/decisions/0166-purchase-orders.md).
  registerOpsPurchasing,
  // Receipts against them, with landed cost (docs/decisions/0167-receipts-and-landed-cost.md).
  registerOpsReceipts,
  // Claims on suppliers, and returned pieces settled (docs/decisions/0169-supplier-claims.md).
  registerOpsClaims,
  // Photographs of stock: a write-off's, and a claim's (docs/decisions/0170-stock-photos.md).
  registerOpsStockPhotos,
  // Each supplier's scorecard (docs/decisions/0172-supplier-scorecard.md).
  registerOpsScorecard,
  // What the photographs and cards hold in R2 (docs/decisions/0093-the-storage-meter.md).
  registerOpsStorage,
  registerOpsWhoami,
  // Discount codes, and a code on a client's visit (docs/decisions/0108-discount-codes.md).
  registerOpsDiscountCodes,
  // Who may do what in the console.
  registerOpsStaff,
];
