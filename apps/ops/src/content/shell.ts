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
  /** Whatever the console did by itself, or a token for the console did: never its ID or its label. */
  serviceToken: "System",
  /** The sidebar's own title: the console's name. */
  title: "Mane Man Ops",
  /** The header's way to the navigation, in a window too narrow to keep it beside the page. */
  menu: "Menu",
  closeMenu: "Close menu",
  departments: DEPARTMENT_NAMES,
  /** Each page's name, as its title and its tab say it. */
  sections: {
    today: "Today",
    tasks: "Tasks",
    dispatch: "Dispatch",
    clients: "Clients",
    messages: "Messages",
    technicians: "Technicians",
    stock: "Stock",
    counts: "Counts",
    purchasing: "Purchasing",
    "supply-plan": "Supply plan",
    quality: "Quality",
    usage: "Usage",
    items: "Items",
    suppliers: "Suppliers",
    grievances: "Concerns",
    "number-changes": "Number changes",
    "deletion-requests": "Deletion requests",
    ledger: "Payments",
    payments: "Charges",
    "technician-pay": "Technician pay",
    "partner-commission": "Partner commission",
    funnel: "Funnel",
    referrals: "Referrals",
    waitlist: "Waitlist",
    spend: "Spend",
    "care-numbers": "Care numbers",
    activity: "Activity",
  },
  /** The navigation's entries. */
  nav: {
    today: "Today",
    tasks: "Tasks",
    dispatch: "Dispatch",
    clients: "Clients",
    messages: "Messages",
    technicians: "Technicians",
    inventory: "Inventory",
    requests: "Requests",
    money: "Money",
    growth: "Growth",
    reports: "Reports",
  },
  /** The navigation's groups, in its order (../route.ts, NAV_GROUPS). */
  navGroups: {
    work: "Work",
    people: "People",
    business: "Running the business",
    admin: DEPARTMENT_NAMES.admin,
  },
  /** The phone's last tab, and the page it opens: the rest of the navigation, and the city. */
  more: "More",
  settings: "Settings",
  fold: "Collapse",
  unfold: "Expand",
  search: "Search",
  /** The key that takes the keyboard to the header's search, from anywhere but a box. */
  searchKey: "/",
  crumbs: "Breadcrumb",
  /** What the header's search finds (../frame/Search.tsx): clients, technicians, then pages. */
  palette: {
    label: "Page, technician or client",
    none: "Nothing matches.",
    clients: "Clients",
    technicians: "Technicians",
    pages: "Pages",
    setting: (page: string) => `Settings · ${page}`,
  },
  /**
   * The city every page is narrowed to, chosen in the header, read out with the city it shows; on a phone, the chips
   * under Today's and Dispatch's titles, named alike.
   */
  city: {
    name: "City",
    label: (city: string) => `City: ${city}`,
  },
  /** A section's name in the navigation, read out with the count of tasks waiting in it. */
  waiting: (section: string, count: number, overdue: boolean) =>
    overdue ? `${section}, ${String(count)} waiting, some overdue` : `${section}, ${String(count)} waiting`,
  /** Stock's badge read out: the places low on something. */
  lowPlaces: (section: string, count: number) => `${section}, ${String(count)} ${count === 1 ? "place" : "places"} low`,
  /** The first thing the keyboard reaches, which jumps past the navigation. */
  skip: "Skip to content",
  /** A page opened by its address that the person's access does not reach. */
  closed: "You don’t have access to this page. An admin can grant it on Staff.",
  /** The browser tab's title: "Blackout days · Settings · Mane Man Ops". */
  documentTitle: (parts: readonly string[]) => [...parts, "Mane Man Ops"].join(" · "),
  /** The header's list of the tasks given to the person signed in, with how many are new to them. */
  mine: {
    button: "Mine",
    label: (unseen: number) => (unseen === 0 ? "My tasks" : `My tasks, ${String(unseen)} new`),
    none: "Nothing is yours.",
    item: (kind: string, subject: string) => `${kind} · ${subject}`,
  },
  /** Who is signed in, the theme, and the way out: Access's own session, which is the only one the console has. */
  account: {
    label: "Account",
    /** The navigation's foot, read out with the name it shows. */
    named: (name: string) => `Account, ${name}`,
    signOut: "Sign out",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
  },
  /**
   * Cloudflare Access ends a session after the time the team sets,
   * and from then on every call is sent to its login page instead of reaching
   * us. Reloading the page is what takes ops there.
   */
  lapsed: "Your session has expired. Reload to sign in.",
  reload: "Reload",
  /** A person Access lets in whom the enforced Staff list does not name. */
  notListed: "You’re not on the Staff list. Ask an admin to add you.",
} as const;
