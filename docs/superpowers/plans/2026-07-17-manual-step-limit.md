# Manual Step Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow manual step entry up to 98800 while keeping sliders and quick controls limited to the dynamic baseline plus 1000.

**Architecture:** Keep `setStep` as the single UI synchronization function, but accept an optional maximum for the current interaction. Its default remains the dynamic maximum; only the manual input commit passes the global maximum.

**Tech Stack:** Plain browser JavaScript, Node.js built-in `node:test`, npm scripts

---

### Task 1: Lock Down Manual And Dynamic Limits

**Files:**
- Create: `test/manual-step-limit.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the failing behavior test**

Create a VM-based browser harness that evaluates `static/js/app.js`, supplies the DOM elements used by `setStep`, and invokes the registered manual input handler. Assert that manual `5000` stays `5000`, ordinary `setStep(5000)` remains `1001`, and manual `99999` clamps to `98800`.

```js
test('manual input uses the global maximum while regular controls use the dynamic maximum', () => {
  const app = createAppHarness();

  app.commitManualStep('5000');
  assert.equal(app.getCurrentStep(), 5000);

  app.setStep(5000);
  assert.equal(app.getCurrentStep(), 1001);

  app.commitManualStep('99999');
  assert.equal(app.getCurrentStep(), 98800);
  assert.equal(app.elements.stepSlider.max, '1001');
});
```

- [ ] **Step 2: Add and run the test command**

Add `"test": "node --test"` to `package.json`, then run:

```powershell
npm test
```

Expected: FAIL because manual commit currently calls `setStep(input.value)` and returns `1001` instead of `5000`.

### Task 2: Give Manual Input An Independent Maximum

**Files:**
- Modify: `static/js/app.js:181`
- Modify: `static/js/app.js:478`
- Test: `test/manual-step-limit.test.js`

- [ ] **Step 1: Let `setStep` accept a per-call maximum**

```js
function setStep(value, options = {}) {
  const { persist = true, max = getDynamicStepMax() } = options;
  updateSliderRange();
  currentStep = clampStep(value, max);
  // Existing UI synchronization remains unchanged.
}
```

- [ ] **Step 2: Use the global maximum only for manual commits**

```js
function commit() {
  setStep(input.value, { max: STEP_LIMITS.max });
  clearManualStepInput();
}
```

- [ ] **Step 3: Run the focused test**

```powershell
npm test
```

Expected: PASS; manual values use `1-98800`, while default calls and the slider still use the dynamic maximum.

- [ ] **Step 4: Run syntax and build checks**

```powershell
node --check static/js/app.js
npm run build
```

Expected: JavaScript syntax check exits successfully and Capacitor sync completes without error.

- [ ] **Step 5: Inspect the final diff**

```powershell
git diff --check
git diff -- static/js/app.js package.json test/manual-step-limit.test.js
```

Expected: no whitespace errors and no changes outside the manual-input limit behavior and its test harness.
