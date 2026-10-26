# The War Room: Operate the conference

**Status:** plan for Stephen's approval, 2026-10-23. Nothing here is built yet.
**Extends:** `CONFERENCE_V2_BLUEPRINT.md` (Describe → Package → Sell). That covers
building and selling a conference; this covers running one.

---

## 1. Three modes, one test

| Mode | What it is | Where |
|---|---|---|
| **Setup** | The first round of details: the major parameters, how things work. | A wizard we make someday. |
| **Manage** | Putting meat on the bones once things are on sale. A session gets added, badges get designed, legal agreements filled in, contacts added, **checklists written**, the conference goes live. | The conference admin pages (Describe / Sell / Fulfill). |
| **Operate** | Doing the conference that exists: print, send, check in, answer, confirm, decide, **work the checklists**. | **The War Room** (administrators) and **the Check-in Desk** (desk staff). |

**The test for any control:** does it change what the conference *is* (Manage), or
carry out what it already is (Operate)?

- Adding a badge type → Manage. Making sure the badges get printed → Operate.
- Writing a checklist → Manage. Doing it → Operate.
- Going live (a status change) → **Manage**: it substantially changes how things behave.

Operate starts the moment there is something to carry out. Printing the badge
package in January is Operate; so the War Room is the operations centre for the
whole run, not only the days on site.

## 2. Who uses what

| | War Room | Check-in Desk |
|---|---|---|
| **CSC staff** (global admins) | Yes | Yes |
| **Desk staff** (temps) | **No** | Yes |

- The War Room becomes **administrators only**. Today it admits desk staff and shows
  them buttons to pages they cannot open.
- Desk staff remain the existing per-conference desk appointment
  (`conference.desk_staff`): easy to give, easy to revoke, and able to do little
  beyond working the desk. It already works this way; the War Room stops pretending
  otherwise.
- Printing a one-off is a War Room action too ("reprint this badge" by search), so
  staff do not need the desk's camera and touch interface for it. The desk keeps
  "the person in front of me".

## 3. One pattern for every Operate row

Every thing to do in the War Room is a row with the same anatomy:

```
 Badge package                                   Due 11 Jan
 Made 1 Sep; 21 people added since.            [Edit] [Preview] [Make it]
```

- **Live state**: one sentence from real data. When the row is blocked, the sentence
  says what it is waiting on ("Waiting on: 21 people added since the last
  package"), and there is no greyed-out button.
- **Edit** → the Manage page for whatever this depends on. The only control that
  leaves the War Room.
- **Preview** → a modal over the War Room showing exactly what will happen: the PDF,
  the list, the email, the grid. Nothing is done.
- **Do it** → happens right there. First press arms it; the confirmation names the
  blast radius ("Email 120 people", "Print 34 badges", "Publish 300 meetings").
  The row then updates in place with the result.
- **Detail lives in the modal, never stacked down the page.** A row stays short. (The
  Elections timeline's flaw is that it scrolls forever; this pattern exists to avoid it.)
- Done rows fold away; overdue or broken rows get colour and rise to the top.

**Every button that does something gets a confirmation**, in the War Room and on the
Manage pages alike.

## 4. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Campus Stores Conference 2027 · War Room      Manage ▸   ⚙︎ Me │
│ ● 2 waiting on us   ● Print station online   Next: Badge      │
│   package, 11 Jan (80 days)   [during meetings: 32/40 ✓]      │
├──────────────────────────────────────────────────────────────┤
│ Waiting on us · What's next · Print · Meetings · Messages ·   │
│ People · Answers                                              │
├──────────────────────────────────────────────────────────────┤
│  rows…                                                        │
└──────────────────────────────────────────────────────────────┘
```

- **Its own slim header**, not the conference admin layout. Conference name, a
  single **Manage ▸** link back to the admin pages, and **⚙︎ Me** for personal
  settings (print sort lives here, not above the work).
- **A status line** that answers "is anything on fire?": waiting-on-us count (red if
  any is urgent), print station, the next deadline, and during meetings the
  confirmed count. Each piece links to where you fix it. It shows only what is live.
- **Tabs** are the page's main control, directly under the status line.
- **Removed:** the War Room's header button row (every button duplicated the
  conference nav), the "Operations" card around the tabs, the duplicated
  "War Room" title. The Describe/Sell/Fulfill strip does not appear in the War Room.
- **Works at a desk and on a phone.** Operate spans January at a desk and February on
  the floor.

## 5. The tabs

### Waiting on us
One list of everything where a person is waiting on CSC, oldest first, urgent on top:

| Source | Today lives on | Actions in the row |
|---|---|---|
| Ask CSC (from /me) and asks staff add | War Room Asks | Reply happens in Butler's room; **Done** |
| Swap requests and swap-cap increases | Swaps page | **Approve / Deny / Grant override** |
| Travel-window exceptions | Registrations page | **Approve / Reject** |
| Bursary applications awaiting a decision | /admin home widget | **Decide** |

Each item says who, what, how long they have waited, and the details we hold (store,
booth, now/next). The pages they come from keep their history views; the War Room is
where they are acted on.

### What's next
The staff checklists, as today: Now / Next / Later / Done, ordered by their own dates.
Each task becomes an Operate row (§3). Monitored tasks need no tick; print tasks get a
single "Printed" tick, not three pills.

### Print
Everything that comes out of a printer, in one place:

| Row | Edit | Preview | Do it |
|---|---|---|---|
| Badge package (all, a type, or a list) | Badge Ops design / rules / arrangement | The PDF | Make it ("34 badges") |
| Reprint one badge (by search) | The person's contact | The badge | Print / send to the station |
| Check-in cards | Build ("Check-in card: yes") | The sheet | Print |
| Door lists (one per capped event) | Build (the event) | The list | Print |
| Attendee list | — | The list | Print |
| Map sheet | Floor plan | The sheet | Print |
| Directory | Directory definition | The book | Print / Export for InDesign |
| Individual schedules / suite door sheets | Schedule | The pages | Print |
| Task documents (speeches) | Documents page | The file | Send to printer |
| Print station | — | Status, queue, jobs | Get a key / Remove |

- **One print engine underneath.** Reprint is one action with three scopes: everyone
  (or a type or list) in the War Room, one badge by search in the War Room, the
  person in front of you at the desk. Today there are three reprint paths and two
  ways of editing a name first; they become one.
- Badge Ops keeps only the Manage half: design, types, rules, stock, arrangement.

**Landed 2026-10-26 (phase 3).** `printBadge` is the engine (the desk's sequence:
plan for the card in hand, a sticker straight to the station); the desk, the Print
tab and the People drawer call it, and the PATCH route's reprint branch is gone.
Sheets preview frameless (`?embed=1`) and print from the Preview. Badge Ops lost
Make Badges, Quick Reprint, Generate and the jobs table; `?mode=make` goes to the
Print tab. **Not yet:** a package for one type or a list (it is all, with or
without blanks); print station keys stay on its own page, linked from the queue;
task documents (speeches) stay on their task in What's next.

### Meetings
| Row | Edit | Preview | Do it |
|---|---|---|---|
| Generate a draft | Schedule (days, suites, cadence) | The draft against the current one | Generate |
| Publish the schedule | — | The grid and the change from now | Publish ("300 meetings to 120 people") |
| Email everyone their schedule | Comms template | The email | Send ("120 people"), through Comms |
| Live fixes on the day | — | The grid with ✓ confirmations | Move / cancel a meeting |
| Meetings so far confirmed | — | Unconfirmed list | — |

Schedule Ops' Operate content moves here; the Schedule page keeps days, suites and
cadence.

**Landed 2026-10-26 (phase 4).** One read (`loadMeetingsOverview`): the matrix, the
newest draft diffed against the live run (`diffAgainstActive`, moved server-side
from Schedule Ops), who the email reaches (`planScheduleDelivery`, the send's own
plan) with the real mail rendered for one of them, and `meetingsSoFar` with its
unconfirmed list. The grid opens in a full modal; cancelling or changing a live
meeting is confirmed and says nobody is emailed. Publish and Send are super-admin
only on the server, and the rows say so instead of failing. Schedule Ops is gone;
its address redirects here. **Not yet:** a real move (it is still cancel + add),
notifying people after a hand edit, the late-add run (`extendRunId`), and a
readable failure report (diagnostics are still raw JSON).

### Messages
**Comms remains where things are sent and tracked** (so they stay in the calendar).
The War Room shows this conference's messages **in context** and sends through Comms:

| Row | Edit | Preview | Do it |
|---|---|---|---|
| Checklist reminders | The checklist | Who would get what | Send ("38 organizations"), **this conference only** |
| Conference campaigns (sent, scheduled, drafts) | Comms | The email | Send / schedule ("N people") |
| Automatic emails (confirmation, schedule ready…) | Comms template | The email | — (they fire on events) |

**Landed 2026-10-26 (phase 5).** `runChecklistReminders` takes a `conferenceId`;
the War Room's row runs its dry run as the Preview and count, then the same run
for real. The dry run is now read-only (it used to insert checkpoints) and names
recipients by org id, not org name. The engine builds digests in parallel:
164 s → 31 s for the 2027 conference. Checklist detail lost its global "Send
Reminders Now". Campaigns tagged to the conference show with Comms' own preview
and a confirmed Send now (count from Comms' audience resolution); automatic
emails are listed read-only with counts. Comms' Send Now is confirmed with its
count, and Comms' send / schedule / cancel / create actions check admin
themselves. **Seen while testing:** the last reminder for 2027 went out
2026-10-10 and none since, with 16 orgs due; the daily cron is not sending.

### People
People Lookup as today, plus the per-person Operate actions: check in by hand, reprint
this badge, admin notes. The person drawer's broken prompts are replaced by the
shared modal and confirmation. **Sync People Index** moves here (the only tab it
affects).

### Answers
As today: answers and menus, Edit → Build.

## 6. What changes on the Manage pages

| Page | Change |
|---|---|
| Badge Ops | Loses Generate, reprint, jobs (→ Print). Keeps design, types, rules, stock, arrangement. |
| Schedule Ops | Its Operate content moves to Meetings; the page goes, or becomes the run history. |
| Schedule | Keeps days, suites, cadence and programme items. The live grid's edits move to Meetings. |
| Registrations | Travel exceptions → Waiting on us. Exports → a data row. |
| Travel Import | **Deleted.** One travel import, shown only when the conference uses travel. |
| Swaps | Decisions → Waiting on us; the page keeps history. |
| Checklist detail | "Send Reminders Now" → Messages, scoped to this conference. |
| Overview / Status | **One** lifecycle panel (going live is Manage). |
| /admin home | Bursary decisions → Waiting on us; the widget links there. |
| Every Manage delete | Gets the shared confirmation. |

## 7. Shared pieces to build once

- **Modal**: the site has none (only `ImageUploadModal`). One, used by every Preview.
  Borrow from `EmailPreviewModal` and `BoothMoveModal`.
- **ConfirmAction**: arm-then-confirm naming the count. Lifted out of Elections
  (`ConfirmSendButton`, `ConfirmSubmitButton`, which are two copies of one idea) so the
  War Room, the Manage deletes and Elections all use it.
- **OperateRow**: state sentence + Edit / Preview / Do it, the §3 anatomy.
- **The print engine**: one reprint/print path, three scopes.

## 8. Fixed along the way

Found by the inventory, folded into this work:

1. **Send Reminders Now runs every conference's checklists**, from any checklist page,
   with no confirmation. → Per conference, with a count.
2. **Campaign Send Now** has no confirmation. → ConfirmAction.
3. **Travel import exists twice** with two server actions. → One.
4. **Reprint exists three times**, with two name-edit paths. → One engine.
5. **The lifecycle panel appears twice.** → One.
6. **The War Room shows desk staff admin-only buttons.** → War Room is admin-only.
7. **People drawer:** reprint by `window.prompt`, an invalid reason silently dropped,
   failures shown to nobody. → Modal + ConfirmAction + visible errors.
8. **Destructive deletes without confirmation** (a day, a catalogue thing, a document,
   a desk-staff member). → ConfirmAction.
9. **Naming:** "Asks" collides with Partner Asks; the queue becomes **Waiting on us**.

Not in scope, noted: the Build page writes to the database on page load
(`ensureMembershipRenewalEntity`).

## 9. Build order

Each phase ships on its own and leaves the site working.

1. **Foundations.** Modal, ConfirmAction, OperateRow. The War Room's own shell
   (slim header, status line, tabs), admin-only. Remove the header row and the
   Operations card; print sort to ⚙︎ Me.
2. **Waiting on us.** Asks + swaps + travel exceptions + bursary decisions in one queue.
3. **Print.** The print engine; Print tab; Badge Ops loses its Operate half; the people
   drawer's reprint uses the engine.
4. **Meetings.** Generate / Publish / Email rows with previews; live fixes; Schedule
   Ops retired or reduced to history.
5. **Messages.** Per-conference reminders; conference campaigns in context; Send Now
   confirmation.
6. **Data.** One travel import (gated by travel); exports as rows.
   **Landed 2026-10-26, changed by Stephen:** both travel imports, the six
   Registrations exports and the travel-exception review all read
   `conference_registrations` (0 rows; registrations are seats), so they were
   deleted, with the Travel Import page. The Data tab exports the live roster
   (`exportConferenceRoster`: everyone, dietary, accessibility, emergency
   contacts behind a confirmation), audited as before. No travel import until a
   conference collects travel. Still live and unlinked: the old
   `/conference/[year]/[edition]/register` form, which writes that dead table.
7. **Manage clean-up.** One lifecycle panel; confirmations on every Manage delete.

## 10. Open questions

1. **"Uses travel"** does not exist as a setting. Derive it from the catalogue (any
   registration that asks for travel), or add an explicit switch on the conference?
2. **Schedule Ops**: delete it once Meetings has its content, or keep it as the run
   history?
3. **Elections**: adopt ConfirmAction and OperateRow too, or leave it until its next
   cycle?
4. **Automatic emails** in Messages: list them read-only, or allow "send again to one
   person" (an Operate act)?
5. **Carolyn and Greg** are the "CSC staff" Ask CSC reaches, and are rarely signed in
   (Carolyn's session refreshed today; Greg's last on 23 September). Is the War Room
   where they will work, or does Butler in Circle stay their main way in?
