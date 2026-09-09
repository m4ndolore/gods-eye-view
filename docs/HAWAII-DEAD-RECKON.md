# The Hawaii dead-reckon problem set

This fork of God's Eye View is pointed at one question, on one island.

> When the symbol on the map is still moving, is that an **observation**, or is
> it this application propagating a position nobody has heard from in a while?

Everywhere with a dense receiver network, that question is easy to ignore.
On Oahu it is unavoidable, and that is why the AOR is here.

- **ADS-B reception is island-anchored.** A contact that leaves line of sight —
  the Kaiwi and Kauai channels, anything outbound over open Pacific — has no
  position available except a propagated one.
- **AIS is line-of-sight from shore too.** The deep-water approaches to Pearl
  Harbor and Honolulu Harbor run out of terrestrial range, and a vessel that
  stops reporting looks exactly like one that is merely out of earshot.
- **The Koolau and Waianae ranges mask low-altitude traffic** from the very
  sensors that would otherwise hold it. Coverage here is a terrain problem
  before it is a sensor problem.
- **Reachback is itself a track.** Decision continuity on Oahu rides a small
  number of submarine cable landings.

Scope: these are **observation** workflows over public feeds — awareness,
fusion, training and audit, the same posture as the
[Dead Reckon](https://github.com/m4ndolore/dead-reckon) project this AOR is
drawn from. Nothing here targets, cues a weapon, or asserts an affiliation.

---

## What was added

| Piece | Where | What it is |
|---|---|---|
| Coast-state vocabulary | `src/workflows/coastState.js` | Ages one fix into `live` / `coasting` / `stale` / `lost`, per source. The honesty contract. |
| The problem set | `src/workflows/hawaiiDeadReckon.js` | The Oahu AOR and five workflows, as validated data. |
| The runner | `src/workflows/workflowRunner.js` | Turns a workflow's steps into calls on the app's existing facades. |
| Oahu location | `src/locations.js` (`hawaii`) | A location pill, five AOR framings, and voice fly-to, for free. |
| Launcher tile | `src/firstRunExperience.js`, `index.html` | `DEAD RECKON · OAHU`, first on the first-run menu. |
| Capture recipe | `src/scenes/recipes.js` (`dead-reckon-oahu`) | Island → channel → island, the shape of the problem. |
| Validation | `scripts/validate-hawaii-workflows.mjs` | `npm run hawaii:validate`. |
| CI | `.github/workflows/` | Tests, catalog validation, and a two-target deploy. |

## Coast states

A rendered position is only an observation while its fix is inside the
source's own reporting cadence. After that it is dead reckoning, and the
interface has to say so.

| State | Means | What you can do with it |
|---|---|---|
| `live` | Newest fix is inside cadence. | Treat it as a position. |
| `coasting` | Cadence missed; position is propagated. | Act on it, knowing it is an estimate. |
| `stale` | Propagated long enough that cross-track error dominates. | It is a search area, not a position. |
| `lost` | Too old to draw as a track. | Hand off, or drop it. |

Thresholds are **per source**, because the sources are not comparable — a
terrestrial ADS-B receiver updates in seconds, a Class-B AIS transponder in
minutes, an SGP4 propagation only as well as its element set is fresh. Two and
a half minutes of silence is nothing for one and an eternity for the other, and
`coastStateFor()` gives both the honest answer from the same timestamp.

Two rules are pinned by tests because they are the ones that quietly rot:

- **An unusable or future-dated fix is `lost`, never `live`.** A clock-skewed
  source must not be able to buy itself a permanent LIVE badge.
- **A multi-source picture is labelled by its worst contributor, and no
  contributor at all is `lost`.** Defaulting the empty case to `live` is exactly
  the lie the module exists to prevent.

## The workflows

Every workflow walks three phases, in order: **hold** (establish the truth you
will propagate) → **gap** (the source stops; everything from here is dead
reckoned) → **reacquire** (a second source, or the first one returning, closes
the estimate). A run that never leaves `hold` has not exercised anything, and
the validator rejects it.

| id | Difficulty | The gap it works |
|---|---|---|
| `dr-channel-crossing` | introductory | Inter-island traffic leaves receiver line of sight mid-channel. |
| `dr-pearl-approaches` | intermediate | AIS silence on the deep-water approaches to Pearl Harbor. |
| `dr-terrain-mask` | intermediate | Low-altitude tracks masked by the Koolau spine. |
| `dr-overhead-cue` | advanced | Closing a coasting track with a predicted overhead pass. |
| `dr-reachback` | advanced | The operating picture as the coasting track, when reachback degrades. |

Run one from code:

```js
import { runHawaiiWorkflow } from './src/workflows/workflowRunner.js';

await runHawaiiWorkflow('dr-channel-crossing', {
  setLayerEnabled, setContextMode, flyToLocation,   // the app's own facades
  onStep: ({ phase, step }) => phase === 'start' && console.log(step.text),
});
```

Two runner rules carry the design:

1. **Framing never fails a run.** A camera flight is how the operator is shown
   the problem, not the problem itself. A refused or superseded flight (the
   operator grabbed the camera, Cockpit owns it) leaves the run OK.
2. **A run that stops early says so.** Every step reports; the run continues past
   a failure so the operator gets the whole verdict rather than a half-built
   picture presented as the whole workflow.

`skipHolds: true` reports a workflow's dwells without sitting them out — what
the first-run tile does, because a 45-second wait behind a modal card is a hung
tile, not an observation. The dwell stays the operator's to spend on the map.

## Keeping it honest

```bash
npm run hawaii:validate   # catalog vs. the app's live registries
npm test                  # the whole unit suite, including the workflow tests
```

`validateHawaiiWorkflows()` checks every workflow against the **real**
`LAYER_STATE_REGISTRY`, the **real** `CITY_POIS`, and the `set_layer_visibility`
voice enum — the narrowest gate, since a layer outside it cannot be reached by
the hands-free path these workflows are meant to be run from. It runs in CI on
every change to the catalog *or to anything the catalog points at*, plus weekly,
because the weekly run is what catches rot that landed via a change nobody
thought touched Hawaii.

## What is not wired yet

Stated plainly, so nobody discovers it from a demo:

- **Coast state is not on the readouts.** `coastState.js` is the validated
  vocabulary and the catalog is typed against it, but the live layers still
  render their own freshness treatment. Wiring `coastStateFor()` into the track
  readouts and the HUD is the next change, and it touches the render path.
- **There is no voice verb for a workflow.** The Oahu AOR is reachable by voice
  today (it is an ordinary `CITY_POIS` location, so `fly_to_location` and the
  location pills both work), and every layer a workflow drives is already in the
  `set_layer_visibility` enum — a test enforces that. What does not exist is a
  `run_workflow` tool that walks the steps hands-free.
- **The workflows have no in-app browser.** The first-run tile launches
  `dr-channel-crossing`; the other four are reachable from code and from
  `npm run hawaii:validate`, not from a panel.

---

## Hosting

Two targets, chosen per run in **Actions → Deploy**: `pages`, `homelab`, or
`both`. The difference is not cosmetic.

### 1. Keys

`GOOGLE_MAPS_API_KEY` is **required at runtime**: `src/main.js` throws
`GOOGLE_MAPS_API_KEY not found` and the app never initializes without it. A
keyless build still compiles — which is why CI builds keyless on every PR — but
it publishes a page that can only display that error. So the Pages job **refuses
to deploy without the key**, rather than shipping a URL that cannot start.

The key is compiled **into the browser bundle** by design: it is used
client-side and is visible in devtools wherever the bundle is served (see
[SECURITY.md](../SECURITY.md)).

- On the **homelab**, that bundle never leaves your network.
- On **Pages**, it is world-readable. Opting in is an explicit checkbox on the
  run, and the key must be HTTP-referrer and API restricted in Google Cloud,
  with a billing budget set, *before* you tick it.

That is the real cost of a public deploy: a shareable link means a publicly
readable Maps key, restricted or not.

### 2. Server routes

A large part of this app's live data rides Vite plugin middleware: the `/api/*`
proxies for CCTV, radio, regional briefs, Places, terrain heights and friends.

| | `/api/*` routes | Photoreal basemap | Good for |
|---|---|---|---|
| **Pages** (static) | none | required — the app will not start without it | Sharing the globe and the Oahu framing |
| **Mac mini** (`vite preview`) | the subset that registers a preview hook | yes, key stays local | Running the problem set |
| **Mac mini** (`npm run dev`) | all of them | yes, key stays local | Development and the fullest picture |

So: **Pages is a demo. The Mac mini is where the problem set actually runs end
to end.** The layers a static deploy cannot serve degrade to their
unavailable/fallback states — which the app labels honestly, but which is a real
reduction in capability, and worth knowing before you send someone a link.

### Mac mini (M4) setup

1. **Install a self-hosted runner** on the mini (repo → Settings → Actions →
   Runners) and give it the label **`gev-homelab`** alongside `macOS` and
   `ARM64`. The deploy job requires that label so it cannot land on some other
   self-hosted macOS box.
2. **Install Node 24.14.x on the box.** The homelab job deliberately does *not*
   use `setup-node`: a long-lived machine should build with the runtime you
   installed and tested, not one silently swapped under it.
3. **Put your keys on the box**, in the checkout's `.env` or the runner's own
   environment. They are never workflow inputs and never echoed.
4. **Optionally set repo variables** (Settings → Variables) — `GEV_DEPLOY_ROOT`
   (default `~/gev-deploy`) and `GEV_LAUNCHD_LABEL` (default `com.gev.preview`).

`scripts/homelab-deploy.sh` copies the build into
`$GEV_DEPLOY_ROOT/releases/<timestamp>-<sha>`, swaps `current` onto it with a
single non-dereferencing rename, prunes old releases, and kickstarts the
LaunchAgent if one is loaded. A missing LaunchAgent is a note, not a failure —
serving `current` behind a reverse proxy, or by hand, is a perfectly good setup.

The release-directory dance exists because a running server holds the served
directory open: writing files into it one at a time leaves a window where the
page is half one build and half another, which on this app looks like a working
map with a stale bundle. That is precisely the kind of quiet wrongness this
whole problem set is about.

Check it without touching anything:

```bash
npm run build
./scripts/homelab-deploy.sh --dry-run
```

A minimal LaunchAgent, at `~/Library/LaunchAgents/com.gev.preview.plist` — it
serves the built release; run `npm run dev` instead when you want every `/api/*`
route:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.gev.preview</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/npm</string>
    <string>run</string>
    <string>preview</string>
    <string>--</string>
    <string>--host</string>
    <!-- Bind to the LAN address you actually want to serve on, not 0.0.0.0,
         unless you have decided who can reach this box. -->
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>4173</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/gods-eye-view</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/gev-preview.log</string>
  <key>StandardErrorPath</key><string>/tmp/gev-preview.err</string>
</dict>
</plist>
```

```bash
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.gev.preview.plist
```

Before exposing the mini beyond your own network, read
[SECURITY.md](../SECURITY.md) — particularly the Places rate-limit guard and the
provider-side billing budgets, which are the only hard spend protection.
