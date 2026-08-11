const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  const listeners = new Map();
  return {
    classList: {
      classes: new Set(),
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      toggle(cls) { if (this.classes.has(cls)) this.classes.delete(cls); else this.classes.add(cls); },
      has(cls) { return this.classes.has(cls); }
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
    stepConfirm: createElement(),
    stepInputRow: createElement(),
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
    run(code) { return vm.runInContext(code, context); },
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

test('确定按钮确认手动输入', () => {
  const app = createAppHarness();
  app.elements.stepInput.value = '5000';
  app.elements.stepConfirm.dispatch('click', { preventDefault() {}, stopPropagation() {} });
  assert.equal(app.getCurrentStep(), 5000);
});

test('随机按钮在基准到基准+1000内生成', () => {
  const app = createAppHarness();
  app.run('stepHistory = [{ steps: 5000, success: true }]; lastSuccessStep = 5000;');
  for (let i = 0; i < 20; i += 1) {
    app.run('applyRandomStep()');
    const step = app.getCurrentStep();
    assert.ok(step >= 5000 && step <= 6000, 'unexpected ' + step);
  }
});

test('点击确定后不会立刻重新进入输入模式', () => {
  const app = createAppHarness();
  app.elements.stepInput.value = '5000';
  app.elements.stepConfirm.dispatch('click', { preventDefault() {}, stopPropagation() {} });
  assert.equal(app.getCurrentStep(), 5000);
  app.elements.stepDisplay.dispatch('click', { target: app.elements.stepDisplay });
  assert.equal(app.elements.stepInputRow.classList.has('hidden'), true);
  assert.equal(app.elements.stepNumber.classList.has('hidden'), false);
});
