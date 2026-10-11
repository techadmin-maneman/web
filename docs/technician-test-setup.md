# The technician app: signing in on your own phone

This page signs you in to the technician app on staging with your own mobile number, on your own phone, and walks a job from the door to the outcome: the code arriving on a phone, the six digits opening a session, and each step of a job landing.

It takes about twenty minutes and you can do it anywhere — at your desk, at home, in the car. You do not need a client, a technician or a van.

**This is not the field test.** `docs/tech-field-test.md` is the full script: three real buildings, a basement, the camera in direct sun and with gloves on, a whole job in a dead spot, and a day of battery. That one needs a real client's door and a whole working day, and it is what settles the 200 m check-in radius. **Do this page first.** If the app does not work here, there is no point booking a day for the field test.

---

## What the fixture lays

A developer lays it on staging with one command (`scripts/staging/seed-technician-tester.ts`, "When you are finished", below), and nothing is written to production or to Zoho:

- **A technician called "Test Technician"**, active, zone Gurgaon, who signs in with your own mobile number. The name is invented on purpose: your number sits in one column of one row of staging's database, and nowhere in the code, the fixtures or the git history.
- **A client called "Staging test"**, with an invented `9…` number nobody answers, at an invented Gurgaon address in Sector 45. A "Staging test" record is never messaged unless its number is on staging's allowlist.
- **Three service visits** for that technician, each at 10:00 in the morning: **today**, **tomorrow** and **three days out**, counted from the day the fixture is laid. The command prints each job's ID.
- **No phone.** Nothing is enrolled in advance. Your phone enrols itself the first time you sign in.

Two of those three jobs are there for a reason. Today's and tomorrow's carry the address and the client's card; **the one three days out does not**, because a job's address, access notes and client card open only the day before the visit, and the API enforces that rather than the screen.

**The check-in will pass wherever you are standing.** The test address deliberately has no coordinates on it, and an address with no coordinates cannot be measured against, so "I have arrived" is accepted from anywhere. That is on purpose: you should not have to drive to Sector 45 to see the rest of the app. Measuring the real 200 m geofence is what the field test does, at real addresses.

---

## How a real technician is added

In the console: Technicians → Add, with their name, mobile number and zone (ADR 0110). The sign-in reads that table, `technicians`, and nothing else. The fixture writes its technician straight into staging's copy of it instead, so it needs nothing from ops.

---

## Before you start

1. **Your own number works, without being added anywhere first.** A login code answers whoever asked for it, so staging sends it to any number (ADR 0097, "logins open, reminders fenced"); only reminders and other automatic messages still need a number on staging's allowlist, and none of those are part of this page.
2. **Use Chrome on an Android phone.** The app is built for Android and the field test is run on one.
3. **You will have to sign in to Cloudflare Access first.** `tech-staging.maneman.in` sits behind it, so the first thing the phone shows is Cloudflare's sign-in, not ours. Use your founders' login. This is staging's protection only; the real technician app will not have it.

---

## Signing in

1. Open **`https://tech-staging.maneman.in`** in Chrome on your phone.
2. Cloudflare Access asks who you are. Sign in with your founders' login. You only do this once on this phone.
3. You should now see **Technician sign in**, with **+91** and an empty number box.
4. Type the **ten digits of your own mobile number**. Do not type +91; it is already there.
5. Tap **Send the code**.
6. You should see **A six-digit code is on its way.**
7. Within a few seconds a WhatsApp message arrives: "**NNNNNN is your Mane Man code. It works for ten minutes. We will never ask you for it.**" It comes from the number staging's WhatsApp instance sends on, so it will show as an unknown number rather than as Mane Man. **Note how long it took** — the field test asks for that number.
8. Type the six digits, and tap **Sign in**.
9. You should land on the day's jobs: **1 job today**, a line reading **First at 10:00 am · Sector 45**, and a round chip at the top right with the initials **TT**.

If you get **That code did not match**, you have four more tries before the code is thrown away. When it is, the screen says **That code no longer works. Send the code again.** and goes back to your number: start again from step 5. Typed the number wrong? Tap **Change number** under the code boxes. If nothing arrives at all, go to "If the code does not arrive", below.

---

## Walking a job

Work through this on **today's** job. It is a service visit, so it has five steps: before photos, the checklist, consumables, after photos and the outcome. (A replacement or a first fit has a sixth, for the piece's label; a service visit skips it.)

1. Tap the job. You should see the client's name, **10 am · service · 1 slot**, a **Prepaid** badge, the address in Sector 45, the access note, a **Navigate** button, and **Call** and **WhatsApp** buttons for the client. There is no price anywhere, and there should not be: the app never shows a technician an amount.
2. Under the card you should see **1 · Arrived** and the line "Tap at the door. We record the time and check you are within 200 m."
3. Tap **I have arrived**. Android will ask to use your location — allow it.
4. The screen changes. You should now see **2 · Waiting** with a countdown running down from 15:00, and **Close as no-show** greyed out until the countdown reaches zero; once it opens it asks before it closes anything, because ops may charge the client. Below that, **Client’s here** and "Staging is at the door", and at the foot of the screen the one gold button, **Start job**.

   > The check-in passed because the test address has no coordinates, as explained above. At a real address it would have measured the distance and refused if you were more than 200 m away.

5. Tap **Start job**.
6. **Before photos.** You should see a live picture, **0 of 5**, and the word **Front**. Tap **Capture** five times, following the label each time — Front, Top, Left, Right, Hair. After the fifth you should see **All five are on the phone.**, and **Capture** becomes **Done** in the same place. Point the camera at a wall; nobody needs to be photographed. Tap **Done**.
7. **Service checklist.** Six lines, each beginning "PLACEHOLDER" — that is correct until ops set the real list in the console's Settings · Job sheet (open point 28), and then you see theirs. Tick every line. The bar at the bottom stays dim and says "Finish the list to continue" until every line is ticked. Tap **Next**.
8. **Consumables used.** The consumables ops listed in the console's Settings · Consumables, each with a plus and a minus; those a service visit is expected to use come first, already at what it expects. **Add another** gives any of the rest. Change a count or two, or take each to 0, which records **None used**. If ops have listed none yet, the step says so. Tap **Next**. What you record comes out of your kit on the console's Stock page.
9. **After photos.** The same five as before. Tap **Capture** five times, then **Done**.
10. **Outcome.** Nothing is chosen for you: tap **Done**, then **Next**. (**Partial · pick a reason** is the other path; try it on tomorrow's job if you want to see it.)
11. You should reach the close-out: **Closed out**, a tick, "Staging test · done", how long the job took, and how many photographs are queued or sent.
12. Tap **Back to today**. The job's row should now read **Closed out**.

### The three things worth checking while you are there

- **Tomorrow's job.** At the foot of the day's list, tap the line that says **Tomorrow · 1 job**. It opens out; tap the job inside it. It should carry the address and the client's name, because a job opens the day before, and **Tomorrow** before its time. It offers no **I have arrived**: a job is arrived at on its own day.
- **The job three days out, which is still locked.** The day's list only ever shows today and tomorrow, so there is no way to tap through to a job further out; that is by design. Open it by its own address, with the ID the fixture printed for it as `later`:

  **`https://tech-staging.maneman.in/jobs/<the later job's ID>`**

  Instead of the client's name the card says **Service**, and where the address would be it says **Not yet** and when it opens, such as **Opens at 6 pm on Sat 26 Sep.**, with **Sector 45** underneath. There is no address on that screen because the API did not send one, not because the screen is hiding it.

- **No signal.** Turn on aeroplane mode, close the app completely and open it again. You should still see the day's jobs and be able to open the card, with **No signal · working offline** across the top. Turn signal back on and the photographs finish uploading by themselves.

---

## If the code does not arrive

Work down this list. Most of it you can check yourself.

1. **Wait a full minute.** WhatsApp through the provider is usually a few seconds, but it is not instant.
2. **Check you typed your own number**, ten digits, no +91 and no spaces.
3. **Check WhatsApp itself.** The message reads "**NNNNNN is your Mane Man code. It works for ten minutes. We will never ask you for it.**" It arrives from whatever number staging's WhatsApp instance sends on, which is not the published Mane Man number and will not be labelled — so look for an unknown number, not for a name you recognise.
4. **Ask for one more code.** Tap **Send a new code**, under the code boxes; it comes on 30 seconds after the last code went out. You get **five codes a day** for one number; after that the app says "Too many codes for this number today", and the count resets at midnight India time.
5. **If the screen says "Codes are not going out just now"**, staging has hit its daily ceiling of 300 codes across all numbers. That resets at midnight too.
6. **If nothing arrives after two tries, stop and tell the developers.** It is one of four things, and one line tells them which:

   ```sh
   node node_modules/wrangler/bin/wrangler.js tail --env staging --format json --status ok
   ```

   Ask for another code while that is running. The line to look for names the event:

   - `login_code_sent` — the code went out, and the problem is between the provider and the handset.
   - `login_code_failed` — the WhatsApp provider refused it, and the line says why.
   - `login_code_not_sent`, reason "no account holds the number" — no active technician in staging has your number: the fixture is not laid, or was cleared. The sign-in deliberately answers the same whether it knows a number or not, so the screen will never tell you this; the log is the only place it shows.

**Do not ask anyone to read the code out of the database.** It is not stored — only a hash of it is, and that is the point.

---

## What ops will see

Each step you take lands in our own database, as a real job's does (ADR 0110), and nothing goes to Zoho. The jobs show on the dispatch board and, once closed, in the client's record; nothing needs ops to act. Tell whoever watches the console that you are running it.

---

## When you are finished

Tap the **TT** chip at the top right and then **Sign out**. You should be back at **Technician sign in**, and nothing of any client should still be on the phone.

If anything is still waiting to go up, Sign out says how much first and offers **Send first**: tap it, wait for the waiting line to go, then sign out. With no signal it will not sign you out at all — it says so, and keeps everything until there is signal.

Then have a developer take the fixture out of staging, which removes the technician, the jobs, the invented client and — this is the part that matters — **your mobile number from staging's database**:

```sh
TECH_TESTER_MOBILE=<your ten digits> node scripts/staging/seed-technician-tester.ts --clear
```

The same script lays it again, without `--clear`, once the old one is cleared: when you want another run, or when its days have passed. It refuses while any technician holds your number. It takes the number from the environment and never writes it down, which is why it is not in the command above.

---

## What this page does not test, and what does

- **The 200 m check-in radius.** Not touched here, on purpose. `docs/tech-field-test.md`, Part 1, measures it at a Gurgaon high-rise, a gated sector house and a basement, and those three numbers are the whole evidence for open point 56.
- **The camera in real conditions** — bright sun, a basement, gloves on. `docs/tech-field-test.md`, Part 2.
- **A whole job in a dead spot**, and whether anything is lost or doubled when signal returns. Part 3.
- **The phone locked mid-job**, and battery and heat over a working day. Parts 4 and 5.
