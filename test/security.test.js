const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadApp() {
  const elements = new Map();
  const makeElement = () => ({
    style: {},
    dataset: {},
    innerHTML: "",
    textContent: "",
    addEventListener() {},
  });
  const document = {
    body: makeElement(),
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement() {
      let text = "";
      return {
        set textContent(value) { text = String(value); },
        get innerHTML() {
          return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
        },
      };
    },
  };
  const context = { document, URL, Date, Math, Map, Array, String, Number, console, setInterval() {} };
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "app.js" });
  return { context, elements };
}

test("only HTTPS job application links are retained", () => {
  const { context } = loadApp();
  assert.equal(context.normalizeJob({ url: "https://jobs.example/apply" }).url, "https://jobs.example/apply");
  assert.equal(context.normalizeJob({ url: "javascript:alert(1)" }).url, "#");
  assert.equal(context.normalizeJob({ url: "data:text/html,hello" }).url, "#");
  assert.equal(context.normalizeJob({ url: "not a url" }).url, "#");
});

test("third-party job fields are escaped and never placed in inline handlers", () => {
  const { context, elements } = loadApp();
  const job = context.normalizeJob({
    id: 'job" onmouseover="alert(1)',
    title: "<img src=x onerror=alert(1)>",
    salary: "</span><img src=x onerror=alert(1)>",
    tags: ["<svg onload=alert(1)>"] ,
    url: "javascript:alert(1)",
  });
  context.renderJobs([job]);
  const cardHtml = elements.get("jobsContainer").innerHTML;
  assert.doesNotMatch(cardHtml, /onclick=/i);
  assert.match(cardHtml, /data-job-id="job&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(cardHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(cardHtml, /<img src=x onerror=/i);

  context.__testJob = job;
  vm.runInNewContext("allJobs = [__testJob]", context);
  context.openModal(job.id);
  const modalHtml = elements.get("modalBody").innerHTML;
  assert.match(modalHtml, /href="#"/);
  assert.doesNotMatch(modalHtml, /<svg onload=/i);
});
