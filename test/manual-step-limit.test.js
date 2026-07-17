const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  const listeners = new Map();
  return {
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    value: '',
    max: '',
    textContent: '',
    dataset: {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.({ preventDefault() {}, ...event });
    },
    focus() {},
    select() {}
  };
}

function createAppHarness() {
  const elements = {
    stepDisplay: createElement(),
    stepInput: createElement(),
    stepNumber: createElement(),
    stepHint: createElement(),
    stepSlider: createElement(),
    sliderMinLabel: createElement(),
    sliderMidLabel: createElement(),
    sliderMaxLabel: createElement(),
    stepRangeHint: createElement()
  };
  const storage = new Map();
  const context = vm.createContext({
    console,
    confirm: () => true,
    document: {
      addEventListener() {},
      getElementById(id) { return elements[id] || null; },
      querySelectorAll() { return []; }
    },
    fetch: async () => { throw new Error('fetch is not available in this test'); },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    setTimeout,
    clearTimeout
  });
  context.window = context;

  const appPath = path.join(__dirname, '..', 'static', 'js', 'app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: appPath });
  vm.runInContext('setupStepInput()', context);

  return {
    elements,
    commitManualStep(value) {
      elements.stepInput.value = String(value);
      elements.stepInput.dispatch('keydown', { key: 'Enter' });
    },
    getCurrentStep() {
      return vm.runInContext('currentStep', context);
    },
    setStep(value) {
      vm.runInContext(`setStep(${JSON.stringify(value)})`, context);
    }
  };
}

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
