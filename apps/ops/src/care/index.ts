// What the Care feature offers the rest of the app; every other feature imports it from here alone.

import { careApi } from "./care-api.ts";

export type { CareNumbers, Conversation } from "./care-api.ts";

/** A remedy past the limit approved or declined, as its task's drawer decides it. */
export const decideRemedy = (id: string, approve: boolean) => careApi.decideRemedy(id, approve);
export { ClientChat, useCarePerson } from "./ClientChat.tsx";
export { ReportPhotos } from "./ReportPhotos.tsx";
