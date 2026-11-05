#!/usr/bin/env node
// The agent pane's other cards across widths: the same sweep as pane-layout.mjs (its own code,
// bundled, with agentPane.css), on a finished thread that has a review, line comments, a code
// review, the commit card, the Git card, the PR block, the Pull requests card and the Issues card
// open at once, filled with realistic data. It fails on anything that leaves the pane, on clipped
// content that is not an ellipsis, and on overlapping controls; with --shots <dir> it writes
// light and dark pictures at 360 and 440 px, from the top of the log.
// Usage: node test/smoke/pane-cards.mjs [--shots <dir>] [--from 280] [--to 720]
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
      listener({ kind: "caught", thread: "t-1" });
      listener({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "user", text: "ปุ่ม export ไม่ทำอะไรเลยบน Safari ช่วยดูหน่อย", images: [] }, { kind: "text", text: "แก้แล้วครับ: Safari ยกเลิก blob URL ก่อนดาวน์โหลดเสร็จ เลยเลื่อน revoke ไปหลัง click", streaming: false }], context: 68000, run_cost: 0.41 });
      listener({ kind: "status", thread: "t-1", status: "done" });
      const h = (id, state) => ({ id, header: "@@ -1 +1 @@", lines: ["-a", "+b"], new_start: 1, path: "x", state });
      listener({ kind: "review", thread: "t-1", review: { files: [
        { path: "src/export/download.ts", added: 12, removed: 3, binary: false, hunks: [h("h1", "pending"), h("h2", "pending")] },
        { path: "src/export/download.test.ts", added: 41, removed: 0, binary: false, hunks: [h("h3", "accepted")] },
        { path: "src/ui/toolbar.tsx", added: 2, removed: 2, binary: false, hunks: [h("h4", "stale")] } ] } });
      const findings = [
        { id: "f1", path: "src/export/download.ts", line: 42, text: "revokeObjectURL still runs before the click on Firefox when the menu closes first", severity: "high" },
        { id: "f2", path: "src/export/download.ts", line: 58, text: "The 1 s timeout is a guess; tie it to the anchor's click instead", severity: "medium" },
        { id: "f3", path: "src/export/download.test.ts", line: 12, text: "The test stubs URL but never checks it was revoked", severity: "low" } ];
      listener({ kind: "notes", thread: "t-1", notes: {
        comments: [
          { id: "c1", path: "src/export/download.ts", line: 40, text: "ใช้ requestAnimationFrame แทน setTimeout ได้ไหม", at: "", sent: false, resolved: false },
          { id: "c2", path: "src/ui/toolbar.tsx", line: 18, text: "ชื่อปุ่มควรเป็น Export as CSV", at: "", sent: true, resolved: false },
          { id: "c3", path: "src/export/download.ts", line: 12, text: "import ที่ไม่ใช้แล้ว", at: "", sent: true, resolved: true } ],
        dismissed: ["f3"],
        review: { model: "anthropic/claude-opus-5-5", verdict: "changes", summary: "The fix works on Safari; one path still revokes early on Firefox.", files: ["src/export/download.ts", "src/export/download.test.ts"], dropped: [], costUsd: 0.08, findings } } });
      pane.gitOpen = true;
      pane.gitFetching = false;
      listener({ kind: "git", thread: "t-1", state: { Ok: { branch: "fix/safari-export", base: "origin/main", ahead: 3, behind: 1, upstream: "origin/fix/safari-export", unpushed: 1, changed: 2 } } });
      pane.gitOpen = true;
      const view = { number: 128, url: "https://github.com/o/r/pull/128", title: "Fix Safari export: revoke the blob URL after the download starts", body: "Safari revoked the URL before the download began.", state: "open", draft: false, author: "pongsathon", mine: true, head: "fix/safari-export", base: "main", additions: 55, deletions: 5, commits: 3, changed_files: 3, conflict: false, behind: true,
        review_decision: "review_required", reviewers: [{ login: "mali", state: "commented" }, { login: "kit", state: null }], labels: ["bug", "safari"], closes: [91],
        checks: [{ name: "typescript", state: "passed", url: "u", run: "1" }, { name: "rust", state: "pending", url: "u", run: "2" }, { name: "e2e (webkit)", state: "failed", url: "u", run: "3" }],
        comments: [{ at: "2026-11-05T09:10:00Z", author: "mali", body: "ลองบน Safari 17 แล้วโหลดได้ครับ แต่ Firefox ยังค้าง" }],
        threads: [{ id: "r1", path: "src/export/download.ts", line: 42, hunk: "@@ -40,3 +40,6 @@", resolved: false, comments: [{ at: "", author: "mali", body: "This still races on Firefox." }] }],
        history: [], auto_merge: null };
      listener({ kind: "pr_view", thread: "t-1", view: { Ok: view } });
      pane.openPrs();
      listener({ kind: "prs", cwd: "/r", list: { Ok: {
        to_review: [{ number: 131, url: "u", title: "Reconnect with backoff after sleep", author: "kit", head: "fix/reconnect", base: "main", draft: false, additions: 120, deletions: 14, ci: "pending", review_requested: true }],
        mine: [{ number: 128, url: "u", title: "Fix Safari export", author: "pongsathon", head: "fix/safari-export", base: "main", draft: false, additions: 55, deletions: 5, ci: "failing", review_requested: false }],
        open: [{ number: 127, url: "u", title: "ย้ายการตั้งค่าฟอนต์ไปหน้า Appearance", author: "mali", head: "settings-font", base: "main", draft: true, additions: 30, deletions: 8, ci: "passing", review_requested: false }] } } });
      pane.openIssues();
      listener({ kind: "issues", cwd: "/r", filter: { state: "open", assigned: false, search: "" }, list: { Ok: [
        { number: 91, url: "u", title: "Export does nothing on Safari", author: "mali", mine: false, state: "open", labels: ["bug", "safari"], comments: 4, created: "2026-11-01T00:00:00Z" },
        { number: 88, url: "u", title: "รองรับการลากไฟล์ใส่ composer", author: "kit", mine: true, state: "open", labels: ["enhancement"], comments: 1, created: "2026-10-28T00:00:00Z" } ] } });
      pane.render();
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
    const page = await browser.newPage({ viewport: { width: 760, height: 3200 }, deviceScaleFactor: shots ? 2 : 1 });
    await page.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"><style>html,body{height:100%;margin:0}.host{height:3160px;margin:20px;display:flex;flex-direction:column}${css}</style><div class="host"></div>`, { waitUntil: "load" }).catch(() => {});
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
      if (shots && [360, 440].includes(w)) {
        mkdirSync(shots, { recursive: true });
        await page.evaluate(() => { const log = document.querySelector(".cedian-agent-pane .log"); log.scrollTop = 0; });
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
