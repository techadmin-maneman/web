// The hair systems a local database sells first fits as: scripts/dev/seed-local.ts adds each as a first-fit service. Every
// name and price is made up; prices are in paise before GST.

export const LOCAL_HAIR_SYSTEMS = [
  { tier: "essential", name: "Mane Man Essential", price: 2_500_000 },
  { tier: "active", name: "Mane Man Active", price: 3_000_000 },
  { tier: "natural", name: "Mane Man Natural", price: 3_500_000 },
  { tier: "natmax", name: "Mane Man NatMax", price: 4_000_000 },
] as const;
