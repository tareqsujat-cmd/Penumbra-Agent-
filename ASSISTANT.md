# Armstrong: Penumbra's built-in assistant

Armstrong is the assistant that lives behind the **Ask** button in Penumbra's header. It helps people who have
never planned a lunar landing (students, members of the public, judges) as well as mission planners to:

1. **learn the app**: what each screen and control does, and where things are;
2. **make choices**: site, landing date, landing accuracy, how careful to be, where to aim, vehicle;
3. **understand the results**: what the numbers mean for their mission, in plain words.

Armstrong never invents numbers: everything it says about a mission comes from Penumbra's own calculations. And it
never changes anything on its own: it suggests a change, you click **Do it for me**, and you can **Undo** it.

---

## Two modes

| | **Built-in guide** (default) | **AI assistant** (optional) |
|---|---|---|
| What it is | A scripted guide written for non-specialists: no AI involved | Claude (Anthropic's model), answering in natural language |
| Cost | Free | Pay-as-you-go Claude API usage |
| Internet | Not needed: works fully offline | Needed |
| Understands | Buttons, plus common typed questions and requests | Any question |
| Turns on | Always, unless the AI assistant is available | When the server has `ANTHROPIC_API_KEY` set |

The panel picks the mode automatically: if the server reports that the AI assistant is available it uses it,
otherwise it uses the built-in guide. Both modes share the same change cards (**Do it for me** / **Apply**).

---

## What Armstrong can do (built-in guide)

### Greets you and suggests a first move
On a first visit, a small bubble next to **Ask** offers a short tour ("Show me around" / "Maybe later"). It appears
once per browser and never blocks the app. Opening the panel shows a greeting that says where you are (section,
site, landing date) and highlights the suggested next move.

### Walks you through planning a landing
**Walk me through it** goes through the seven steps of the mission sequence, one at a time:

1. Choose a site
2. Pick a landing date
3. Allow for landing errors (landing uncertainty)
4. Find a safer target (the robust aim)
5. Look at the skyline
6. Compare the sites
7. Save your decision (export)

Each step shows a progress bar, explains *why* the step matters in plain words, highlights the control on screen,
and offers **Do it for me**, **Show me where**, **Skip this step** and **Stop the walkthrough**. If you do a step
yourself in the app, Armstrong notices, ticks it off and moves on.

### Explains every choice in plain words, with your numbers
- **Tips** (on by default, switch with *Tips on/off*): whenever you change the site, landing date, landing accuracy,
  caution level, aim, vehicle or mission length, Armstrong explains what the new choice means for your mission and
  suggests the next step. For example, after a date change it says how many of your first days get sunshine, when
  the first night starts, how long it lasts, and whether the battery survives it.
- **Explain my choices**: all current choices, one by one, opening with a one-line **In short** verdict.
- **Explain my results**: the mission card's numbers translated into everyday language.
- Analogies instead of jargon: the landing zone is like throwing a dart at a target, the brightest point is "the
  sunniest seat in a stadium", P10 means "planning for a bad day".

### Explains anything you point at ("What's this?")
Tap **What's this?**, then tap anything on screen: a number in the mission card, the calendar rows, the map, its
colour key, the skyline, the landing-results chart, a header button. Armstrong explains that part, using your
numbers. While the mode is on, hovering outlines what would be explained, and the tap does not press the control
underneath. *Esc* cancels.

### Lets you go deeper, at your own pace
- Technical words in answers (P10, robust aim, DSN, landing zone, longest darkness…) are underlined: tap one for a
  plain explanation.
- Explanations are short; **Tell me more** gives the detail behind them (where the terrain data comes from, how
  the Sun's position is computed, what a percentile is…).
- **Read aloud** reads any answer using the browser's built-in voice (free, offline on most systems).

### Helps you decide
- **Help me choose a site** asks three quick questions (what matters most: sunshine, contact with Earth, getting
  through long nights, or a balance; how precisely your lander can touch down; how careful to be), compares all
  five sites with those settings and recommends one, with the reasons, the runner-up and an honest trade-off.
- **Help me pick a landing date** asks how long the mission must last and what matters most (sunshine, battery,
  contact with Earth), scans every landing day of 2027 and recommends a date with alternatives.
- **Quick comparisons**: other landing accuracies (±50 / ±100 / ±400 m), the four caution levels side by side, all
  five sites for your date, the best landing dates.

### Understands typed requests and follow-ups
Without AI, Armstrong recognises the things people name (site, date, distance, caution level, mission length,
section, vehicle) and what they want:

| You type | Armstrong |
|---|---|
| "switch to Shackleton", "set accuracy to 400 m", "land on 15 July" | Prepares the change as a card |
| "what if I land on 15 July?", "and Malapert?", "400 m?" | Compares that option with your current one |
| "show me the calendar", "where is the landing date?" | Highlights it on screen |
| "what does P10 mean?", "how do I export?" | Explains, in plain words |
| "yes" / "no" / "next" / "tell me more" / "show me" | Acts on its last suggestion |

Site names are recognised even with small typos ("shakleton"). Anything it can't understand gets a short apology
and a list of things it can do.

### Changes things for you, safely
Suggested changes appear as cards that list exactly what will change ("Landing date: 29 Jun 2027 → 15 Jul 2027").
Nothing happens until you click **Do it for me**; every applied card offers **↶ Undo**, which puts the app back
exactly as it was.

### Keeps you oriented
The **Your plan** strip at the top of the panel shows your site, date, landing accuracy and caution level, seven
dots for the steps (tap one to jump to it), how many are done, and a **Continue** button.

---

## How it works

### Where the numbers come from
Penumbra does all its science on the server (terrain horizons, Sun/Earth geometry, simulated landings). Armstrong
follows the same rule and never computes science in the browser. Its numbers come from:

- **the mission card's results**, which the panel reads from the same requests the views make (cache hits, no extra
  work); or
- **the same API routes the app uses**: `POST /api/landing-risk`, `POST /api/visibility`, `POST /api/compare` and
  `POST /api/endurance` (for example, "what if I land on 15 July?" calls `/api/visibility` for both dates).

Answers state the settings they used (site, date, landing zone, caution level) so it's clear what was computed.

### Built-in guide: the pieces
All in `src/features/assistant/guide/`, plain TypeScript, no AI and no network beyond Penumbra's own server.

| File | Role |
|---|---|
| `engine.ts` | Turns a request into an answer: greeting, walkthrough steps, explanations, decision helpers, what-ifs, typed commands. Each answer can carry change cards, follow-up buttons, a "Show me where" target and walkthrough progress. |
| `plain.ts` | Plain-language explanations of each choice (site, date, accuracy, caution level, aim, vehicle, mission length), the **In short** verdict and **Tell me more** texts. |
| `nlu.ts` | Understands typed text: finds sites (typo-tolerant), dates ("15 July", "July 15th", "2027-07-15"), distances, caution levels, mission length, sections, vehicles; recognises yes/no/next/more/show me/thanks. |
| `watch.ts` | Notices what changed in the app (site, date, accuracy, robust-aim result, skyline…) and builds the plain-language tip plus the next step. |
| `whatsthis.ts` | "What's this?": maps what you tap to an explanation. |
| `spotlight.ts` | "Show me where": switches to the right section, opens collapsed panels, scrolls the control into view and outlines it. |
| `content.ts` | Glossary, how-to answers, screen descriptions, limitations, validation summary, tappable words. |
| `util.ts` | Shared helpers, site names, and the guide's name (`GUIDE_NAME = "Armstrong"`). |

The panel itself is `src/features/assistant/AssistantPanel.tsx`. Changes are applied by `applyProposal.ts`
through the same functions the app's own controls use, after saving an undo snapshot. The welcome bubble is
`GuideWelcome.tsx`; the avatar is `GuideAvatar.tsx` (`src/assets/armstrong.png`).

### AI assistant (optional): the pieces
When `ANTHROPIC_API_KEY` is set, the panel sends each question to `POST /api/assistant` (server-sent events):

- **What it sends:** the conversation, a snapshot of the screen (`<app_state>`: section, site, settings and the
  numbers already computed) and a machine-readable copy of the settings.
- **What Claude knows:** a system prompt (`backend/app/assistant/guide.py`) describing every screen and control,
  the science concepts, the limitations and the rules: never state a mission number that didn't come from the
  screen snapshot or a tool, never claim a change was made.
- **Tools** (`backend/app/assistant/tools.py`), run by the Anthropic SDK's tool runner (up to 8 model turns per
  question). Each calls the same analysis code as the API, defaults to your current settings, and accepts
  overrides for "what if" questions:

  | Tool | Purpose |
  |---|---|
  | `get_mission_outlook` | Sunlight, Earth and DSN contact, longest darkness, battery and daily sunlight after landing |
  | `get_landing_risk` | Sunlight for a perfect landing and across 2,000 simulated landings (P50–P05) |
  | `find_robust_aim` | Brightest point vs the safer robust aim |
  | `compare_sites` | Ranks the sites for one mission (same method as the Compare page) |
  | `find_best_landing_dates` | Best landing days of 2027, with battery endurance |
  | `get_site_info` | Facts about the sites |
  | `propose_app_changes` | Prepares a change card; nothing changes until the person clicks Apply |

- **Model and settings:** `claude-opus-5-5` at `medium` effort by default, streaming, prompt caching on the system
  prompt, and the API's server-side fallback if a request is declined.
- The tools' numbers were checked against the API routes on the real NASA/JPL data: they match exactly.

---

## Setup

The built-in guide needs nothing: run Penumbra as usual (`python tasks.py dev`) and click **Ask**.

To turn on the AI assistant, put a Claude API key in `.env` (git-ignored) and restart the server:

```
ANTHROPIC_API_KEY=sk-ant-...
```

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | Turns on the AI assistant |
| `PENUMBRA_ASSISTANT_MODEL` | `claude-opus-5-5` | Claude model |
| `PENUMBRA_ASSISTANT_EFFORT` | `medium` | `low`, `medium` or `high` |
| `PENUMBRA_ASSISTANT` | `1` | `0` switches the AI assistant off |
| `PENUMBRA_OFFLINE` | `0` | `1` also switches it off (the built-in guide keeps working) |

`GET /api/assistant/status` reports whether the AI assistant is available and why not.

---

## Tests

```bash
npx vitest run tests/frontend          # includes the guide, panel, change cards, undo and explanations
python -m pytest tests/api/test_assistant.py tests/api/test_assistant_tools.py   # AI endpoint and tools
```

The frontend tests cover typed-text understanding, the plain-language explanations, the walkthrough and its
auto-advance, the decision helpers, what-ifs, commands, tips, "What's this?", tappable words, Undo and a full render
of the panel. The backend tests cover prompt assembly, availability, the event stream and every tool, with the
science calls replaced so they run without data or an API key.

---

## Limits

- The built-in guide understands common phrasings, not everything; when it doesn't, it says so and offers options.
- Read aloud depends on the voices installed in the browser or operating system.
- Armstrong explains Penumbra's results, so it inherits their limits: terrain resolution, a landing-error model
  chosen by the user, geometric (not scheduled) DSN contact and a simplified battery estimate. See *Limitations* in
  [README.md](README.md).
- The AI assistant needs internet access and costs money per question; the built-in guide is free and offline.
