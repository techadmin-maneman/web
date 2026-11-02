// Who is signed in: at a desk in the navigation's foot, their initials, name and e-mail; on a phone their initials at
// the top right. Either opens their e-mail, the theme, and the way out, which ends the Cloudflare Access session, the
// only session the console has.

import { Popover, PopoverGroup, PopoverLink, PopoverNote } from "@maneman/ui/Popover";
import { NavAccount } from "@maneman/ui/SideNav";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useLoad } from "@maneman/ui/useLoad";
import { shell } from "../content.ts";
import { whoami } from "../lib/access.ts";
import { forgetClients } from "../lib/client-search.ts";
import { THEMES, useTheme } from "../lib/theme.ts";
import { nameParts, staffName, whoWords } from "../lib/who.ts";

/** "aditya.kumar@maneman.in" reads "AK", and "ops@maneman.in" "OP". */
function initialsOf(who: string): string {
  const [first = "", second = ""] = nameParts(who);
  const letters = second === "" ? first.slice(0, 2) : `${first.slice(0, 1)}${second.slice(0, 1)}`;
  return letters.toUpperCase();
}

function ThemeChoice() {
  const [theme, choose] = useTheme();
  return (
    <PopoverGroup label={shell.account.theme}>
      {THEMES.map((each) => (
        <ToggleButton
          key={each}
          pressed={theme === each}
          onClick={() => {
            choose(each);
          }}
        >
          {shell.account.themes[each]}
        </ToggleButton>
      ))}
    </PopoverGroup>
  );
}

/** What the account's button opens: who is signed in, the theme, and the way out. */
function Panel({ who, signOut }: { readonly who: string; readonly signOut: string | null }) {
  return (
    <>
      <PopoverNote>{whoWords(who)}</PopoverNote>
      <ThemeChoice />
      {signOut !== null && (
        <PopoverLink href={signOut} onClick={forgetClients}>
          {shell.account.signOut}
        </PopoverLink>
      )}
    </>
  );
}

/** On a phone: their initials at the top right. */
export function Account() {
  const [loaded] = useLoad(whoami);
  if (loaded.state !== "loaded") return null;
  const { signed_in_as: who, sign_out: signOut } = loaded.value;
  return (
    <Popover label={shell.account.label} button={initialsOf(whoWords(who))}>
      {() => <Panel who={who} signOut={signOut} />}
    </Popover>
  );
}

/** At a desk: the navigation's foot, their name over their e-mail; a token's, System. */
export function FootAccount() {
  const [loaded] = useLoad(whoami);
  if (loaded.state !== "loaded") return null;
  const { signed_in_as: who, sign_out: signOut } = loaded.value;
  const person = who.includes("@");
  const name = person ? staffName(who) : whoWords(who);
  return (
    <NavAccount
      label={shell.account.named(name)}
      initials={initialsOf(whoWords(who))}
      name={name}
      detail={person ? who : undefined}
    >
      {() => <Panel who={who} signOut={signOut} />}
    </NavAccount>
  );
}
