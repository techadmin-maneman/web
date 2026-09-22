# Phase 2 inputs: how to get them

What P2-M2 (the FSM mirror and read surfaces) and P2-M3 (referral and waitlist) need from you, in the order to start them. Anything that could be looked up has already been researched from public sources, and the findings are recorded under each input, dated 22 September 2026. What is left are the steps only you can take: accounts, keys, prices and rulings.

Longest lead times first: DLT registration (1–2 weeks), counsel, and the CA's GST answers. Start those now.

## How to hand things over

- **Secrets** (API keys, webhook secrets, refresh tokens, auth keys). Save them in a file at the repository root on this computer, named as each section says (for example `.env.razorpay-staging`), one `NAME=value` per line. Git ignores every `.env.*` file. Then tell me the file name; I set the values on the Workers without printing them. Never paste a secret into chat, email or WhatsApp.
- **Files with personal data** (ops' referral log). Put them in `private/` at the repository root. Git ignores that folder.
- **Decisions and rulings.** Reply in chat. I record each one in the conflicts register (ADR 0025).

## Before P2-M2

### 1. The real Zoho org, with FSM and Books

Production still runs on the Zoho CRM Developer Edition org (ADR 0020). FSM and Books must sit in the same organisation as the real CRM, so the real org comes first.

1. Create the real Zoho organisation on the **India data centre** (sign up at `zoho.in`, not `zoho.com`), and set up CRM as in the runbook's step 8.
2. In the same organisation, sign up for **Zoho Books** (India edition). FSM's sign-up asks for a Books (or Zoho Invoice) organisation to link, so Books comes before FSM.
3. Sign up for **Zoho FSM** in the same organisation. It starts a 15-day trial of the Premium edition, which can be extended once. Start it only when you can spend time on section 2 in those days.
4. Tell me when all three exist. I then move production off the test org, following ADR 0020's steps.

**What it costs** (Zoho's India price lists, 22 September 2026, before GST):

- **FSM is priced by appointments a month, not by users.** For example, Professional is ₹1,500 a month billed yearly for 60 appointments, and ₹2,500 for 100. Users are free, up to 200 on Standard and Professional. Cancelled appointments still count, and unused ones do not carry over.
- **We need FSM Professional.** Assets (the pieces) and job sheets (checklists, consumables, photographs) are Professional and above.
- **Books:** Professional (₹1,499 a month billed yearly) is the first plan with retainer invoices, if section 6 settles on them. Standard is ₹749.

### 2. The FSM trial findings

`docs/decisions/fsm-trial.md` lists ten questions. Zoho's documentation answers most of them. The rest need a real trial org, and I can test those myself if you give me API access to the trial (section 3).

**Already answered from the documentation:**

| Question        | Finding                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host and OAuth  | API at `fsm.zoho.in/fsm/v1`, accounts at `accounts.zoho.in`. A Self Client suits our server. Access tokens last an hour; refresh tokens don't expire.                                                                                                                                 |
| Limits          | Calls a day per org: 5,000 on trial and Free, 25,000 Standard, 50,000 Professional, 100,000 Premium. At most 15 calls at once (5 on Free).                                                                                                                                            |
| Webhooks        | Set up in FSM (Setup → Automation → Webhooks) and fired by workflow rules on create, edit or delete of appointments, work orders, assets and more. **They are not signed**: they can carry a secret in a header, which is how we would authenticate them. Retries are not documented. |
| Availability    | There are APIs for free technicians in a time window and for free time slots (at most 48 hours per call). Double-booking is refused.                                                                                                                                                  |
| Photographs     | Uploadable through the API to appointments, work orders and assets, up to 20 MB each. There is no bulk photo export, so we would list and download them.                                                                                                                              |
| Assets (pieces) | Creatable and updatable through the API and linkable to a client and work orders. There is no serial-number field, so the label goes in the asset number or a custom field.                                                                                                           |
| Job sheets      | Records can be created, filled and downloaded through the API, including checklists and image fields. The forms themselves are built in FSM's settings.                                                                                                                               |
| Books           | Invoices raised in FSM appear in Books automatically. Companies, contacts and services sync both ways.                                                                                                                                                                                |

**Needs the trial org** (I test these once I have API access, except where marked _you_):

1. Whether a failed webhook is retried, and whether our secret header arrives intact.
2. Whether dispatching, starting and completing an appointment fire "edited" webhook rules.
3. What FSM answers when a rate limit is hit, and which limits a trial actually gets.
4. Whether the attachment download works on the Attachments tab, and which image formats are accepted.
5. Whether a reschedule uses up another appointment from the monthly allowance.
6. Whether the availability APIs respect technicians' shifts and leave.
7. Whether a technician who has been invited but never logged in can be assigned work.
8. _You:_ build the job-sheet template in FSM, with the checklist per visit type, the consumables list and the full list of partial reasons. This is also a P2-M4 input.
9. _You:_ mark the technicians as field technicians and set up their zone (territory).

### 3. FSM and Books API credentials

One set for the trial now. Staging and production get their own sets once the real org is live.

1. Sign in at `https://api-console.zoho.in` (the India console) as an administrator of the org.
2. **Add Client → Self Client → Create.** Copy the **Client ID** and **Client Secret**.
3. Open the **Generate Code** tab and enter these scopes, comma-separated:

   ```
   ZohoFSM.modules.all,ZohoFSM.files.CREATE,ZohoFSM.files.READ,ZohoFSM.users.READ,ZohoFSM.meta.JobSheets.READ,ZohoBooks.contacts.ALL,ZohoBooks.invoices.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.creditnotes.ALL,ZohoBooks.settings.READ
   ```

4. Choose the longest duration (10 minutes), add a description ("Mane Man API"), and choose the organisation. Copy the **grant code**.
5. Within those 10 minutes, exchange the code for a refresh token, as you did for CRM in the runbook's step 8:

   ```sh
   curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=<id>&client_secret=<secret>&code=<code>"
   ```

   Keep the `refresh_token` from the answer. It does not expire; revoke it in the API console if it leaks. If the 10 minutes pass first, generate a new code.

6. Find the **Books organisation ID** under Books → Settings → Organisation Profile.
7. Save the four values in `.env.zoho-trial`, then tell me:

   ```sh
   ZOHO_CLIENT_ID=...
   ZOHO_CLIENT_SECRET=...
   ZOHO_REFRESH_TOKEN=...
   ZOHO_BOOKS_ORG_ID=...
   ```

### 4. Razorpay test keys and webhook

Test mode works as soon as you sign up, with no KYC and no website check.

1. Sign up at `razorpay.com` and sign in as the **Owner**. Only the Owner and Admins can see API keys.
2. Switch the dashboard to **Test Mode**, and stay in it for every step below.
3. **Account & Settings → API Keys** (under _Website and app settings_) → **Generate Key**. **Download the key file at once**: the Key Secret is never shown again.
4. **Account & Settings → Webhooks → + Add New Webhook**:
   - Webhook URL: `https://staging.maneman.in/api/hooks/razorpay`
   - Secret: a new random string of 32 or more characters (a password manager can make one). Not the Key Secret.
   - Alert email: the tech admin's.
   - Active events: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`.
   - **Create Webhook.** If it asks for an OTP in test mode, it is `754081`.
5. Leave **Payments Capture** at its default. We set each order's capture window through the API.
6. Save everything in `.env.razorpay-staging`:

   ```sh
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   ```

**Leave live mode alone until P2-M5.** It needs activation (KYC and a website check), its own keys and its own webhook. For a private limited company the KYC asks for the certificate of incorporation, MOA and AOA, the company PAN, the signatory's PAN and address proof, a board resolution, and a declaration of everyone holding over 10% of shares.

**What the research settled:**

- **No card fingerprint.** Razorpay gives a merchant the card's last four digits, network and issuer, but no fingerprint. A fingerprint is available only for cards a client chooses to save, and only after Razorpay's support switches the feature on. The fraud rule therefore uses the UPI handle (which Razorpay does return), the address and the mobile number, as ADR 0025's item 21 allowed.
- **The fees** are 2% plus GST on cards, with no setup or annual fee. UPI's merchant fee is zero, but Razorpay's pricing FAQ says a 2% platform fee still applies. Settlement is T+2 working days.
- **A normal refund takes 5–7 working days** to reach the client, not the 3–5 the design's open question assumed. Instant refunds (UPI and netbanking) cost a fee.
- **Razorpay issues no GST documents for our payments.** The receipt voucher or invoice comes from Books (section 6).

### 5. The price book

The app and the referral page take every price from the price book, never from design strings. Only you can set it.

**Fill in this table** and send it back, in chat or as a file. The design's figures and the Phase 1 site's are shown for reference.

| Item                                    | Tier or variant | Price before GST (₹)         | GST rate | Code (HSN or SAC) | From date |
| --------------------------------------- | --------------- | ---------------------------- | -------- | ----------------- | --------- |
| Consultation                            |                 | 0                            | –        | –                 |           |
| Standard base, fitted (first fit)       | standard        | _design 30,000; site 25,000_ | _CA_     | _CA_              |           |
| Other bases, if any                     |                 |                              |          |                   |           |
| Replacement                             |                 |                              |          |                   |           |
| Service visit                           |                 | _design 2,000; site 1,500_   | _CA_     | _CA_              |           |
| Late fee, first fit (inside 24 hours)   |                 | _design 4,000_               |          |                   |           |
| Late fee, replacement (inside 24 hours) |                 | _design 3,000_               |          |                   |           |

**GST: take these to your CA.** The research (CBIC notifications in force from 22 September 2025) found:

- **Service visits** are most likely "beauty and physical well-being services" (group 99972, probably SAC 999721). These are **5%, with no input tax credit**, a rate that cannot be waived. The design assumed 18%, so a ₹2,000 visit would be ₹2,100, not ₹2,360.
- **The fitted base is the open question.** As goods (HSN 6704, hair pieces) it is 18% with full input credit. As a grooming service it is 5% with none. There is no advance ruling on hair systems either way. Goods is the easier position to defend for bases and replacements.
- **Place of supply is the client's state.** Registered only in Delhi, you charge CGST and SGST in Delhi, and IGST in Gurgaon, Faridabad, Noida and Ghaziabad. The total tax is the same; the split differs. A studio or stock kept in Gurgaon or Noida could require registering there too.
- **Prepayment:** GST on a service is due when the payment arrives, with a **receipt voucher**; on goods it is not due on an advance. A **refund voucher** follows a refund. The composition scheme is ruled out, because it bars sales across state lines.

**Questions for the CA:**

1. Is the fitted base (and each replacement) goods (6704, 18%, with credit) or a grooming service (99972, 5%, without)? Should we apply for an advance ruling in Delhi?
2. If the piece and the fitting were priced separately, would they be taxed separately?
3. Is a service visit 999721 or 999729? Could cleaning the piece off the head be taxed as a repair of goods (998729, 18%)?
4. How is input credit reversed on shared costs (Razorpay fees, marketing, software) between 18% sales and 5% sales without credit?
5. Registered only in Delhi, is IGST right for Haryana and UP clients? What would make a Gurgaon- or Noida-based technician or stock a place of business there?
6. At booking, should we issue a receipt voucher or a tax invoice, for the base and for visits? How are cancellations and partial refunds handled?
7. Does a free replacement under the guarantee, or the free consultation, need any credit reversal?

### 6. Who issues receipts and invoices

The prompt leaves three routes open. The research narrows them:

- **FSM's retainer invoice.** FSM's invoices do flow into Books, but a retainer is a Books feature, and whether it can carry GST is unclear.
- **Books through its Razorpay integration.** This only covers payments made on Books' own invoices and payment links. Our checkout takes payment in the app, so this doesn't fit.
- **Books directly, from our backend.** When Razorpay confirms a payment, the backend records it in Books through the API: a receipt voucher, or a tax invoice, as the CA advises. Refunds get a refund voucher or a credit note.

**Recommendation: Books directly, from our backend**, once the trial confirms the API can create the document the CA chooses. Nothing needed from you now but the CA's answers to questions 1 and 6.

### Done by me

The storage buckets for client photographs are mine to create, and so is the webhook route. Invoices are streamed from Books, not copied.

## Before P2-M3

### 7. The service area

Phase 1 serves five NCR cities, but the Phase 2 designs say Gurgaon only (ADR 0025, item 14). The app, the referral page and the waitlist all decide "served or not" by pincode, so the service area becomes a list of pincodes, each with the date it launched.

**Already done:** `data/pincodes/ncr-pincodes.csv` lists all 198 pincodes of the five cities:

| City      | Pincodes |
| --------- | -------- |
| Delhi     | 103      |
| Gurgaon   | 29       |
| Noida     | 26       |
| Ghaziabad | 25       |
| Faridabad | 15       |

The list comes from the Department of Posts' public directory, under the government's open-data licence. Each row names the post offices in the pincode, so you can tell the areas apart. `data/pincodes/README.md` records the source and the caveats. For example, it includes Greater Noida and the rural edges: Pataudi, Tigaon, Loni, Dadri and Jewar.

**Your part:** open the file in Excel or Google Sheets and fill in the last two columns:

- `served`: `yes` for each pincode a technician goes to today;
- `launch_on`: the date it started, or the planned date for one launching later.

Then save it as CSV in the same place and tell me. Answering per city is enough if whole cities are served ("all of Gurgaon and Delhi, from 1 October").

### 8. Referral rulings

**Ruled 22 September 2026: all six as recommended** (ADR 0025, item 24).

The prompt settles most of the referral rules: 3 service visits each when a referred friend's first fit is done, credits valid 365 days, and fraud holds for review. The designs left these six questions to the owner.

1. **Invite validity.** An invite to an unserved area stays valid for 12 months after that area launches.
   - Confirm the 12 months.
   - If the referrer deletes their account before the friend is fitted, does the friend still get credits?
   - _Recommendation:_ 12 months. If the referrer leaves, the friend keeps the 3 credits the invite promised, the referrer's 3 lapse, and the invite shows the house card instead of theirs.
2. **Naming the referrer.** The landing page and the WhatsApp preview say "Rohit invited you", which also shows the name to someone who may never book.
   - _Recommendation:_ first name only, and only after the referrer has read "your first name appears on your invite" beside the card's consent lines. It can be switched off everywhere (`REFERRER_NAME_ON_INVITE`).
3. **What the referrer is told.** When a friend is fitted, the referrer gets a WhatsApp and sees the friend's first name and the month, and nothing about opens, consultations or pending referrals.
   - _Recommendation:_ the landing page tells the friend "Rohit is told, by your first name, when you are fitted", and booking through the invite is the friend's agreement. A friend who would rather not be named can book on the public site instead, without the credits.
   - Counsel to confirm, with the consents.
4. **Prices on the referral page.** "From ₹30,000, matching the site."
   - _Recommendation:_ the same figures as the site, from the price book, with no referral price. The prompt rules out any other discount.
5. **The monthly cap.** A referrer's sixth and later fits in a month are held for ops' review, not refused.
   - _Recommendation:_ 5, reset on the calendar month in India time.
6. **Referrals logged before January** (section 9).
   - Were credits already given for any of them, and were any used?
   - _Recommendation:_ credits imported from the log expire 365 days after the import, so none arrive already expired.

### 9. Ops' referral log

The prompt asks us to back-fill the referrals ops logged before January into the credit ledger. Export ops' log as a CSV with these columns, one row per referred friend, and save it as `private/referrals-before-january.csv`. It holds names and numbers, so never email it or commit it.

| Column                  | Example        | Notes                                        |
| ----------------------- | -------------- | -------------------------------------------- |
| `referrer_name`         | Rohit Malhotra | As on the booking                            |
| `referrer_mobile`       | 98xxxxxxxx     | Ten digits                                   |
| `referred_name`         |                |                                              |
| `referred_mobile`       |                | Ten digits                                   |
| `referred_on`           | 2026-06-02     | When the friend first got in touch           |
| `first_fit_on`          | 2026-07-05     | Blank if not fitted yet                      |
| `credits_given`         | yes            | Whether both were already given the 3 visits |
| `credits_used_referrer` | 1              | 0 to 3                                       |
| `credits_used_referred` | 0              | 0 to 3                                       |
| `notes`                 |                | Anything ops want kept                       |

### 10. Message texts

The referral, launch and waitlist WhatsApp messages are drafted with P2-M3, for your approval before they are sent. Nothing is needed now.

## Still owed from P2-M1

### 11. SMS login codes (DLT)

WhatsApp carries login codes today. SMS needs India's DLT registration, which takes 1–2 weeks and costs ₹5,000 plus GST. The template rules changed in 2025 and 2026, and the template below follows them.

1. **Register the business on one DLT portal.** One registration serves every operator. The suggested portal is Vi's, `vilpower.in` (approval promised in 72 hours).
   - Needed: the company PAN, the GST certificate, the signatory's ID, a letter of authorisation on letterhead (the portal gives the format), and a business email and mobile.
   - You get a 19-digit **Entity ID**.
2. **Register the sender name (header).** Type "Others", exactly 6 letters tied to the brand, for example `MANEMN`, with proof (the website).
   - Operators switch off a header unused for 90 days.
3. **Register both web addresses as allowed links:** `https://app.maneman.in` and `https://app-staging.maneman.in`, separately. A message naming an unregistered domain is rejected.
4. **Register two templates**, category **Service Implicit** (or Transactional, if the portal rejects that), linked to the header, with both variables tagged numeric.
   - Production:

     ```
     Your Mane Man login code is {#numeric#}. It expires in 10 minutes. Do not share it with anyone.

     @app.maneman.in #{#numeric#} - Mane Man
     ```

   - Staging: the same, with `@app-staging.maneman.in` in the last line.
   - The brand name must be in the text. Variables must now be typed (`{#numeric#}`). A variable cannot be the last word, hence " - Mane Man", which Chrome still reads the code through.
   - Approval usually takes 2–4 working days.
5. **Link the registration to MSG91** ("PE-TM chain"):
   - On the portal, add Walkover Web Solutions Pvt. Ltd, telemarketer ID `1302157225275643280`.
   - Fill in MSG91's approval form, then approve the request on the portal.
   - In MSG91, go to SMS → PE-TM Chain and add the chain.
6. **In MSG91, create the sender ID** (SMS → Sender ID): the header, with the Entity ID.

MSG91's OTP price is ₹0.18–0.25 an SMS plus GST, by volume. Login codes need no consent template, and they reach numbers on Do Not Disturb.

**Send back:**

- In chat: the Entity ID, the header, both template IDs, and the exact approved text of each template.
- In `.env.msg91`: the MSG91 auth key, as `MSG91_AUTH_KEY=...`.

### 12. Counsel's sign-off

Ask counsel to approve:

- the five consent purposes and their wording;
- the four lines the referral card shows before its consent (board F3);
- the retention periods: photographs deleted within 7 days of a deletion request, invoices kept 8 years;
- our roles under the DPDP Act;
- rulings 2 and 3 in section 8.

## Worth starting now for P2-M4

Ask Zoho, in writing, the licensing question in `docs/decisions/fsm-licensing.md`: may our own apps drive FSM through its API, and do technicians working only in our apps need seats? The research found users are not charged (pricing is per appointment), but the terms of use still need Zoho's written answer.
