// The console's frame: its navigation by department, its header and the person signed in.

/** The five departments, as the navigation heads its sections and the Staff page names a grant. */
export const DEPARTMENT_NAMES = {
  operations: "Operations",
  customer_care: "Customer Care",
  finance: "Finance",
  growth: "Growth",
  admin: "Admin",
} as const;

export const shell = {
  /** Who did something, where it was a service token rather than a person. */
  serviceToken: "a service token",
  /**
   * The sidebar's own title. The design letters it "Operations", which is now the name of one of the
   * departments beneath it.
   */
  title: "Console",
  departments: DEPARTMENT_NAMES,
  /** Our words where no board draws it: each section's name in the navigation, which the design draws flat. */
  sections: {
    tasks: "Tasks",
    dispatch: "Dispatch",
    technicians: "Technicians",
    stock: "Stock",
    clients: "Clients",
    grievances: "Concerns",
    "number-changes": "Number changes",
    "deletion-requests": "Deletion requests",
    "no-shows": "Payments",
    prices: "Prices",
    "discount-codes": "Discount codes",
    referrals: "Referrals",
    areas: "Areas",
    settings: "Settings",
    staff: "Staff",
    activity: "Activity",
  },
  /** A section's name in the navigation, read out with the count of tasks waiting in it. */
  waiting: (section: string, count: number, overdue: boolean) =>
    overdue ? `${section}, ${String(count)} waiting, some overdue` : `${section}, ${String(count)} waiting`,
  /** Stock's badge read out: the places low on something. */
  lowPlaces: (section: string, count: number) => `${section}, ${String(count)} ${count === 1 ? "place" : "places"} low`,
  /** The first thing the keyboard reaches, which jumps past the navigation. */
  skip: "Skip to content",
  /** A page opened by its address that the person's access does not reach. */
  closed: "Your access does not reach this page. An Admin can add it on the Staff page.",
  /** The browser tab's title: "Blackout days · Settings · Mane Man operations". */
  documentTitle: (parts: readonly string[]) => [...parts, "Mane Man operations"].join(" · "),
  /**
   * Who is signed in, where the design draws "AK" in a box at the
   * header's right, and a way out, which it does not draw. Signing out ends the
   * Cloudflare Access session, which is the only session the console has.
   */
  account: {
    signedInAs: (who: string) => `Signed in as ${who}`,
    signOut: "Sign out",
  },
  /** The header's way to a client from any page, which the board does not draw. */
  find: {
    label: "Find a client by name or number",
    placeholder: "Name or number",
    submit: "Find client",
  },
  /**
   * Cloudflare Access ends a session after the time the team sets,
   * and from then on every call is sent to its login page instead of reaching
   * us. Reloading the page is what takes ops there.
   */
  lapsed: "Your sign-in to the console has run out, so nothing more can be read or saved. Reload to sign in again.",
  reload: "Reload",
  /** A person Access lets in whom the enforced Staff list does not name. */
  notListed: "You are not on the Staff list, so the console is closed to you. Ask the owner to add you.",
} as const;
