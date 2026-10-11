// A partner's link as a QR code for their counter (docs/decisions/0124-partner-statements.md): black on white with
// the quiet border the standard asks for, and enough error correction to scan through a scuffed print.

import { renderSVG } from "uqr";

export const partnerQr = (link: string): string => renderSVG(link, { ecc: "M", border: 4 });
