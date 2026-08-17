/* domtest.mjs — boots example.html in jsdom and drives the buttons.
 * Optional check that the page wires up and the interactions do not throw.
 *   npm i jsdom && node domtest.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('./example.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  url: new URL('./example.html', import.meta.url).href,
  pretendToBeVisual: true
});

const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));
dom.virtualConsole.on('jsdomError', (e) => errors.push(e.message));

await new Promise((r) => setTimeout(r, 400));

const doc = dom.window.document;
let pass = 0, fail = 0;
const check = (n, c, x) => c
  ? (pass++, console.log('  ok   ' + n))
  : (fail++, console.log('  FAIL ' + n + (x ? '  → ' + x : '')));

const click = (elm) => elm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const nodesOnCanvas = () => doc.querySelectorAll('#canvas-host g.node').length;
const svgEdges = () => doc.querySelectorAll('#canvas-host g.edge').length;
const logText = () => doc.getElementById('log').textContent;

console.log('page boot');
check('no script errors', errors.length === 0, errors[0]);
check('svg rendered', !!doc.querySelector('#canvas-host svg'));
check('default preset drew nodes', nodesOnCanvas() >= 4, 'got ' + nodesOnCanvas());
check('edges drawn', svgEdges() >= 2, 'got ' + svgEdges());
check('a split is on screen', !!doc.querySelector('#canvas-host g.node.split'));
check('palette populated', doc.querySelectorAll('#palette button').length >= 8);
check('presets populated', doc.querySelectorAll('#presets button').length >= 6);
check('sample buttons present', doc.querySelectorAll('#samples button').length === 3);
check('validation shown', doc.getElementById('issues').children.length >= 1);
check('stats line filled', /nodes/.test(doc.getElementById('stats').textContent));

console.log('\npresets');
for (const b of doc.querySelectorAll('#presets button')) {
  const name = b.textContent;
  const before = errors.length;
  click(b);
  check('preset "' + name + '" ran cleanly', errors.length === before, errors[errors.length - 1]);
  check('preset "' + name + '" drew something', nodesOnCanvas() >= 1, 'got ' + nodesOnCanvas());
}

console.log('\nadd every palette type');
click([...doc.querySelectorAll('#presets button')].find((b) => b.textContent === 'single node'));
const startCount = nodesOnCanvas();
for (const b of doc.querySelectorAll('#palette button')) {
  const before = errors.length;
  click(b);
  check('added ' + b.textContent + ' without error', errors.length === before, errors[errors.length - 1]);
}
check('canvas grew', nodesOnCanvas() > startCount, startCount + ' → ' + nodesOnCanvas());
check('no validation errors after adding all types',
  doc.querySelectorAll('#issues .issue.error').length === 0,
  doc.getElementById('issues').textContent.slice(0, 200));

console.log('\nlinking by clicking ports');
click([...doc.querySelectorAll('#presets button')].find((b) => b.textContent === 'single node'));
click([...doc.querySelectorAll('#palette button')].find((b) => /Step/.test(b.textContent)));
{
  const outs = doc.querySelectorAll('#canvas-host circle.port.out');
  const ins = doc.querySelectorAll('#canvas-host circle.port.in');
  check('ports rendered', outs.length >= 2 && ins.length >= 1, outs.length + ' out, ' + ins.length + ' in');
  const before = svgEdges();
  click(outs[0]);
  check('pending link registered', !!doc.querySelector('circle.port.pending'));
  click(ins[ins.length - 1]);
  check('edge created by clicking two ports', svgEdges() === before + 1, before + ' → ' + svgEdges());
}

console.log('\noverflow creates a split, removing a branch collapses it');
click([...doc.querySelectorAll('#presets button')].find((b) => /branching/.test(b.textContent)));
{
  check('split present after overflow', !!doc.querySelector('g.node.split'));
  const edge = doc.querySelector('#canvas-host g.edge path.hit');
  click(edge);
  const removeBtn = [...doc.querySelectorAll('#inspector button')].find((b) => /Remove edge/.test(b.textContent));
  check('edge inspector offers removal', !!removeBtn);
  if (removeBtn) {
    click(removeBtn);
    check('split collapsed itself', !doc.querySelector('g.node.split'),
      'still ' + doc.querySelectorAll('g.node.split').length);
    check('collapse logged', /removed edge/.test(logText()));
  }
}

console.log('\ninspector edits');
click([...doc.querySelectorAll('#presets button')].find((b) => b.textContent === 'single node'));
click(doc.querySelector('#canvas-host g.node'));
{
  const input = doc.querySelector('#inspector input');
  check('label field present', !!input);
  input.value = 'Renamed in the UI';
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('rename applied', /Renamed in the UI/.test(doc.querySelector('#canvas-host text.label').textContent));

  const ta = doc.querySelector('#inspector textarea');
  ta.value = '{"note":"typed by hand"}';
  ta.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('data edit applied', /edited node data/.test(logText()));

  const detach = [...doc.querySelectorAll('#inspector button')].find((b) => b.textContent === 'Detach');
  click(detach);
  check('detach moved it to the tray', !!doc.querySelector('g.node.detached'));
  click(doc.querySelector('g.node.detached'));
  check('reattached from the tray', !doc.querySelector('g.node.detached'));
}

console.log('\ncollapse a subgraph');
click([...doc.querySelectorAll('#presets button')].find((b) => /subgraph/.test(b.textContent)));
{
  const before = nodesOnCanvas();
  const toggle = doc.querySelector('#canvas-host text.toggle');
  check('collapse toggle rendered', !!toggle);
  const edgesBefore = svgEdges();
  click(toggle);
  check('collapsing hid children', nodesOnCanvas() < before, before + ' → ' + nodesOnCanvas());
  check('collapsing rewrote no edges', /collapsed/.test(logText()));
  click(doc.querySelector('#canvas-host text.toggle'));
  check('expanding restored them', nodesOnCanvas() === before);
  check('edge count unchanged throughout', svgEdges() === edgesBefore);
}

console.log('\nmermaid import and export through the UI');
for (const name of ['flowchart', 'sequence', 'er']) {
  const btn = [...doc.querySelectorAll('#samples button')].find((b) => b.textContent === name + '.mmd');
  click(btn);
  const before = errors.length;
  click(doc.getElementById('btn-import'));
  check(name + ': imported', /imported/.test(logText()) && errors.length === before, errors[errors.length - 1]);
  check(name + ': drew nodes', nodesOnCanvas() >= 3, 'got ' + nodesOnCanvas());
  check(name + ': no validation errors', doc.querySelectorAll('#issues .issue.error').length === 0,
    doc.getElementById('issues').textContent.slice(0, 160));
  click(doc.getElementById('btn-export'));
  const out = doc.getElementById('mermaid-io').value;
  check(name + ': exported text', out.length > 20 && /\n/.test(out));
  click(doc.getElementById('btn-import'));
  check(name + ': its own export re-imports', errors.length === before, errors[errors.length - 1]);
}

console.log('\nregistry and json panels');
click(doc.getElementById('btn-registry'));
{
  const j = doc.getElementById('json-out').value;
  check('registry serialised', j.length > 50);
  const parsed = JSON.parse(j);
  check('descriptors present', !!parsed['demo.step'].ports);
  check('no renderer fields', !('component' in parsed['demo.step']));
}
click(doc.getElementById('btn-json'));
check('document serialised', JSON.parse(doc.getElementById('json-out').value).schemaVersion === '1.0.0');

console.log('\nclear');
click(doc.getElementById('btn-clear'));
check('canvas emptied', nodesOnCanvas() === 0, 'got ' + nodesOnCanvas());
check('no errors at any point', errors.length === 0, errors.join(' | ').slice(0, 300));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' checks)');
process.exit(fail === 0 ? 0 : 1);
