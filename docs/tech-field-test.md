# The technician app: the field test

This is the part of the technician app that no desktop can prove. Everything that could be tested from a desk was, on 23 September 2026, against the real staging API (`docs/verification.md`, "P2-F4: the technician app against the real mm-api"). What is left needs a real phone, a real client's door, a real basement and a real day.

You do not need to be a developer to run this. Each step says what to tap and what you should see, and leaves a line to write the answer on. Where a step says **write the number down**, the number is the point of the step — please do not skip it.

Print this, or copy it into a notes app, and fill it in as you go.

**Who runs it:** the owner, or a technician with the owner beside him for the first job.

**How long it takes:** one full working day, with three visits in different kinds of building.

**The one rule:** this is staging, with test jobs. Do not run it against a real client's visit unless ops have said which one, and never photograph a client without asking him first.

---

## Before you start

**Do `docs/technician-test-setup.md` first.** It is twenty minutes on any phone, anywhere, and it proves the sign-in, the six steps of a job and the day-before unlock before anyone books a working day for this. It also sets a technician up without touching Zoho, which is worth knowing: the sign-in reads our own database and not FSM, so step 1 below is how a **real** technician gets listed, not a condition of logging in.

Ops do these once. Tick each before the phone leaves the office.

| #   | Set up                                                                                                                                                                                    | Done |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | The technician is a user in Zoho FSM, active, **with his mobile number on his FSM user** (open point 12)                                                                                  |      |
| 2   | That mobile number is on staging's WhatsApp allowlist, or no login code will arrive (runbook, step 7)                                                                                     |      |
| 3   | Three jobs are scheduled in FSM for that technician, today, at the three buildings in Part 1                                                                                              |      |
| 4   | Each job's client address in FSM has a street address FSM could geocode (open point 26)                                                                                                   |      |
| 5   | The phone is an Android phone, charged to 100%, with the battery percentage switched on in the status bar                                                                                 |      |
| 6   | The phone can reach `https://tech-staging.maneman.in` — it is behind Cloudflare Access, so the technician signs in to Access with his founders' login first, or ops open the site for him |      |

**The phone the day starts on**

| Question                             | Write it here |
| ------------------------------------ | ------------- |
| Phone make and model                 |               |
| Android version                      |               |
| Network (operator, and 4G or 5G)     |               |
| Battery % at the start, and the time |               |
| Weather, and roughly how hot it is   |               |

---

## Part 0 — signing in

1. Open `https://tech-staging.maneman.in` in Chrome.
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

---

## Part 1 — the door, and how far the phone thinks you are

This is the most important part of the day. The app checks that you are within **200 m** of the address before it lets you start. Nobody knows yet whether 200 m is the right number, because nobody has measured how wrong a phone's position is at an Indian address (open point 46). **These three readings are the evidence that settles it.**

Run steps 1 to 7 at **each** of the three buildings.

### The three buildings

- **A — a Gurgaon high-rise.** Stand at the flat's own door, inside the tower, not in the lobby and not in the car park.
- **B — a gated sector house.** Stand at the house's front door, inside the gate.
- **C — a basement.** A basement car park or a basement salon, where the phone shows one bar or none.

### The steps, at each building

1. Open the app. Tap the job for this address.
2. You should see the client's name, the time, the address and **Navigate**.
3. Before tapping anything else, write down what the phone's status bar says: how many bars, and 4G, 5G, E or nothing.
4. Tap **I have arrived**. If Android asks for the location, allow it.
5. Wait. One of two things happens.
   - **It passed:** the screen changes to **2 · Waiting**, with a countdown from 15:00 and **Close as no-show** greyed out.
   - **It failed:** the screen says **Check-in failed** and, under it, **You are NNN m from the address**. That number is what we need.
6. If it failed: **write the number down**, walk to where you would normally stand at that door, and tap **Try again**. Write down the second number too, and whether it passed.
7. If it passed: the app does not show you the distance. **Write down the exact time** (hour and minute) instead, and ops read the number out afterwards — see "Getting the numbers out", below.

### Building A — a Gurgaon high-rise

| Question                                               | Write it here |
| ------------------------------------------------------ | ------------- |
| Address, in words (tower, floor, sector)               |               |
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

### Getting the numbers out

Every check-in is recorded whether it passed or not, with the distance it measured and the radius in force. At the end of the day, ops run this one line and keep what it prints with this sheet:

```sh
node node_modules/wrangler/bin/wrangler.js d1 execute maneman-staging --env staging --remote \
  --command "SELECT at, distance_m, radius_m, accuracy_m, passed FROM checkins ORDER BY at DESC LIMIT 20;"
```

`distance_m` is how far the phone said it was from the address; `accuracy_m` is how sure the phone was of its own position. Both matter. The owner rules the radius from these numbers.

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
8. On the way, tap the line at the top that says how much is waiting. You should see the photograph sets and the actions waiting, and **Never written to this phone's gallery.**
9. Finish the job. You should reach the close-out.
10. Now turn aeroplane mode **off**, and stand still for two minutes.
11. Go back to the day's jobs and open the waiting line again.

| Question                                                                             | Write it here |
| ------------------------------------------------------------------------------------ | ------------- |
| Did the app open at all with no signal after being closed? (yes / no)                |               |
| Did it show the day's jobs, or a blank page?                                         |               |
| Could you open the job's card and see the address?                                   |               |
| Did any step refuse to go through?                                                   |               |
| How much was waiting when you finished the job (photo sets, actions)                 |               |
| Time you turned aeroplane mode off (hh:mm)                                           |               |
| Time the waiting line emptied (hh:mm)                                                |               |
| Did anything stay stuck? If so, exactly what it said                                 |               |
| Did the check-in that ran when signal came back pass? What did the screen then show? |               |

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
| Did Android ever warn about heat, or dim the screen by itself?          |               |
| Did the camera ever refuse to open because of heat?                     |               |
| Did the battery last the day? If not, at what time did it run out?      |               |
| Roughly how many minutes was the app open and in front of you, all day? |               |

---

## At the end of the day

1. Tap **Sign out** on the day's jobs screen.
2. You should be back at **Technician sign in**.
3. Turn on aeroplane mode, close the app, and open it again. You should see the sign-in screen and **no jobs at all** — nothing of any client should still be on the phone.

| Question                                                     | Write it here |
| ------------------------------------------------------------ | ------------- |
| After signing out, was anything of a client's still visible? |               |
| Anything else that went wrong today, in your own words       |               |
| The one thing you would change about the app                 |               |

**Send back:** this sheet, filled in; the output of the two `wrangler` lines above; and any photograph of the screen you took when something looked wrong. Do not send any photograph of a client.

---

## What this test decides

- **Open point 46, the check-in radius.** The distances from Parts 1 and 3 are the whole evidence. Until they exist, 200 m is a guess.
- **Open point 27, the phones.** Whether any Android phone will do, or whether the company has to buy one kind.
- **Open point 34, photograph sizes.** The app re-encodes each frame to about 250 KB; the sets from this day show whether that is enough to see a hairline in a basement.
- **Whether the app shows the technician enough at the door.** Board B5 shows the distance only on a failure, and the wait's evidence line names the distance without giving it.
