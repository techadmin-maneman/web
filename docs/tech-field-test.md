# The technician app: the field test

This is the part of the technician app that no desktop can prove. Everything that could be tested from a desk was, on 23 September 2026, against the real staging API (`docs/verification.md`, "P2-F4: the technician app against the real mm-api"). What is left needs a real phone, a real client's door, a real basement and a real day.

You do not need to be a developer to run this. Each step says what to tap and what you should see, and leaves a line to write the answer on. Where a step says **write the number down**, the number is the point of the step — please do not skip it.

Print this, or copy it into a notes app, and fill it in as you go.

**Who runs it:** the owner, or a technician with the owner beside him for the first job.

**How long it takes:** one full working day, with three visits in different kinds of building. Part 6 needs the same phone again a week later, for ten minutes.

**Which phone:** technicians use **any phone, including iPhones** (`docs/open-points.md`, item 124). Run this sheet on whichever phone the technician actually owns. The parts marked **iPhone only** are skipped on an Android phone; everything else is the same on both.

**The one rule:** this is staging, with test jobs. Do not run it against a real client's visit unless ops have said which one, and never photograph a client without asking him first.

---

## Before you start

**Do `docs/technician-test-setup.md` first.** It is twenty minutes on any phone, anywhere, and it proves the sign-in, the six steps of a job and the day-before unlock before anyone books a working day for this. It also sets a technician up without touching Zoho, which is worth knowing: the sign-in reads our own database and not FSM, so step 1 below is how a **real** technician gets listed, not a condition of logging in.

Ops do these once. Tick each before the phone leaves the office.

| #   | Set up                                                                                                                                                                                    | Done |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | The technician is a user in Zoho FSM, active, **with his mobile number on his FSM user** (open point 27)                                                                                  |      |
| 2   | Nothing to do here since 30 September 2026: a login code answers whoever asks for it, on any number (ADR 0097, "logins open, reminders fenced")                                           |      |
| 3   | Three jobs are scheduled in FSM for that technician, today, at the three buildings in Part 1                                                                                              |      |
| 4   | Each job's client address in FSM has a street address FSM could geocode (open point 54)                                                                                                   |      |
| 5   | The phone is charged to 100%, with the battery percentage switched on in the status bar. Android or iPhone, whichever the technician owns                                                 |      |
| 6   | The phone can reach `https://tech-staging.maneman.in` — it is behind Cloudflare Access, so the technician signs in to Access with his founders' login first, or ops open the site for him |      |
| 7   | Ops can see this technician's phones, so they can count the rows before and after Part 0a (board D3, the technician list)                                                                 |      |

**The phone the day starts on**

| Question                             | Write it here |
| ------------------------------------ | ------------- |
| Phone make and model                 |               |
| Android or iPhone, and which version |               |
| The browser you open it in           |               |
| Network (operator, and 4G or 5G)     |               |
| Battery % at the start, and the time |               |
| Weather, and roughly how hot it is   |               |

---

## Part 0 — signing in

1. Open `https://tech-staging.maneman.in` — in Chrome on an Android phone, in **Safari** on an iPhone. It has to be Safari: only Safari can put a web app on an iPhone's home screen, and Part 0a needs that.
2. You should see **Technician sign in**, with +91 and an empty number.
3. Type the ten digits of the technician's own mobile number. Tap **Send the code**.
4. You should see **A six-digit code is on its way.**
5. The code arrives on WhatsApp. **How long did it take?** \_\_\_\_\_\_\_\_ seconds
6. Type the six digits. Tap **Sign in**.
7. You should land on the day's jobs, with the technician's initials at the top right.

| Question                                                             | Write it here |
| -------------------------------------------------------------------- | ------------- |
| Did the code arrive? (yes / no)                                      |               |
| Did the six boxes fill by themselves from the WhatsApp notification? |               |
| How many jobs does the screen say you have today?                    |               |
| Anything on the screen that is wrong, or that you did not understand |               |

> This step is the one part of sign-in that a desk could not prove: staging hashes every code, so the proof on 23 September could show only the code request and a wrong code. **The right code has never been through the real API.** If it does not work, stop and tell the developers before going to a door.

> **On an iPhone, do Part 0a now, before going to any door.**

---

## Part 0a — iPhone only: putting the app on the home screen

On an iPhone this is not a convenience, and it is the most important ten minutes of the day. Apple's Safari clears a website's stored data after seven days of Safari use without visiting it, and an app added to the home screen is the one thing Apple says it does not expect to clear. It is also what makes the phone agree to hold the photographs and the queued actions at all. **A technician who does not do this can lose a day's work in a quiet week.**

The price is one extra sign-in: the home-screen app is a separate app with its own login, so signing in inside Safari does not sign you in inside it.

1. In Safari, with the app open, tap the **Share** button (the square with the arrow out of the top).
2. Scroll down and tap **Add to Home Screen**. Tap **Add**.
3. Close Safari completely.
4. Open the new **Mane Man** icon from the home screen.
5. It should open with **no Safari address bar and no browser buttons at all** — just the app.
6. It should show **Technician sign in**, and underneath it a line beginning **"This is the app on your home screen."**
7. Sign in again: the ten digits, **Send the code**, the six digits, **Sign in**.
8. From now on, **use this icon and not Safari** for the whole day.

| Question                                                                                        | Write it here |
| ----------------------------------------------------------------------------------------------- | ------------- |
| Was **Add to Home Screen** in the share sheet? (yes / no)                                       |               |
| Did the icon look like the Mane Man mark, or like a screenshot of the page?                     |               |
| Did it open with no address bar? (yes / no — if no, stop and tell the developers)               |               |
| Did it ask you to sign in again?                                                                |               |
| Did you see the line "This is the app on your home screen"? Write down what the rest of it says |               |
| Did the second code arrive as quickly as the first? How many seconds                            |               |
| Does the gold button at the bottom sit clear of the thin bar along the screen's bottom edge?    |               |

After this, ops check the technician's phones on board D3 and write down what they see:

| Question                                                               | Write it here |
| ---------------------------------------------------------------------- | ------------- |
| How many phones does ops see for this technician now? (expect **two**) |               |
| What is each one labelled?                                             |               |

> **This is expected, and it is not a fault.** One row is Safari, one is the home-screen app; we cannot tell that they are one handset without fingerprinting the phone, and we will not do that. The Safari one falls away by itself after 90 days unused, or ops revoke it by hand once the day is over.

---

## Part 1 — the door, and how far the phone thinks you are

This is the most important part of the day. The app checks that you are within **200 m** of the address before it lets you start. Nobody knows yet whether 200 m is the right number, because nobody has measured how wrong a phone's position is at an Indian address (open point 56). **These three readings are the evidence that settles it.**

Run steps 1 to 8 at **each** of the three buildings.

### The three buildings

- **A — a Gurgaon high-rise.** Stand at the flat's own door, inside the tower, not in the lobby and not in the car park.
- **B — a gated sector house.** Stand at the house's front door, inside the gate.
- **C — a basement.** A basement car park or a basement salon, where the phone shows one bar or none.

### The steps, at each building

1. Open the app. Tap the job for this address.
2. You should see the client's name, the time, the address and **Navigate**.
3. **Tap Navigate.** A map should open, in a new tab or in the Google Maps app, already showing the route to this address. Come back to the technician app afterwards — it should still be where you left it. _(This is the button that did nothing at all on an iPhone until 24 September 2026; it now uses a plain map link that works on both phones.)_
4. Before tapping anything else, write down what the phone's status bar says: how many bars, and 4G, 5G, E or nothing.
5. Tap **I have arrived**. If the phone asks for the location, allow it. On an iPhone, choose **Allow Once** or **Allow While Using App** — not "Don't Allow", which cannot be undone from inside the app.
6. Wait. One of two things happens.
   - **It passed:** the screen changes to **2 · Waiting**, with a countdown from 15:00 and **Close as no-show** greyed out.
   - **It failed:** the screen says **Check-in failed** and, under it, **You are NNN m from the address**. That number is what we need.
7. If it failed: **write the number down**, walk to where you would normally stand at that door, and tap **Try again**. Write down the second number too, and whether it passed.
8. If it passed: the app does not show you the distance. **Write down the exact time** (hour and minute) instead, and ops read the number out afterwards — see "Getting the numbers out", below.

### Building A — a Gurgaon high-rise

| Question                                               | Write it here |
| ------------------------------------------------------ | ------------- |
| Address, in words (tower, floor, sector)               |               |
| Did **Navigate** open a map with the route? (yes / no) |               |
| Signal in the status bar (bars, and 4G/5G/E/none)      |               |
| Did the check-in pass first time? (yes / no)           |               |
| If it failed: the distance it showed, in metres        |               |
| The time of the check-in that passed (hh:mm)           |               |
| How many taps of **I have arrived** it took            |               |
| Where exactly you were standing when it finally passed |               |

### Building B — a gated sector house

| Question                                            | Write it here |
| --------------------------------------------------- | ------------- |
| Address, in words (block, sector)                   |               |
| Signal in the status bar                            |               |
| Did the check-in pass first time? (yes / no)        |               |
| If it failed: the distance it showed, in metres     |               |
| The time of the check-in that passed (hh:mm)        |               |
| Did it pass from outside the gate as well? (try it) |               |
| How many taps it took                               |               |

### Building C — a basement

| Question                                                                                        | Write it here |
| ----------------------------------------------------------------------------------------------- | ------------- |
| Where the basement is, in words                                                                 |               |
| Signal in the status bar                                                                        |               |
| Did the phone give a position at all, or did you see **This phone will not give its position**? |               |
| How long you waited before anything happened, in seconds                                        |               |
| If it failed: the distance it showed, in metres                                                 |               |
| The time of the check-in that passed (hh:mm)                                                    |               |
| One bar, not in aeroplane mode: close the app, open it. Seconds until the jobs showed           |               |
| Did it then say **No signal · working offline**? (yes / no)                                     |               |

> A signal that shows a bar and answers nothing is the case the app is least able to tell from a good one. It now opens from what the phone holds and waits at most a few seconds on the network (ADR 0053, update of 25 September 2026). More than ten seconds, or a blank screen, is worth telling the developers.

### Getting the numbers out

Every check-in is recorded whether it passed or not, with the distance it measured and the radius in force. At the end of the day, ops run these two lines and keep what they print with this sheet:

```sh
node node_modules/wrangler/bin/wrangler.js d1 execute maneman-staging --env staging --remote \
  --command "SELECT at, distance_m, radius_m, accuracy_m, passed FROM checkins WHERE distance_m IS NOT NULL ORDER BY at DESC LIMIT 20;"
node node_modules/wrangler/bin/wrangler.js d1 execute maneman-staging --env staging --remote \
  --command "SELECT COUNT(*) AS unmeasured FROM checkins WHERE distance_m IS NULL;"
```

`distance_m` is how far the phone said it was from the address; `accuracy_m` is how sure the phone was of its own position. Both matter. The owner rules the radius from these numbers.

The first line leaves out every check-in that measured nothing. An address the client typed rather than chose has no coordinate, so its check-in passes with no distance at all, and it says nothing about GPS error. Before migration 0035 such a row held a filler 0 and read as "0 m, passed"; the migration cleared those, and the second line counts them. If it is most of the day's check-ins, the addresses need their pins before the numbers mean anything (open point 56).

> **Known gap.** The app shows the distance only when the check-in **fails**. When it passes, the technician never sees the number, so the line above is the only way to collect it. Whether the app should show the distance on a passing check-in too is a change to board B5, and is the owner's and the designer's to rule.

---

## Part 2 — the camera

Five photographs before the work and five after, one tap each: front, top, left, right, hair. The app never opens the phone's own camera app and never writes to the gallery.

Do this at every building, and pay attention to the three conditions below.

1. Tap **Start job**.
2. You should see **Before photos**, a live picture, **0 of 5**, and the word **Front**.
3. Tap **Capture** five times, following the label each time.
4. You should see **1 of 5**, **2 of 5** and so on, and after the fifth, **All five are on the phone.**
5. Tap **Done**.

### In bright sun

Stand outside, in direct sun, at midday, and take a set.

| Question                                                                   | Write it here |
| -------------------------------------------------------------------------- | ------------- |
| Could you see the screen well enough to line the shot up? (yes / no)       |               |
| Could you tell **Capture** from **Retake** without squinting?              |               |
| Are the photographs usable, or blown out? (look at them on a laptop later) |               |
| Did the phone get hot enough to warn you?                                  |               |

### In a basement

Take a set in the basement, with whatever light is there.

| Question                                                          | Write it here |
| ----------------------------------------------------------------- | ------------- |
| Is the hairline visible in the photographs?                       |               |
| Did the camera take a long time to focus? Roughly how long?       |               |
| Did the app need the torch? (it has none — say if you wanted one) |               |

### On an iPhone, the first time

The app never opens the phone's own camera app: it draws the picture itself. iOS asks for the camera the first time, inside the app, and the whole capture depends on the answer.

| Question                                                                                        | Write it here |
| ----------------------------------------------------------------------------------------------- | ------------- |
| Did iOS ask for the camera? What exactly did it say?                                            |               |
| After allowing it, did the live picture appear? How many seconds                                |               |
| Did the picture ever freeze, go black, or come back upside down?                                |               |
| Take a call, then come back to the app: did the camera come back on its own?                    |               |
| Open the iPhone's **Photos** app afterwards: is any of these ten photographs there? (expect no) |               |

### With gloves on

Put on the gloves worn for a fitting and take a whole set without taking them off.

| Question                                                        | Write it here |
| --------------------------------------------------------------- | ------------- |
| Did **Capture** respond to a gloved tap? (yes / no / sometimes) |               |
| Did **Retake** respond?                                         |               |
| Did the back arrow at the top left respond?                     |               |
| Were any taps missed, and roughly how many out of ten           |               |
| Did you ever have to take a glove off? At which step?           |               |

---

## Part 3 — a whole job in a dead spot

Do one **entire** job with the phone in aeroplane mode, from the door to the outcome, and only then reconnect. This is the one that matters most after Part 1.

1. Before you go in, open the app and let the day's jobs load.
2. Turn on **aeroplane mode**. Check the status bar: no bars, no Wi-Fi.
3. **Close the app completely** (swipe it away from the recents list) and open it again.
4. You should still see the day's jobs, with **No signal · working offline** above them.
5. Open the job. You should still see the client's name and the address.
6. Tap **I have arrived**. You should see **No signal. The time is on the phone and the check runs when signal returns.**
7. Tap **Start job**, then go right through: five before photographs, the checklist, the consumables, five after photographs, and the outcome **Done**.
8. On the way, tap the line at the top that says how much is waiting. You should see the photograph sets and the actions waiting, **Waiting since** a time for each job, and **Never written to this phone's gallery.**
   - You may also see **This phone has not promised to keep unsent work.** That is the phone's answer, not a fault: write down whether you saw it. It means the queue matters more than usual — finish the day within reach of signal.
9. Finish the job. You should reach the close-out.
10. Now turn aeroplane mode **off**, and stand still for two minutes.
11. Go back to the day's jobs and open the waiting line again.

| Question                                                                                                    | Write it here |
| ----------------------------------------------------------------------------------------------------------- | ------------- |
| Did the app open at all with no signal after being closed? (yes / no)                                       |               |
| Did it show the day's jobs, or a blank page?                                                                |               |
| Could you open the job's card and see the address?                                                          |               |
| Did any step refuse to go through?                                                                          |               |
| Was the gold button at the bottom on screen at every step, with no scrolling to find it? If not, which step |               |
| How much was waiting when you finished the job (photo sets, actions)                                        |               |
| Time you turned aeroplane mode off (hh:mm)                                                                  |               |
| Time the waiting line emptied (hh:mm)                                                                       |               |
| Did anything stay stuck? If so, exactly what it said                                                        |               |
| Did you see **This phone has not promised to keep unsent work**? (yes / no)                                 |               |
| What time did **Waiting since** show for the job, and was it right?                                         |               |
| Did the check-in that ran when signal came back pass? What did the screen then show?                        |               |

After this, ops check that nothing was lost or doubled:

```sh
node node_modules/wrangler/bin/wrangler.js d1 execute maneman-staging --env staging --remote \
  --command "SELECT kind, COUNT(*) AS n, MAX(fsm_write_state) AS fsm FROM job_events GROUP BY kind;"
```

Each kind should appear **once** for that job. Two of anything is a fault: write down which one.

---

## Part 4 — the phone locked mid-job

1. Start a job and get as far as **3 of 5** on the before photographs.
2. Lock the phone with the power button. Put it in your pocket.
3. Do something else for **ten minutes**. Take a call on the same phone if you can.
4. Unlock the phone and open the app again.

| Question                                                                  | Write it here |
| ------------------------------------------------------------------------- | ------------- |
| Were you still signed in? (yes / no)                                      |               |
| Were you back on the photographs screen, or somewhere else? Where?        |               |
| Did it still say **3 of 5**, or had the three photographs gone?           |               |
| Did the camera come back on its own, or did you have to leave and return? |               |
| How long the app took to be usable again, in seconds                      |               |

Then do the same at two other points, and answer the same questions: **after the check-in, during the 15-minute wait**, and **on the outcome screen before tapping Done**.

| Where you locked it   | Still signed in | Back on the same screen | Anything lost |
| --------------------- | --------------- | ----------------------- | ------------- |
| During the wait       |                 |                         |               |
| On the outcome screen |                 |                         |               |

---

## Part 5 — battery and heat, over the whole day

Write the battery percentage down at these five moments. Do not charge the phone during the day; if you have to, say when and for how long.

| Moment               | Time (hh:mm) | Battery % | Phone warm to touch? |
| -------------------- | ------------ | --------- | -------------------- |
| Leaving the office   |              |           |                      |
| After the first job  |              |           |                      |
| After the second job |              |           |                      |
| After the third job  |              |           |                      |
| End of the day       |              |           |                      |

| Question                                                                | Write it here |
| ----------------------------------------------------------------------- | ------------- |
| Did the phone ever get too hot to hold comfortably? When?               |               |
| Did the phone ever warn about heat, or dim the screen by itself?        |               |
| Did the camera ever refuse to open because of heat?                     |               |
| Did the battery last the day? If not, at what time did it run out?      |               |
| Roughly how many minutes was the app open and in front of you, all day? |               |

---

## Part 6 — iPhone only: the week the phone sat idle

**Do not do this on the same day.** Everything above tests the phone in use. This tests the phone _not_ in use, which is the one thing an iPhone does differently from an Android phone and the one thing nothing on a desk can answer.

Apple clears a website's stored data after seven days of Safari use without visiting the site, and says it does not expect to do that to an app added to the home screen. Whether that holds for this app, on this phone, is what these ten minutes settle.

### Set it up on the day of the test

At the end of the working day, **before** signing out:

1. Open the home-screen app.
2. Start one more job on a test address and go as far as **3 of 5** on the before photographs, with the phone in aeroplane mode.
3. Leave it there. Do not sign out, do not finish the job, and do not open the app again.

| Question                                    | Write it here |
| ------------------------------------------- | ------------- |
| Date and time you left it                   |               |
| What the waiting line said when you left it |               |

### Come back eight days later

Use the phone normally in between — Safari included — and do not open the Mane Man icon once.

1. On the eighth day, open the home-screen icon.

| Question                                                     | Write it here |
| ------------------------------------------------------------ | ------------- |
| Date and time you opened it again                            |               |
| Were you still signed in, or back at **Technician sign in**? |               |
| Was the waiting line still there, saying the same thing?     |               |
| Were the three photographs still on the phone?               |               |
| Did the job finish and go up when you reconnected?           |               |
| Anything the app said that you did not expect                |               |

### And the same thing in Safari, if you can spare a second phone

If a second iPhone is available, sign in on it **in Safari only**, leave the same half-finished job, and come back on the eighth day. This is the comparison that matters: if Safari cleared it and the home-screen app kept it, the instruction to install becomes a rule.

| Question                                        | Write it here |
| ----------------------------------------------- | ------------- |
| Safari phone: still signed in after eight days? |               |
| Safari phone: was the unsent work still there?  |               |

---

## At the end of the day

> **On an iPhone running Part 6, do not sign out yet.** Part 6 needs the half-finished job left exactly where it is. Do the three steps below on the eighth day instead, once Part 6 is answered.

1. Tap **Sign out** on the day's jobs screen. If anything has not gone up yet, the app says how much and offers **Send first** before it lets you: tap it, stay in signal until the waiting line has gone, then tap **Sign out** again. **Sign out anyway** deletes what has not gone up, for good. With no signal the app will not sign out at all, and says so.
2. You should be back at **Technician sign in**.
3. Turn on aeroplane mode, close the app, and open it again. You should see the sign-in screen and **no jobs at all** — nothing of any client should still be on the phone.

| Question                                                     | Write it here |
| ------------------------------------------------------------ | ------------- |
| Did Sign out ask about unsent work first? What did it say?   |               |
| After signing out, was anything of a client's still visible? |               |
| iPhone: did you also sign out of Safari, or revoke that row? |               |
| Anything else that went wrong today, in your own words       |               |
| The one thing you would change about the app                 |               |

**Send back:** this sheet, filled in; the output of the two `wrangler` lines above; and any photograph of the screen you took when something looked wrong. Do not send any photograph of a client.

---

## What this test decides

- **Open point 56, the check-in radius.** The distances from Parts 1 and 3 are the whole evidence. Until they exist, 200 m is a guess.
- **What is left of open point 124.** Technicians use any phone, including iPhones. What the day and Part 6 now decide is whether that holds in practice on an iPhone: whether an installed app keeps a week's unsent work, whether the second sign-in reads as sensible rather than broken, and whether the camera gives ten usable frames through iOS's own pipeline. If Part 6 shows the work goes, installing to the home screen stops being advice and becomes a rule ops enforce before a phone is used in the field.
- **Open point 125, photograph sizes.** The app re-encodes each frame to about 250 KB; the sets from this day show whether that is enough to see a hairline in a basement.
- **Whether the app shows the technician enough at the door.** Board B5 shows the distance only on a failure, and the wait's evidence line names the distance without giving it.
- **Whether Navigate lands in the right place.** It sends a Google Maps route to the address's own coordinate where there is one and to the typed address where there is not (ADR 0054). Part 1 asks at three buildings; if it opens the wrong tower, the coordinate is what to look at, not the button.
