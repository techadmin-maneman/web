// The national daily ceilings by name (src/domain/platform/ceilings.ts), each counted as `ceiling:<name>`.

export const CEILINGS = [
  "upload",
  "render",
  "result_read",
  "login_code",
  "tech_code",
  "form_code",
  "geocode",
  "route",
  "route_map",
] as const;

export type Ceiling = (typeof CEILINGS)[number];
