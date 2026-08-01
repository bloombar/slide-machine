# Cost model

The reproducible workings behind [`docs/BILLING_COST_MODEL.md`](../docs/BILLING_COST_MODEL.md)
and the per-tier caps in [`config/plans.json`](../config/plans.json).

The doc explains the pricing system; this is the calculator that produced it.
Change an input, re-run, and every downstream number — per-lecture cost,
per-tier worst case, price floors, break-even subscriber counts — updates.

| File                                                   | What it is                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pricing.json`](pricing.json)                         | Vendor unit prices, keyed by model and voice family. A working copy of [`config/service-prices.json`](../config/service-prices.json) so you can experiment without touching what the server bills against; the notebook flags any drift between the two. |
| [`assumptions.json`](assumptions.json)                 | How much of each service a lecture and its audience consume. Fields marked `weak` in the file are educated guesses a semester of pilot data should replace.                                                                                              |
| [`billing-cost-model.ipynb`](billing-cost-model.ipynb) | The computation, top to bottom.                                                                                                                                                                                                                          |

Caps are read from `../config/plans.json`, so the notebook always evaluates what
is actually shipped rather than a copy that can rot.

## Running it

```bash
jupyter notebook cost-model/billing-cost-model.ipynb   # then Run All
```

Standard library only — no pandas, no numpy. Any Python 3 kernel will do.

## Questions it answers

- What does one lecture cost, split into live capture, post-lecture work, and
  audience-driven work?
- Which services actually matter? (Two lines are two-thirds of everything.)
- What does each tier cost if a subscriber consumes every cap, and what is the
  lowest price that covers it?
- How many subscribers of each tier cover the fixed monthly costs?
- What happens if lectures are 50 or 110 minutes rather than 75?
- Where do the shipped caps sit relative to what the assumptions imply?

## Changing a cap

Edit `../config/plans.json`, re-run sections 5 and 6, and read the effect on
worst-case cost and break-even before shipping it. When a change should stick,
update `docs/BILLING_COST_MODEL.md` too — the doc and this notebook are meant to
agree.
