
# HFC (High-Frequency Checks) Engine Test Plan

Context: Engine runs on device, checks cross-question logic. Action = reask_and_flag or reask_once

| Test ID | Scenario | Input | Expected Action | Type |
|---------|----------|-------|-----------------|------|
| HFC-01 | Age < 15 AND Education = College | Age=12, Edu=College | reask_and_flag, msg shown | Negative - Invalid combo |
| HFC-02 | Age valid | Age=20, Edu=College | No flag, proceed | Positive |
| HFC-03 | Sleep Yes AND Hours <6 | Sleep Well=Yes, Hours=4 | reask_and_flag - "That's unusually high..." Wait logic bug? Actually if sleep well Yes and hours <6 contradictory | Negative |
| HFC-04 | Sleep No AND Hours 5 | Sleep Well=No, Hours=5 | No flag or soft flag only | Positive |
| HFC-05 | Boundary - Hours = 0 | Hours=0 | Allow? But flag if Sleep Yes | Edge |
| HFC-06 | Boundary - Hours = 24 | Hours=24 | Allow but flag as unusual | Edge |
| HFC-07 | Infinite Loop Prevention | User enters Age=12, Edu=College, confirms same value twice after reask | After 1 reask, allow with flagged=true, don't loop forever | Edge - Critical |
| HFC-08 | Multiple HFC fail at once | Age=10, Edu=College AND Sleep=Yes Hours=2 | Show both flags, handle queue | Edge |
| HFC-09 | Empty / Null | Age empty | Validation before HFC | Negative |
| HFC-10 | Typo in schema - questioID | Schema has typo questioID vs questionId | Engine should not crash, should log error | Edge - Schema robustness |

**How to prevent infinite loop:**
- Counter: reask_count <=1. If >1, auto-accept with `isFlagged=true` and sync for manual review.
- UI: Show "You confirmed: Age 12 College - this will be flagged for review. Continue?" with Yes/No.

**Automation:** Unit test HFC engine isolated: Pass JSON logic array + answers dict => expect action.
