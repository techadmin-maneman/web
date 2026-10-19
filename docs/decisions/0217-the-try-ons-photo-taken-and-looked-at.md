# 0217. The try-on's photo, taken and looked at; no question of where the hair loss is

- Status: accepted
- Date: 2026-10-19
- Topic: The site
- Amends [0104](0104-the-try-ons-look-on-whatsapp-only.md) and [0214](0214-from-the-site-into-the-app.md)

## Context

On 19 October 2026 the owner found the try-on's photo step on a phone awkward and asked for it to be world class. The
camera opened inside the page's frame below the guidelines, so on a phone its shutter sat above the view, off the
screen; a photo went on to the consent the moment it was taken, never shown first. The owner also asked that the
three-way question of where the hair loss is (crown, front, advanced) go from every place it was asked, and that a
visitor back after their look be shown it.

## Decision

1. **The camera over the page.** `@maneman/ui/PhotoCapture` is a native modal dialog: the whole screen on a phone,
   a frame of the phone apps' column on a wider screen. The front camera's view fills it, mirrored as a mirror shows,
   with the oval a face is framed to and the view around it dimmed; one line above says what to frame, and the
   shutter sits at the foot, in the middle. The photograph is the part of the frame the view showed, mirrored to match.
   A phone's Back and Escape close it, through the sheets' history (`afterSheets` keeps the try-on's own entries in
   step).
2. **Looked at before it is used.** A photo taken, or chosen from the files, shows in the same dialog with Retake (or
   Choose another) and Use photo. Too dark, or blank, it says so over the photo; the visitor may still use it. Only
   Use photo goes on to the consent.
3. **Where the camera is blocked,** the page says so, and Take a photo then opens the phone's own camera through a
   file input. A device with no camera is offered Choose a photo alone.
4. **No question of where the hair loss is.** The try-on's stage screen goes, and with it a step: the try-on is three
   steps. /book and the waitlist no longer ask either. The render never read the stage; the claim takes one from the
   site of the release before and keeps none of it, so leads and try-ons from here on record none. The column stays,
   for the leads that have one, and the CRM sends it where there is one.
5. **A returning visitor sees their look.** `GET /api/tryon/look` gives a ready look whose number the gate proved its
   signed link, as the status does (ADR 0214), to the browser whose cookie names it. The sent screen shows it alone:
   the page no longer holds the photograph beside it.

## Consequences

- The privacy notice still lists the extent of hair loss among what a booking keeps; counsel can take it out at the
  notice's next revision.
- The design board's stage screen pairs with nothing in the fidelity run.
- The technician app's camera keeps its own screen; it reads a frame's light through the same
  `@maneman/web-kit/small-jpeg` `lightOf` the try-on uses.
