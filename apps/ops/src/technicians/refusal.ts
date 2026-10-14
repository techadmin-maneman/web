// Why the API refused a change to a technician, in the console's words: nothing changed either way.

import { technicians } from "../content.ts";

const ERRORS: Readonly<Record<string, string | undefined>> = technicians.errors;

export const refusal = (code: string): string => ERRORS[code] ?? technicians.errors.unknown;
