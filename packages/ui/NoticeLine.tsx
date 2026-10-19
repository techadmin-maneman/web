// A consent's one line and its link to the full notice (src/config/notices.ts, OneLine): the words in the line that
// name the notice, or, where none do, a word of its own after it. The notice opens in a new tab, so a form or a photo
// half done stays as it was.

import { TextLink, type TextTone } from "./TextLink.tsx";

export function NoticeLine({
  line,
  href,
  more,
  tone = "plain",
}: {
  readonly line: { readonly says: string; readonly link: string | null };
  /** The notice's section on the site's /notices page. */
  readonly href: string;
  /** The link's words where the line names no notice: "Details". */
  readonly more: string;
  readonly tone?: TextTone;
}) {
  const at = line.link === null ? -1 : line.says.indexOf(line.link);
  if (line.link === null || at < 0) {
    return (
      <>
        {`${line.says} `}
        <TextLink tone={tone} inline newTab href={href}>
          {more}
        </TextLink>
      </>
    );
  }
  return (
    <>
      {line.says.slice(0, at)}
      <TextLink tone={tone} inline newTab href={href}>
        {line.link}
      </TextLink>
      {line.says.slice(at + line.link.length)}
    </>
  );
}
