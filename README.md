
# QA Engineer Take-Home Assessment - Solution by Sunil Maharana

## Overview & Approach
This repo contains solutions for a robust offline-first CAPI ecosystem:
- Web Survey Builder (Dynamic JSON schema)
- Android Data Collection App (Room + WorkManager + Background Sync)

Target User Constraints: 4GB RAM, 2G, low literacy, low storage, bright sunlight.

Tools Chosen: Playwright (Web + API), Postman Collection, ADB, Charles Proxy, Android Studio Profiler.
Reason: One tool for Web & API reduces maintenance, Playwright has native network interception, auto-wait for dynamic UIs.

---

## Part 1: Hands-On Technical Inspection & Automation

### Scenario A: Offline Sync & Data Collision (API & Mobile)

**Problem:** Ankit & Pooja both create School_1 offline. At 5PM both sync same time. Plus 50k users DDoS.

**Root Cause to Test:**
1. Local ID collision (client-generated IDs)
2. Idempotency failure
3. Last-write-wins overwriting data
4. No rate limiting / queue

**Expected Backend Fix (what QA should validate):**
- Server must ignore `localId` and generate `serverId: UUID`
- API must be idempotent using `clientId + timestamp + deviceId` composite key or `Idempotency-Key` header
- Should implement deduplication based on: GPS + School Name + Village (fuzzy match) + flag for manual review
- Should return 409 Conflict with existing record, not 200 overwrite

**API Automation Script:**
See `/automation/api_tests/sync-survey.api.spec.js` (Playwright API) and `postman_collection.json`

Test Cases Covered:
- Same localId from 2 devices -> both saved with different serverId
- Same payload replay with same Idempotency-Key -> returns same serverId (no duplicate)
- 50 parallel sync requests (DDoS simulation) -> 429 or queued, no 500
- Offline payload with missing fields -> 400

**Android Background Sync Testing Strategy:**
Goal: Test network drop at 99% photo upload.

Steps:
1. Setup: Device with Charles Proxy (Proxy -> Device Wifi -> Manual proxy to Charles IP:8888)
2. Install Charles certificate on device.
3. In App, fill survey offline with photo.
4. Go online, start sync.
5. In Charles: Tools -> Throttle Settings -> 2G preset, or set Breakpoint on POST /sync-survey
6. Let upload go to 99%, then Tools -> No Internet or Breakpoint -> Drop/return 500
7. Verify: 
   - App shows "Sync Failed, will retry"
   - Room DB entry still exists: `isSynced = 0`
   - WorkManager retry scheduled: `adb shell dumpsys jobscheduler | grep <package>`
8. Tools: Charles Proxy / Proxyman for interception, ADB for logcat: `adb logcat | grep WorkManager`

### Scenario B: Dynamic Form Rendering & Regression

**Web Automation:** See `/automation/web_tests/skip-logic.spec.js`

We test: If "Do you have a hobby?" = "Yes", then "What is your hobby?" becomes visible.
This validates `visibilityLogic` from Sample Schema: q_3 -> q_4

**Regression Suite Design for Dynamic JSON Screens:**
You cannot write locators like `#hobbyInput` because UI is generated from JSON. So:

1.  **Schema-Driven Testing:** Parse `surveys[].surveyData.sections[].questions[]` and auto-generate tests. For each question with `visibilityLogic.enabled=true`, generate a test.
2.  **What to Automate:**
    -   JSON Schema Validation (AJV): Validate incoming JSON against expected schema
    -   All visibilityLogic rules (unit level)
    -   ValidationRules (range 0-24, text)
    -   FormChecks (HFC)
    -   Happy path render for all 20 input types
3.  **What to leave for Manual Exploratory:**
    -   Visual layout on small screens
    -   Translation quality (Hindi, Marathi)
    -   User confusion with skip logic
    -   Performance with 100+ question forms

### Scenario C: Offline Sync & State Management (Room + WorkManager)

**Steps to inspect Room DB on Unrooted Device:**

```bash
# 1. Make app debuggable (add android:debuggable="true" in manifest for QA build)
# 2. Run app, save survey offline
# 3. Extract DB
adb shell run-as com.example.datacollection ls /data/data/com.example.datacollection/databases/
adb shell run-as com.example.datacollection cp /data/data/com.example.datacollection/databases/survey_db /sdcard/Download/
adb pull /sdcard/Download/survey_db ./survey_db

# 4. Inspect with DB Browser for SQLite or sqlite3
sqlite3 survey_db "SELECT * FROM surveys WHERE isSynced=0;"
```

**Force WorkManager Immediately:**

```bash
# List workers
adb shell dumpsys jobscheduler | grep -A 10 com.example.datacollection
adb shell dumpsys workmanager # on newer versions

# For testing, devs can add workManagerTestInit. For QA:
adb shell am broadcast -a "androidx.work.diagnostics.REQUEST_DIAGNOSTICS" -p "com.example.datacollection"

# Or force via app code: Use WorkManagerTestInitHelper in debug, or trigger via ADB command to call WorkManager.enqueueUniqueWork
# Simpler: Disable/Enable network to trigger:
adb shell svc wifi disable && adb shell svc data disable
adb shell svc wifi enable
# Or: adb shell cmd jobscheduler run -f com.example.datacollection <JOB_ID>
```

**Simulate 500 Error & Verify Retry:**

1.  Charles Proxy -> Map Local -> For POST /sync-survey return 500
2.  Trigger sync
3.  Verify:
    -   `adb logcat | grep -i "retry"` should show WorkManager scheduling backoff (Exponential)
    -   Room DB still has data: `isSynced=0, retryCount=1`
    -   App does NOT delete local data
    -   After removing Charles mapping, sync succeeds on next retry

---

## Part 2: Complex Scenarios & Edge Cases

### Scenario D: Edge-Case Device Constraints (4GB RAM ANR after 3-4 videos)

**How to Reproduce:**

1.  Don't use emulator high-end. Use real low-end device: e.g., Moto G, or create AVD with 4GB RAM, low internal storage 8GB.
2.  Simulate low storage:
    ```bash
    adb shell dd if=/dev/zero of=/sdcard/fill_storage.tmp bs=1M count=6000 # fill 6GB
    adb shell df -h
    ```
3.  Simulate low RAM:
    ```bash
    # Limit app memory
    adb shell am set-trim-memory <package> RUNNING_CRITICAL
    # Or run heavy background apps
    adb shell cat /proc/meminfo
    ```

**Debugging Steps:**

```bash
# 1. Reproduce and capture ANR
adb shell dumpsys dropbox | grep -A 50 ANR
adb pull /data/anr/traces.txt

# 2. Profile memory leak
# In Android Studio -> Profiler -> Memory -> Record heap dump after each video
# Look for: Video not released, ExoPlayer instances leaking, Bitmap not recycled

# 3. Check logs
adb logcat | grep -E "OutOfMemory|GC|Leak"

# 4. Use
adb shell dumpsys meminfo com.example.datacollection
```

**Root Cause Hypothesis & Proof to Dev:**
- Videos stored in cache + ExoPlayer not releasing -> Memory leak. After 3 videos, heap > 90% of 4GB.
- Proof: Heap dump shows 3 ExoPlayer instances retained, 800MB native memory. Provide profiler screenshot + `meminfo` before/after.
- Fix: Call `player.release()` in `onDestroy()`, use LRU cache with size limit, clear cache when low storage.

### Scenario E: HFC Engine Test Plan

See `/test-plans/hfc-test-plan.md` for full table.

Key principles:
- HFC should be "Soft" -> reask_once, not hard block
- Must prevent infinite loop: If user confirms same invalid value twice, allow with flag
- Test matrix: Age/Education contradiction, Sleep contradiction, Boundary values

---

## Part 3: QA Process & AI Integration

### Process Creation: First 30 Days as First QA

**Week 1: Observe & Document**
- Shadow devs, understand release process, document current flow
- Introduce bug tracking template (Jira: Severity, Steps, Device, Network, DB state)
- Create Staging vs Production separation

**Week 2: Entry/Exit Criteria & Environments**
- Entry: PR needs unit test, build passes, deployed to staging
- Exit: All P0/P1 passed, no open blocker, regression of dynamic schema passed, ANR-free on low-end device
- Setup 3 envs: Dev -> Staging (QA) -> Prod. No direct push to Play Store. Use internal testing track.

**Week 3: Automation Foundation**
- Setup Playwright for web, setup Charles + ADB toolkit for mobile
- Create smoke suite: 15 min suite for every build (login, training complete, offline save, sync)

**Week 4: Culture**
- Weekly bug bash, QA demos, no blame. Integrate QA in standup.
- Metrics: Defect leakage, ANR rate, Sync failure rate

How to not slow team: Automate smoke, make QA async via Slack + staging link, not meetings. Shift-left: Give devs checklist.

### Leveraging AI

- **Current use:** ChatGPT to generate edge cases for HFC, Copilot to write Playwright tests from JSON schema, Gemini to summarize logcat.
- **Example for Scenario B:** Feed Sample Survey Schema.json to AI prompt: "Generate Playwright tests for every visibilityLogic rule". AI auto-creates 100s of tests. Then human reviews for business logic. Saves 70% time.
- Also use AI to generate test data: "Generate 50 school names in Hindi + GPS nearby".

### Automation vs Manual Decision

- **Automate:** Stable, repetitive, data-driven, API, schema validation, visibility logic, sync idempotency.
- **Not Automate:** UX for low literacy, video training experience, bright sunlight readability, exploratory for new features.
- **Tool Choice Reason:** Playwright over Cypress because: API + UI in same tool, better network interception (critical for sync tests), better mobile web. Postman for quick manual API sharing with non-coders.

---

## Part 4: UI/UX & User-Centric QA

### Training Video Hub Evaluation

**Beyond Functional:** Check if user can actually learn.

**5 UX/UI Issues I would flag:**

1.  **Text Heavy - Low Literacy Fail:** 3 paragraphs = wall of text. Rural user will skip. Flag: Use icons, voiceover, or 1-line summary.
2.  **Small Touch Target & Scroll Fatigue:** "Next" at bottom of scrollable page on 5-inch device, user may never find it. Need sticky button, large 48dp+.
3.  **Video Player Not Optimized:** Standard player = tiny controls in sunlight, no subtitles, no offline download indicator. Need large play button, Hindi subtitles, download state.
4.  **No Visual Progress:** No indicator which video is watched, no checkmark. Low literacy needs progress dots/icons.
5.  **Contrast & Sunlight:** Grey text on white fails in bright sunlight. Need high contrast, dark mode, minimum 4.5:1 ratio.
6.  **Bonus:** No handling of low storage for videos - if storage full, video fails silently.

**How to Systematically Test:**

-   Device Lab: Test on 5-inch 720p, 4GB RAM, 100% brightness outdoor
-   Accessibility Scanner: Android Accessibility Scanner for touch target, contrast
-   UX Heuristic: Test with 5 real field users (moderated)
-   Tools: TalkBack, Font size 200%, Lighthouse contrast

**Constructive Communication:**
-   Don't file as "Bug: Text too long". File as "UX Risk: Low literacy users may drop off - Recommendation: Replace 3 para with 1-line + icon. Evidence: Field feedback from 2 users". Attach screenshot with annotation.
-   Use severity: UX-High, not functional blocker. Tag design + PM.

---

## Submission Structure
- /automation/api_tests/sync-survey.api.spec.js
- /automation/api_tests/postman_collection.json
- /automation/web_tests/skip-logic.spec.js
- /test-plans/hfc-test-plan.md
- /test-plans/regression-matrix.csv

How to Run:
```
npm install -D @playwright/test
npx playwright test
```

