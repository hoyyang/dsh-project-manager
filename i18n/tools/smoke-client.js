#!/usr/bin/env node
/**
 * Дымовой тест клиентского бандла: фабрика исполняется, apply/inject экспортируются.
 *
 *   node smoke-client.js <path/to/lib/client.js>
 */
'use strict';

const fs = require('node:fs');

const file = process.argv[2] || 'lib/client.js';
const source = fs.readFileSync(file, 'utf8');

let captured;
const functionStub = () => {};
const anyProxy = new Proxy(functionStub, {
  get(target, key) {
    if (key === Symbol.toPrimitive) return () => '';
    if (key === 'toString') return () => '';
    return anyProxy;
  },
  apply() { return anyProxy; },
  construct() { return anyProxy; },
});

global.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  addEventListener: () => {},
  matchMedia: () => anyProxy,
  location: anyProxy,
  document: anyProxy,
};
global.document = anyProxy;

new Function('window', source)(global.window);
if (!captured || typeof captured.factory !== 'function') {
  console.log('ОШИБКА: бандл не передал factory в загрузчик');
  process.exit(1);
}
console.log('бандл id: ' + captured.id);

const reactStub = new Proxy({}, {
  get(target, key) {
    if (key === 'createElement' || key === 'jsx' || key === 'jsxs') return () => anyProxy;
    if (key === 'useState') return (value) => [value, () => {}];
    if (key === 'useEffect') return () => {};
    if (key === 'useRef') return () => ({ current: null });
    if (key === 'useMemo') return (factory) => factory();
    if (key === 'useCallback') return (fn) => fn;
    if (key === 'Fragment') return 'Fragment';
    return anyProxy;
  },
});

let exported;
try {
  exported = captured.factory((name) => {
    if (name === 'react') return reactStub;
    return anyProxy;
  });
} catch (error) {
  console.log('ОШИБКА исполнения фабрики: ' + error.message);
  process.exit(1);
}
const keys = Object.keys(exported || {});
console.log('экспорты: ' + keys.join(', '));
const ok = typeof exported?.apply === 'function' && exported?.inject !== undefined;
console.log(ok ? 'OK: бандл загружается, apply() и inject() на месте' : 'ОШИБКА: нет apply/inject');
process.exit(ok ? 0 : 1);
