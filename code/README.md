# Code

Nine files from the app, copied verbatim. No framework, no runtime dependencies — this is
what the phone actually executes.

| File | Lines | What it demonstrates |
|---|---:|---|
| [`storage.js`](storage.js) | 173 | **The interesting one.** Append-structured writes with a compacting pass, quota treated as an event rather than an error, and a shedding order that drops recomputable data before it ever touches a source record. Built on the assumption that the platform *will* reclaim storage, not that it might. |
| [`postflop.js`](postflop.js) | 819 | The spot engine: board texture, equity, and drill generation built from the user's own logged hands rather than a generic curriculum. |
| [`poker.js`](poker.js) | 465 | The hand model and the shorthand parser — deliberately forgiving about order and spacing, because an unlogged hand is worth nothing and capture friction is the binding constraint. |
| [`handeval.js`](handeval.js) | 165 | Seven-card evaluator. Small, allocation-light, and exercised by an exhaustive test rather than trusted. |
| [`dealer.js`](dealer.js) | 131 | Deck and sampling primitives for the drills. |
| [`sw.js`](sw.js) | 46 | Service worker — the offline shell, and the reason the app opens at a table with no signal. |
| [`test/test_storage.js`](test/test_storage.js) | 154 | Drives the storage layer against a **fake backend that can be told to evict at any point**, which is how the reclamation paths above are actually exercised rather than assumed. |
| [`test/test_handeval.js`](test/test_handeval.js) | 82 | Evaluator correctness. |
| [`test/test_ui_smoke.js`](test/test_ui_smoke.js) | 582 | Headless UI smoke pass over the whole shell. |

| [`index.html`](index.html) | 2445 | **The entire app shell** — four tabs, no framework, no build step. Worth reading as an argument that a product this size does not need one. |
| [`study.js`](study.js) | 1841 | The drill and review surface, generated from the user's own logged hands. |
| [`horse.html`](horse.html) | 185 | The mixed-game mode, kept separate so the main shell stays one concern. |
| [`test/test_app.js`](test/test_app.js) | 1135 | The end-to-end suite, including the de-served checks — the ones that assert the app still works with no server, no network and no host present at all. |

_Read `storage.js` with `test/test_storage.js` beside it — the test is the argument._
