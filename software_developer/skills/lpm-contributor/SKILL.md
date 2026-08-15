---
name: lpm-contributor
argument-hint: "[issue id, or nothing to take the next task]"
description: Work a light-plan (`.lpm`) board as an implementing developer — pick work up with the routing rules, read the full brief before coding, claim it, flag it when it stalls, and close it with a handover note a reviewer can act on. Use when the task is to take a ticket and do it — "what should I work on", "take the next task", "implement LP-42", "close out the issue I'm on" — rather than to plan a board.
intent: >-
  Guide a developer (human or agent) through one full pass of the light-plan contribution loop: read the board's own vocabulary, take the top routable item, pull the whole ancestor brief with get_instructions, claim before editing, keep relatedFiles honest, flag rather than guess when the work stops, and finish with an issue trail that a senior reviewer and a developer four months from now can both act on without asking anyone. Use this to stop the two failure modes that cost most on a shared board — code built against a story read in isolation, and a correct change nobody can review.
type: workflow
theme: code-craft
best_for:
  - "Picking up and completing the next ticket on a shared .lpm board"
  - "Leaving an issue trail a reviewer can judge without re-deriving the change"
  - "Handling a ticket that turns out to be blocked, vague, or secretly three tickets"
scenarios:
  - "What should I work on next on this board?"
  - "Implement LP-42 and close it out properly"
  - "I'm stuck on the ticket I'm holding — the requirement doesn't say what to do on a 4xx"
estimated_time: "one ticket — minutes to hours"
---


## Purpose

You are contributing to a distributed team whose plan lives in a **light-plan**
board — a `.lpm` folder of markdown, versioned with git. You take work off that
board, do it, and hand it back with enough written down that nobody has to ask
you what happened.

Your teammates are people and other agents, working the same board at the same
time, and most of them will never talk to you. **The issue document is the
conversation.** Code that works and an issue nobody can review is half a job.

## Input

**Required:** a repository containing a `.lpm/` board, reachable either through
the `light-plan` MCP server (`board_overview`, `next_tasks`, `get_instructions`,
`start_task`, `flag_issue`, `finish_task`, `add_comment`, `update_document`,
`create_document`, `split_issue`, `link_issues`, `link_research`,
`check_board`, …) or through the `lpm` CLI in a shell. Every MCP call below has a
CLI form — see *The CLI, when you have a shell and no MCP*.

**Optional:** a specific issue id, if you were handed one instead of asked to
take the next thing.

**Blocking:** if `board_overview` returns `currentUser: null` you have no
identity and `next_tasks` cannot route to you. Say so and stop — do not assign
work to an arbitrary person.

---

## Key Concepts

### The board is not generic — read it first

Every board defines its own document types, hierarchy and statuses. There is no
universal "epic" or "done".

**Always call `board_overview` before anything else.** It returns the type names,
the hierarchy they nest in, the statuses, the `priorityAttribute` and
`effortAttribute` the engine ranks by, who you are (`currentUser`), and the scope
you are being offered. Every other tool speaks in the names it gives you. Never
guess a type or status name; if you need one you did not see, ask.

### The two readers

Everything you write on an issue is for two people who are not in this
conversation:

- **the senior reviewer**, who needs to judge the change without re-deriving it;
- **the developer in four months**, who has hit a bug here and needs to know why
  it is the way it is.

Neither of them can see your terminal.

### The asymmetry is deliberate

You can raise a flag; you cannot clear one. You can propose structure —
a new issue, a split, a dependency — you cannot re-shape the plan. That is the
design, not an oversight: it keeps the plan owner in the loop on exactly the
decisions that are theirs.

---

## Application

### Step 1: Find work

```
next_tasks { limit: 10 }                    # yours, ranked, ready to start
next_tasks { includeUnassigned: true }      # widen only when the first is empty
current_tasks                               # what you already hold
```

`next_tasks` only ever offers work that is **genuinely startable**: a leaf issue
(containers are never offered — their children carry the work), not finished, not
already active, assigned to you or parked in a pool you cover, with nothing
unfinished blocking it. The order is the running or overdue period first, then
unscheduled work, then periods that have not started; within that, priority, then
how close to done, then how much each issue unblocks.

Each item says `route`: `direct` (yours), `pool` (waiting in a pool you cover) or
`unassigned`. Prefer `direct`, then `pool`. Take `unassigned` only when you were
asked to, or when the first two are empty and you say in your first comment that
you claimed it off the unassigned queue.

**Do not shop around the board for something more interesting.** The ranking
encodes the team's sequencing decisions. If you think the top item is wrong,
comment saying why rather than silently taking the second.

If `next_tasks` is empty, use `list_documents { leavesOnly: true, status: ... }`
to see what *is* there and report the situation — usually everything is blocked,
which is information the orchestrator needs.

`flagged_issues` lists everything stopped across the board, and is worth a look
before you start something: if a flag names the area you are about to work in,
read it.

### Step 2: Get the brief

```
get_instructions { id: "LP-42" }
```

**This is the call that tells you what to build, and it is not optional.** A
story on its own almost never explains itself: the epic says why the work is
wanted, the feature says what capability it belongs to, and the story only says
which slice of it you were handed. `get_instructions` walks that hierarchy for
you and returns one piece of markdown — every ancestor's title and body in
order, then the issue, then its breakdown, **the files it names**, **where the
work comes from and where it is going**, the research it rests on, and its work
log.

Read the whole thing before you touch any code. An issue implemented against the
story alone is how you build the right code for the wrong reason.

Three sections earn their reading and are easy to skim past:

- **Files this is about** (`relatedFiles` on the document). These are the paths
  the issue was written against — the paragraphs of the requirement it came from,
  the module it expects to change — sometimes with a line range
  (`docs/prd.md#L120-L164`). **Open them before you go looking.** A path may name
  a file that does not exist yet; that usually means you are meant to create it.
  They are hints written by a person, not a generated list, so treat a stale one
  as a lead rather than as a contradiction.
- **Where this comes from.** The issues this one was sequenced after, and — where
  they named files — what that work touched. When a file appears both there and in
  this issue's own list, you are about to change something somebody just changed:
  read what they did, and their comments, before you undo it by accident.
- **Where this is going.** What is sequenced *after* this issue. It is the shape
  your work has to end up in. A change that closes this ticket and blocks the next
  one has not finished the job, and this is where you find that out in advance
  rather than in review.

If the brief opens with a **flag**, somebody already picked this up and stopped.
Read the work log first: repeating an investigation that already failed is the
most expensive thing you can do here. Do not clear the flag to get on with it —
that is the plan owner's decision (see Step 5).

The layout comes from the board (`.lpm/templates/context/`), so a team can decide
what its developers are told. **Do not pass `template`** unless you were asked to
use a specific one. If the reply carries `warnings`, the board's template asked
for something this board does not have — mention it, do not try to fix it.

If the call comes back **refusing** a template, that is the safety check. These
layouts compile to JavaScript, and one that reaches outside the board is not
rendered. Report it and stop: there is no override for agents, and a board
carrying a template that can run code is something a human has to look at.

`get_document { id }` remains the raw record — fields, attributes, `ancestors`
as ids, links, comments — and is what you want when you are about to *change* a
document rather than do it.

Then decide whether it is actually startable, honestly:

- Is there a definition of done, or at least acceptance criteria you can test
  against?
- Do you understand the *why*, not just the *what*?
- Are its `blockedBy` issues really finished, or just marked so?
- Does the codebase match what the issue assumes?

**If it is not startable, do not start it and do not guess.** Add a comment
naming exactly what is missing and what you would need to proceed, and move on to
the next item. A ticket returned with a precise question is worth more than one
half-implemented against an invented requirement. Vague blockers ("unclear
requirements") are useless — write the question you actually need answered.

(If you have already claimed it and only then discover it is not startable, flag
it rather than un-claiming it — Step 5.)

### Step 3: Claim it

```
start_task { id: "LP-42" }
```

This assigns it to you and moves it to the board's first active status, so the
rest of the team can see it is taken. Claim it **before** you start editing code,
not after — that is what stops two agents doing the same ticket.

Never pass `force: true` to take work assigned to somebody else. If you believe
you should have it, comment and let the orchestrator move it.

Immediately leave an intent comment (see *What to write on an issue*). It costs
one call and it is what makes a half-finished ticket recoverable if you are
interrupted.

### Step 4: Do the work

Work as you normally would: read the code, make the change, run the tests. Three
board-specific obligations while you are in there:

- **Comment when the picture changes**, not just at the end. Something surprising,
  a blocker, a decision that closes off other options, an approach abandoned — all
  of it goes on the issue while it is fresh.
- **Work you discover is not yours to absorb silently.** See *When you find more
  work*.
- **Keep `relatedFiles` true.** When you end up in a file the issue did not name,
  add it:

  ```
  get_document { id: "LP-42" }            # returns relatedFiles
  update_document { id: "LP-42", relatedFiles: [...existing, "src/checkout/pay.ts"] }
  ```

  It replaces the whole list, so send the existing entries back with the new one.
  This is not bookkeeping: the next issue sequenced after yours gets these paths
  in its brief, under *what that work touched*. It is how a developer three
  tickets later finds out that you were here.

### Step 5: If the work stops, flag it

Sometimes you cannot finish, and the reason is not something more effort fixes —
a credential you do not have, a decision nobody has made, a requirement too vague
to build against. You have four options and three of them are bad: guess at the
requirement, invent a workaround nobody asked for, or drift onto another ticket
leaving this one open and silently stuck.

The fourth is to say so:

```
flag_issue {
  id: "LP-42",
  reason: "blocked" | "paused" | "help",
  comment: "<what stopped, what you tried, what would resolve it>"
}
```

The issue keeps its status and stays assigned to you — it is still yours — and it
turns **red** on the board for whoever is running the plan. Pick the reason
honestly: `blocked` when something outside the issue has to happen first, `help`
when a person is needed (a decision, a review, an opinion), `paused` when you are
deliberately setting it down.

The comment is required, and it is the entire value of the flag. Write it for
somebody who has not read a word of this session:

```markdown
Stopped: <the thing that stopped it, in one line>.

Tried: <what you did, and what it did>.
Blocked on: <the specific decision, access or fact you need — a question, not a mood>.
Unblocks when: <what has to be true for this to go on>.
```

"Unclear requirements" is not a flag, it is a shrug. "The story says 'retry on
failure' but does not say how many times or whether to retry a 4xx; I need a
number and a rule" is a flag somebody can answer in thirty seconds.

**Do not clear your own flag to get past it.** `clear_flag` is the plan owner's
tool and you do not have it. If the answer arrives while you are still holding
the issue, comment with it and ask for the flag to be cleared. Finishing the
issue clears it for you.

### Step 6: Close it

```
finish_task { id: "LP-42", comment: "<the handover note>" }
```

`finish_task` takes the comment in the same call — use that, so the note and the
status change land together.

**Only close what you have verified.** If the tests do not pass, or you could not
run them, the issue is not done: say so in a comment and leave it in progress, or
hand it back. Reporting a green run you did not see is the one unrecoverable
mistake here, because the next person builds on it.

---

## What to write on an issue

This is the part that matters most and the part agents do worst. Write what the
diff cannot say: **why**, **what you rejected**, **what you verified**, **what is
still open**.

### Rules

- **Specifics, not adjectives.** "Fixed the caching bug" is worthless. "`resolve()`
  cached on the raw path, so `./a` and `a` were separate entries — normalised
  before the lookup in `src/core/cache.ts:88`" is a review.
- **Cite `file.ts:line`.** A reviewer should be able to click straight there.
- **Paste the evidence.** The command and the real result, not a claim about it.
- **Record the roads not taken.** The alternative you rejected and why is the
  single most valuable thing you can leave; it is what stops the next person
  re-litigating a decision you already made.
- **Name the uncertainty.** "I am not sure this handles the empty case; worth a
  look" is a gift to a reviewer. Confident prose over a shaky change is a trap.
- **Never say "as discussed" or "see above".** There is no above. The issue is the
  whole record.
- **No status theatre.** "Working on it", "almost done", "great progress" — delete.
  If you have nothing factual, do not comment.

### Comment templates

**On claiming** — one short paragraph, so an interrupted ticket is recoverable:

```markdown
Picked this up. Reading it as: <the requirement in your own words, one or two sentences>.

Plan: <the approach, 2-4 bullets>
Assumptions: <anything you inferred that the issue did not say — these are what a reviewer should challenge first>
```

**While working**, when something changes:

```markdown
<What happened, factually.>

- Tried <X>; <what it did>. Abandoned because <reason>.
- Going with <Y> instead: <why>.
```

**On finishing** — the handover note, and the one a reviewer will actually read:

````markdown
## What changed
- `src/core/cache.ts:88` — normalise the path before the lookup
- `src/core/index.ts` — export `normalisePath`
- `test/cache.test.ts` — case for `./a` vs `a`

<!-- and put those same paths on the issue with update_document { relatedFiles } -->

## Why this way
<The approach in a few sentences, and what it rests on.>

Rejected: <alternative> — <why not>.

## How I verified it
```
$ npm test
Test Files  19 passed (19)
     Tests  430 passed (430)
```
<Anything you could NOT verify, and why.>

## For the reviewer
- <The judgement call you are least sure of.>
- <Anything that needs a second opinion.>

## Follow-ups
- LP-57 — <the work this uncovered, already on the board>
- <Or: none.>
````

Drop sections that would be empty. Never pad one to look thorough.

### Handing a ticket back

If you cannot finish it, do not just abandon it. **Flag it** (Step 5) with what
you did, what you learned, and precisely what is blocking. A flagged ticket is
visible; a ticket left in progress with a comment is a needle in the board. Then
either leave it with you — the normal case, since the flag says it is not moving —
or ask the orchestrator to reassign. Include enough that whoever takes it next
does not repeat your dead ends; that is the whole value of the trail.

---

## When you find more work

Real implementation always uncovers work the ticket did not mention. Silently
absorbing it hides scope and breaks the plan's estimates; silently ignoring it
loses it. Put it on the board instead:

- **A bug or a follow-up you found** — `create_document` with a type from
  `board_overview`, parented under the same feature, with a body that says how to
  reproduce it and where you were when you hit it. Then reference the new id in
  your comment on the original issue.
- **Your ticket really was several tickets** — `split_issue { id, titles: [...],
  mode: "children" }` nests the pieces inside it and chains them so each waits on
  the one before. Use `mode: "replace"` only if the original should disappear.
  Comment saying why you split it.
- **You discovered a real dependency** — `link_issues { blocked: "LP-42",
  blockedBy: ["LP-40"] }`. Only forward edges are stored and a cycle is refused.
  This is how you tell the rest of the team something has to happen first; it is
  also what stops `next_tasks` handing your ticket to someone else prematurely.
- **The work came out of a research or spike ticket** — `link_research { issue,
  informedBy: [...] }`, so if that finding is later wrong, the research ticket
  lists everything that has to be revisited.

Do **not** reshape the plan beyond this. Re-parenting epics, changing types,
re-scheduling periods and re-assigning people are the planner's job. If the
structure is wrong, say so in a comment.

---

## Hard rules

- **Never hand-edit files under `.lpm/`.** Every board change goes through the MCP
  tools or the `lpm` CLI, which validate, keep ids and links consistent, and write
  the frontmatter in the order the engine expects.
- **Never invent a type, status or attribute name.** Use what `board_overview`
  returned.
- **Never close an issue you did not verify**, and never report a test result you
  did not see.
- **Never take work assigned to someone else** with `force`.
- **Never start an issue whose brief you have not read.** One call, and it is the
  difference between building the requirement and building your guess at it.
- **Never leave a ticket in progress with no comment.** A silent in-progress issue
  is the worst state on the board: it looks claimed and teaches nobody anything.
- **Never leave a ticket stuck without flagging it.** Same failure, louder: an
  issue that is going nowhere and does not say so is a lie the board tells the
  rest of the team every time they look at it.
- **Never clear a flag to get past it.** You do not have `clear_flag`; that is
  deliberate. Answer it in a comment and ask.
- **Never guess at a file path in `relatedFiles`.** Add the ones you actually
  opened or changed. A wrong path costs the next reader more than a missing one.
- **A dependency you cannot open is not a reason to stop.** If your board is
  scoped by a profile, scope narrows what is *offered*, never what is *reachable* —
  `get_document` reads any id. See `docs/profiles.md`.

---

## The CLI, when you have a shell and no MCP

Everything above has a command-line form. `lpm --help` lists the rest; every
command takes `--help`.

| Intent | MCP | CLI |
| --- | --- | --- |
| Understand the board | `board_overview` | `lpm check`, read `.lpm/config.yml` |
| Who am I | `board_overview` → `currentUser` | `lpm me` |
| What should I do | `next_tasks` | `lpm task next [--unassigned] [--limit n]` |
| What do I hold | `current_tasks` | `lpm task current` |
| **Get the brief for one** | `get_instructions` | `lpm instructions <id>` |
| Read the raw record | `get_document` | `lpm open <id> --path`, `lpm comment <id> --list` |
| Claim it | `start_task` | `lpm task start <id>` |
| Comment | `add_comment` | `lpm comment <id> -m "..."`, or `-f notes.md`, or `-f -` for stdin |
| **Say the work stopped** | `flag_issue` | `lpm flag <id> --reason blocked\|paused\|help --comment "..."` |
| What is stopped | `flagged_issues` | `lpm flag list` |
| Record a file | `update_document { relatedFiles }` | `lpm set <id> --related <path>` (`--unrelated` to detach) |
| Finish | `finish_task` | `lpm task done <id>` |
| New issue | `create_document` | `lpm new <type> -t "..." -p <parent>` |
| Dependency | `link_issues` | `lpm link <id> --depends-on <ids>` |
| Provenance | `link_research` | `lpm link <id> --informed-by <ids>` |
| Non-blocking link | *(CLI only)* | `lpm link <id> --relates-to <ids>` |
| Split | `split_issue` | `lpm split <id> --titles "A,B,C" [--replace]` |
| Validate | `check_board` | `lpm check` (exit 1 while errors remain) |

For a long comment, write it to a file and pipe it in — it keeps the markdown
intact and avoids quoting problems:

```bash
lpm comment LP-42 -f ./handover.md
```

---

## Common Pitfalls

### Pitfall 1: Implementing against the story alone
The story is one slice. Without the epic you do not know *why*, and without
"where this is going" you do not know the shape your change has to leave behind.
`get_instructions` is one call. Skipping it is how correct code lands against the
wrong requirement.

### Pitfall 2: Shopping the queue
Taking the second item because the first looks dull discards the team's
sequencing. Disagree in a comment, not by picking.

### Pitfall 3: Editing before claiming
Two agents on one ticket is the most expensive collision on a shared board, and
`start_task` before the first edit is the entire prevention.

### Pitfall 4: A shrug dressed as a flag
"Unclear requirements", "needs discussion", "blocked on infra" cannot be answered.
Name the decision, the access, or the fact — one that somebody can supply in a
sentence.

### Pitfall 5: The confident closing comment over an unverified change
"Fixed and tested" without the pasted run is the one unrecoverable error, because
the next person builds on it. If you could not run the tests, say exactly that.

### Pitfall 6: Absorbing discovered work silently
The bug you fixed on the way through, unrecorded, breaks the plan's estimates and
vanishes from history. `create_document`, then reference it in your comment.

### Pitfall 7: `relatedFiles` left as the planner wrote it
It is the channel through which the next three tickets learn you were here. Add
the files you actually opened, and send the existing list back with them.

---

## Working sequence, condensed

1. `board_overview` — types, statuses, who you are.
2. `next_tasks` — take the top item you can honestly start.
3. `get_instructions` — the epic, the feature, the story, **the files it names**,
   where it comes from and where it is going, the blockers, **and the comments**,
   as one brief. Read all of it. Open the files before you go looking.
4. Not startable? Comment with the precise question. Next item.
5. `start_task`, then an intent comment.
6. Implement. Comment when the picture changes. Put discovered work on the board.
   Add files you touched to `relatedFiles`.
7. Stuck on something effort will not fix? `flag_issue` with the question, and
   stop. Do not guess, do not work around it, do not drift onto another ticket.
8. Run the tests. Actually run them.
9. `finish_task` with the handover note — what changed, why, what you rejected,
   how you verified it, what is still open.

Leave the board so that someone who has never spoken to you can review your work,
and someone in four months can understand why it is the way it is.

---

## References

### Related skills

- `skills/clean-code-*` and `skills/design-patterns-*` — the craft standard the
  implementation in Step 4 is held to. Load the one matching the language.
- `product_management/skills/progressive-implementation-planning` — how the board
  you are working was meant to be sequenced.

### Related agents

- `subagents/lpm-developer.md` — the same loop packaged as a standalone
  subagent, with its tool allowlist, for when the work should run in its own
  context rather than in yours.
- `product_management/subagents/lpm-planner.md` — the counterpart that owns board
  structure, and the holder of `clear_flag`.
