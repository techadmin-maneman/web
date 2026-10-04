// A person's name as the public forms take it. Our WhatsApp messages greet people by the name they gave ("Hi
// {{1}}"), so a "name" that is a link or a number would go out from our number as if we wrote it.

/** The longest name a form takes. */
export const MOST_NAME_LENGTH = 60;

/** Letters in any script, with the spaces, dots, apostrophes and hyphens names hold, starting with a letter. */
const PERSON_NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;

/** Whether `typed`, trimmed, can stand as a person's name: letters only, no digits, links or symbols. */
export function isPersonName(typed: string): boolean {
  const name = typed.trim();
  return name.length <= MOST_NAME_LENGTH && PERSON_NAME.test(name);
}
