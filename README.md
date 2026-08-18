# TableLog

An offline-first poker hand logger and drill trainer. No server, no account, no network
call — the whole product runs in the browser and keeps its data on the device.

_Public overview of a private project (an iOS App Store build). Architecture only._

## The constraint that shaped it

A hand gets logged at the table, on a phone, in the ten seconds before the next deal. That
single requirement rules out most of the usual architecture:

- **No sign-in, no sync, no spinner.** Anything that can be slow at the table gets removed
  rather than optimised.
- **No server at all.** Not a cost decision — a latency and privacy one. There is no
  backend to be down, and no copy of anyone's results anywhere but their own phone.
- **Capture in a shorthand**, not a form. Typing a hand as a short string beats tapping
  through card pickers, and the parser is forgiving about order and spacing.

## Surviving the browser's storage reclamation

The hard engineering problem in a no-server app is that the platform can delete your data.
Mobile Safari evicts site storage under pressure, and a poker log that loses three months
of hands is worse than useless — it silently corrupts the sample you are trying to reason
about.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Healthy
  Healthy --> Compacting: append log crosses its threshold
  Compacting --> Healthy: log folded into a single snapshot
  Healthy --> Pressured: quota headroom drops
  Pressured --> Shedding: still short after compaction
  Shedding --> Healthy: derived data dropped (recomputable)
  Pressured --> Compacting: compact early, before the platform decides for us
  Healthy --> Evicted: <b>platform reclaims storage anyway</b>
  Evicted --> Restored: user re-imports their exported file
  Restored --> Healthy
  note right of Shedding
    source hands are never shed —
    only what can be recomputed
  end note
  note right of Evicted
    the case the design assumes
    will happen, not the one it
    hopes to avoid
  end note
```

The storage layer is built for that:

- Writes are **append-structured** with a compacting pass, so a partial write can never
  leave a half-parsed record as the only copy.
- **Quota is treated as an event, not an error** — the app measures headroom, compacts
  early, and degrades by shedding derived data (recomputable) before ever touching source
  hands.
- **Export is a first-class path**, not a settings-screen afterthought: the data leaves as
  a plain file the user owns, and re-imports losslessly.
- Every schema change ships with a **forward migration that is tested against fixtures of
  the previous version**, because a user who upgrades after three months offline must not
  lose the interval.

```mermaid
flowchart LR
  UI["index.html<br/><small>four tabs, one shell</small>"]:::ui
  P["poker.js<br/><small>hand model, shorthand parse</small>"]:::core
  H["handeval.js<br/><small>7-card evaluator</small>"]:::core
  D["dealer.js<br/><small>deck, sampling</small>"]:::core
  PF["postflop.js<br/><small>spot logic, equity, drills</small>"]:::core
  ST["storage.js<br/><small>append + compact + shed</small>"]:::store
  SW["sw.js<br/><small>service worker, offline shell</small>"]:::sw
  F[("device storage")]:::data
  T["tests<br/><small>fake backend that evicts on command</small>"]:::test

  UI --> P & PF
  P --> H
  PF --> H & D
  UI --> ST --> F
  SW -.->|"caches the shell"| UI
  T -.->|"drives"| ST
  T -.->|"drives"| H

  classDef ui fill:#1f4a1f,stroke:#0ca30c,color:#e3f7e3
  classDef core fill:#1f3a5c,stroke:#3987e5,color:#e8f0fb
  classDef store fill:#5c4a1f,stroke:#fab219,color:#fdf3d9
  classDef sw fill:#123f46,stroke:#2ba8b8,color:#dff5f8
  classDef data fill:#2e2e2c,stroke:#8a897f,color:#c3c2b7
  classDef test fill:#3b2a5c,stroke:#9d7be8,color:#f0eafd
```

## The rest of the design

- **Four tabs, fixed.** Log, review, drill, stats. A feature that doesn't fit one of them
  doesn't ship; the tab bar is a contract with the user, not a navigation widget.
- **Drills are generated from the user's own logged hands**, so practice concentrates on
  the spots that actually occur in their game rather than on a generic curriculum.
- **Review is variance-honest.** The statistics refuse to present short-run results as
  skill: a sample too small to distinguish from noise is labelled as such, not rendered as
  a trend line. This is the single most opinionated thing in the product.

## The code

Nine files in [`code/`](code/), copied verbatim — the storage layer, the hand evaluator,
the postflop engine and the tests that drive eviction on demand. See
[`code/README.md`](code/README.md).

## Stack

Vanilla TypeScript and CSS, no framework, no dependencies at runtime. Installable PWA,
wrapped for the App Store. Test suite runs against a headless browser with a fake storage
backend that can be told to evict at any point, which is how the reclamation paths above
are actually exercised.

_Last updated August 2026._
