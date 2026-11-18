// A message's kind in words, where the console names one: a Care thread's automatic messages, and Tasks' messages not
// delivered.

/** "Visit reminder" from "visit_reminder". */
export const messageKindName = (kind: string): string => {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
