"use strict";

const assert = require("node:assert/strict");
const { resolveObjectURL } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../tools/progress_dashboard.html"), "utf8");
const source = html.slice(html.indexOf("function exportCsv() {"), html.indexOf("for (const p of SNAP.panels)"));

function csvExport(t, clickError) {
  const urls = [], timers = [], downloads = [], attached = new Set();
  t.after(() => urls.forEach(url => URL.revokeObjectURL(url)));
  const context = vm.createContext({
    SNAP: { components: [
      { id: "visible", panel: "build", group: "tools", name: 'One, "two"', status: "ready", detail: "line 1\nline 2" },
      { id: "hidden" },
    ] },
    matches: component => component.id === "visible",
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      },
      revokeObjectURL: URL.revokeObjectURL,
    },
    document: { body: { append: anchor => attached.add(anchor) } },
    el(tag, attrs) {
      assert.equal(tag, "a");
      return {
        ...attrs,
        click() {
          assert.ok(attached.has(this));
          const blob = resolveObjectURL(this.href);
          assert.ok(blob, "the Blob URL must still resolve at click time");
          downloads.push({ filename: this.download, blob });
          if (clickError) throw clickError;
        },
        remove() { attached.delete(this); },
      };
    },
    setTimeout: callback => timers.push(callback),
  });
  return { run: () => vm.runInContext(`${source}\nexportCsv();`, context), urls, timers, downloads, attached };
}

test("releases each CSV Blob URL after starting the download", async t => {
  const { run, urls, timers, downloads, attached } = csvExport(t);
  run();
  run();
  assert.equal(new Set(urls).size, 2);
  assert.equal(attached.size, 0);
  assert.ok(urls.every(url => resolveObjectURL(url)), "the URLs survive the synchronous export");
  assert.equal(timers.length, 2);
  timers[0]();
  assert.equal(resolveObjectURL(urls[0]), undefined);
  assert.ok(resolveObjectURL(urls[1]));
  timers[1]();
  assert.equal(resolveObjectURL(urls[1]), undefined);

  for (const { filename, blob } of downloads) {
    assert.equal(filename, "leonida_progress.csv");
    assert.equal(blob.type, "text/csv");
    assert.equal(await blob.text(), 'id,panel,group,name,status,freshness,detail\r\nvisible,build,tools,"One, ""two""",ready,,"line 1\nline 2"');
  }
});

test("removes the temporary link and releases the Blob URL if clicking throws", t => {
  const error = new Error("download initiation failed");
  const { run, urls, timers, attached } = csvExport(t, error);
  assert.throws(run, thrown => thrown === error);
  assert.equal(attached.size, 0);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(resolveObjectURL(urls[0]), undefined);
});
