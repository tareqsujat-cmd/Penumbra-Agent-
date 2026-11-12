# Penumbra Agent: Armstrong, the assistant for Penumbra

<img src="src/assets/armstrong.png" alt="Armstrong, an astronaut riding a rocket" width="96" align="right">

This repository is **Penumbra**, a lunar landing-planning tool for the Moon's south pole (NASA Space Apps 2026,
Challenge 4; original project: [SammamMahdi/Penumbra](https://github.com/SammamMahdi/Penumbra)), with an assistant
added: **Armstrong**.

Armstrong lives behind the **Ask** button in Penumbra's header. It helps people who have never planned a lunar
landing (students, members of the public, judges) as well as mission planners to:

1. **learn the app**: what each screen and control does, and where things are;
2. **make choices**: site, landing date, landing accuracy, how careful to be, where to aim, vehicle;
3. **understand the results**: what the numbers mean for their mission, in plain words.

When Armstrong talks about *your mission*, its numbers come only from Penumbra's own calculations, never invented.
General space questions it doesn't handle itself ("What is the James Webb Space Telescope looking for?") can go to
an optional **space assistant**, a free hosted AI model that answers from its general knowledge. And Armstrong
never changes anything on its own: it suggests a change, you click **Do it for me**, and you can **Undo** it.

| Document | What it covers |
|---|---|
| **README.md** (this file) | Armstrong: what it can do, how it works, how to run it |
| [PENUMBRA.md](PENUMBRA.md) | The Penumbra app itself: features, science, validation, limitations |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the app is built (FastAPI backend, React frontend, caching) |
| [DATA_DOWNLOAD_MANUAL.md](DATA_DOWNLOAD_MANUAL.md) | Downloading and checking the NASA/JPL data |

---

## How Armstrong answers

| | **Built-in guide** (default) | **Space assistant** (free LLM chat) | **AI assistant** (optional) |
|---|---|---|---|
| What it is | A scripted guide written for non-specialists: no AI involved | An open-source model (default `openai/gpt-oss-120b` on Groq) answering space and app questions | Claude (Anthropic's model), with tools that run Penumbra's analyses |
| Cost | Free | Free tier (Groq; rate-limited) or any OpenAI-compatible provider | Pay-as-you-go Claude API usage |
| Internet | Not needed: works fully offline | Needed | Needed |
| Answers | Buttons, plus common typed questions and requests | Typed questions the built-in guide doesn't recognise | Any question |
| Turns on | Always | When the server has `LLM_API_KEY` set | When the server has `ANTHROPIC_API_KEY` set (the panel then switches to it) |

Without a Claude key, the panel uses the built-in guide, and hands only the typed questions it doesn't recognise
(for example "What is the James Webb Space Telescope looking for?") to the space assistant. Its replies appear in
the same conversation under a small *Space assistant* label. The guide and the Claude assistant share the same
change cards (**Do it for me** / **Apply**).

---

## Try it

You need Python 3.12, Node.js 20+ and about 4 GB of disk space for the NASA/JPL data.

```bash
# 1. Python environment
python -m venv .venv && .venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
# 2. Frontend dependencies
npm ci
# 3. Data (not stored in the repository; about 3.3 GB, see DATA_DOWNLOAD_MANUAL.md)
python tasks.py data                                    # download and verify the raw NASA/JPL files into data/raw/
python tasks.py precompute                              # terrain horizon grids for the 5 sites (a few minutes to ~30 on a laptop)
# 4. Check and run
python tasks.py doctor
python tasks.py dev                                     # open http://127.0.0.1:4173 and click Ask
```

Armstrong's built-in guide works straight away: no key, no account, no internet needed once the data is
downloaded. To add the free space assistant (a Groq key) or the optional Claude assistant, see [Setup](#setup).

**If `tasks.py data` reports a checksum mismatch for `earth_latest_high_prec.bpc`:** NASA's NAIF team republishes
this Earth-orientation file regularly, so the checksum recorded in the project goes out of date. The app needs the
file; download the current version from NAIF and run `python tasks.py doctor` again:

```bash
curl -L -o data/raw/spice/earth_latest_high_prec.bpc \
  https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_latest_high_prec.bpc
```

A newer version only refines Earth's orientation; its effect on Penumbra's results is negligible.

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

The exception is the **space assistant**: it doesn't see your mission's numbers and answers general space questions
from the AI model's own knowledge, so its replies carry a *Space assistant* label (see
[Space assistant](#space-assistant-free-llm-chat)).

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

`GET /api/assistant/status` reports whether the AI assistant is available and why not, and whether the space
assistant is set up (never any key).

### Space assistant (free LLM chat)

The space assistant calls any provider with an OpenAI-compatible API from the server (`POST /api/chat`, code in
`backend/app/assistant/llm_chat.py`), so the key never reaches the browser. Set three lines in `.env` and restart:

```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...            # from https://console.groq.com/keys (free tier, no credit card)
LLM_MODEL=openai/gpt-oss-120b
```

Switching provider is a matter of changing those lines: `.env.example` lists Gemini, OpenRouter (models ending in
`:free`) and Ollama (local) as alternatives. Each question sends a system prompt (who the assistant is, Penumbra's
features, "say so if unsure", "steer off-topic questions back to space") plus the last 10 messages, with replies
capped at 500 tokens and `temperature` 0.7. Errors are shown in the chat as plain messages: invalid key (401), rate
limit, so wait a minute (429, not retried automatically), model not found (404), or a generic error.

### Terminal chatbot

`scripts/space_chat_cli.py` is the same chat in the terminal, a quick way to check a key and model:

```bash
pip install openai python-dotenv     # already in the project environment
python scripts/space_chat_cli.py     # reads LLM_BASE_URL, LLM_API_KEY, LLM_MODEL from .env; type exit to leave
```

---

## Tests

```bash
npx vitest run tests/frontend          # includes the guide, panel, change cards, undo and explanations
python -m pytest tests/api/test_assistant.py tests/api/test_assistant_tools.py   # AI endpoint and tools
python -m pytest tests/api/test_chat.py                                          # space assistant chat
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
  [PENUMBRA.md](PENUMBRA.md).
- The AI assistant needs internet access and costs money per question; the built-in guide is free and offline.
- The space assistant answers from the model's general knowledge, not from Penumbra's calculations, and models can
  get facts wrong. Free tiers are rate-limited: if many questions arrive quickly, it asks you to wait a minute.
