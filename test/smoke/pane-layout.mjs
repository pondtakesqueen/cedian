#!/usr/bin/env node
// The agent pane's layout across widths: draws the live pane (its own code, bundled, with
// agentPane.css and the theme's --cedian-* properties) on a thread with a branch, a PR, a context
// reading, a run cost, a question, a plan and cedia's recorded blocks, then sweeps it from 280 to 720 px and fails on
// anything that leaves the pane, on clipped content that is not an ellipsis, on overlapping
// controls in the header and composer rows, and on any of those rows changing height (the layout
// jumping while a divider is dragged). With --shots <dir> it also writes light and dark pictures.
// Usage: node test/smoke/pane-layout.mjs [--shots <dir>] [--from 280] [--to 720]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumBin = process.env.CEDIAN_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const shots = opt("--shots");
const from = Number(opt("--from", 280));
const to = Number(opt("--to", 720));

const replay = join(root, "daemon/crates/cedian_agent/tests/replay");
const recorded = ["edit-and-check", "denied-call"].flatMap((name) => JSON.parse(readFileSync(join(replay, `${name}.blocks.json`), "utf8"))[""]);
if (!readdirSync(replay).length) throw new Error("no recorded blocks");

function bundle() {
  const entry = `
    import { AgentPane } from "./src/agent-pane/pane";
    import { cssVars } from "./src/theme/theme";
    import { paneTypography } from "./src/settings/desktop";
    globalThis.cedianLayout = (appearance, blocks) => {
      for (const [k, v] of Object.entries({ ...cssVars(appearance), ...paneTypography({}) })) document.documentElement.style.setProperty(k, v);
      document.body.style.background = getComputedStyle(document.documentElement).getPropertyValue("--cedian-frame");
      let listener = () => {};
      const wire = { request: () => {}, onAny: (l) => ((listener = l), () => {}) };
      const host = { cwd: "/r", files: async () => [], pickImages: async () => [], openReview: () => {}, openUrl: () => {}, popOut: () => {}, float: () => {} };
      const pane = new AgentPane(document, wire, host);
      document.querySelector(".host").replaceChildren(pane.root);
      const model = "anthropic/claude-opus-5-5";
      const info = { id: "t-1", title: "แก้ปุ่ม export บน Safari ที่ไม่ยอมดาวน์โหลดไฟล์", task: "fix", archived: false, messages: [], pending: [], sessions: [], state: "done", status: "done", updated_at: "2026-11-05T10:00:00Z", cwd: "/r/.cedian/worktrees/a",
        pr: { number: 128, url: "https://github.com/o/r/pull/128", state: "open", ci: "passing", conflict: false, review: null, fixing: false } };
      listener({ kind: "choices", models: { default: model, models: [{ ref: model, label: "Opus 5.5", provider: "anthropic", available: true, contextWindow: 200000, effort: true, effortLevels: ["low", "medium", "high"] }], modes: [] }, permissions: { default: "workspace", modes: [{ mode: "read-only", label: "Read-only", description: "" }, { mode: "workspace", label: "Workspace", description: "" }] } });
      // The open thread asks a question and has a plan, so both cards are drawn too.
      const asking = { ...info, status: "asking", state: "asking", question: { question: "ควรจำกัดจำนวนครั้งที่ลองต่อใหม่ไหม หรือลองไปเรื่อยๆ?", options: ["ลองไปเรื่อยๆ ห่างสุด 30 วินาที", "หยุดหลัง 10 ครั้ง แล้วให้กด Reconnect เอง"] },
        todo: [{ state: "done", text: "หาว่าทำไม reconnect ค้างหลัง sleep" }, { state: "doing", text: "ใส่ exponential backoff" }, { state: "pending", text: "เขียน test กรณีตื่นจาก sleep" }] };
      listener({ kind: "threads", cwd: "/r", threads: [asking, { ...info, id: "t-2", title: "ย้าย daemon reconnect ไปใช้ backoff", status: "asking", state: "asking", needs_you: true, pr: undefined }] });
      pane.openThread("t-1");
      listener({ kind: "git", thread: "t-1", state: { Ok: { branch: "fix/safari-export", base: "origin/main", ahead: 2, behind: 0, upstream: "origin/fix/safari-export", unpushed: 0, changed: 0 } } });
      const thai = [{ kind: "user", text: "ปุ่ม export ไม่ทำอะไรเลยบน Safari ช่วยดูหน่อย แล้วใส่ test ด้วย", images: [] }, { kind: "thinking", text: "ดูก่อนว่า revoke ทำตอนไหน", streaming: false, ms: 6000 }];
      listener({ kind: "caught", thread: "t-1" });
      // cedia's recordings run on the faux model; say Opus, so the context ring and effort show.
      const shown = blocks.map((b) => (b.kind === "session" ? { ...b, model } : b));
      listener({ kind: "blocks", thread: "t-1", from: 0, blocks: [...shown.slice(0, 1), ...thai, ...shown.slice(2)], context: 68000, run_cost: 0.41 });
      return true;
    };
    globalThis.cedianCheck = () => {
      const pane = document.querySelector(".cedian-agent-pane");
      const pr = pane.getBoundingClientRect();
      const vis = (e) => { const s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && e.getClientRects().length > 0; };
      const name = (e) => e.tagName.toLowerCase() + "." + String(e.className.baseVal ?? e.className).trim().replace(/\\s+/g, ".");
      const issues = [];
      for (const e of pane.querySelectorAll(":scope > .head *, .composer *, .log *")) {
        if (!vis(e) || e.closest(".vh, option, optgroup")) continue;
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        if (r.width && (r.right > pr.right + 0.5 || r.left < pr.left - 0.5)) issues.push("leaves the pane: " + name(e));
        const parent = e.parentElement && getComputedStyle(e.parentElement);
        if (s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && e.tagName !== "TEXTAREA" && !e.matches(".chips") && e.scrollWidth > e.clientWidth + 1) issues.push("clipped: " + name(e));
      }
      // A clipped .chips row hides a control; it must fit.
      for (const chips of pane.querySelectorAll(".composer .chips")) if (chips.scrollWidth > chips.clientWidth + 1) issues.push("composer controls do not fit: " + chips.scrollWidth + " > " + chips.clientWidth);
      for (const row of pane.querySelectorAll(":scope > .head .r1, :scope > .head .r2, .composer > .row, .composer .chips, .tline, .ti, .rhead, .check, .card .ch, .opt")) {
        const kids = [...row.children].filter(vis).map((k) => [k, k.getBoundingClientRect()]);
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
          const [a, ar] = kids[i], [b, br] = kids[j];
          if (Math.min(ar.right, br.right) - Math.max(ar.left, br.left) > 1 && Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top) > 1) issues.push("overlap: " + name(a) + " × " + name(b));
        }
      }
      const h = (sel) => Math.round(pane.querySelector(":scope " + sel)?.getBoundingClientRect().height ?? 0);
      return { issues, heights: { head: h("> .head"), r1: h("> .head .r1"), r2: h("> .head .r2"), row: h(".composer > .row"), composer: h(".composer") } };
    };`;
  return execFileSync(join(root, "node_modules/.bin/esbuild"), ["--bundle", "--format=iife", "--loader=ts"], { cwd: root, input: entry, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const { chromium } = await import("playwright-core").catch(() => import("playwright"));
const browser = await chromium.launch(chromiumBin ? { executablePath: chromiumBin } : {});
const css = readFileSync(join(root, "vscode/contrib/cedian/browser/media/agentPane.css"), "utf8");
const script = bundle();
let failed = 0;
try {
  for (const appearance of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    await page.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"><style>html,body{height:100%;margin:0}.host{height:860px;margin:20px;display:flex;flex-direction:column}${css}</style><div class="host"></div>`, { waitUntil: "load" }).catch(() => {});
    await page.evaluate(script);
    await page.evaluate(([a, b]) => globalThis.cedianLayout(a, b), [appearance, recorded]);
    await page.evaluate(() => document.fonts.ready);
    let base;
    for (let w = from; w <= to; w += 10) {
      await page.evaluate((w) => (document.querySelector(".host").style.width = `${w}px`), w);
      const { issues, heights } = await page.evaluate(() => globalThis.cedianCheck());
      base ??= heights;
      for (const [k, v] of Object.entries(heights)) if (v !== base[k]) issues.push(`${k} is ${v} px, ${base[k]} px at ${from}`);
      for (const i of new Set(issues)) {
        failed++;
        console.log(`${appearance} ${w}px: ${i}`);
      }
      if (shots && [280, 360, 440].includes(w)) {
        mkdirSync(shots, { recursive: true });
        await page.evaluate(() => { const log = document.querySelector(".cedian-agent-pane .log"); log.scrollTop = log.scrollHeight; });
        await page.locator(".host").screenshot({ path: join(shots, `pane-${w}-${appearance}.png`), animations: "disabled" });
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} layout problems` : `layout ok: ${from}–${to} px in light and dark`);
process.exitCode = failed ? 1 : 0;
