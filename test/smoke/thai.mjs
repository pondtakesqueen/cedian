#!/usr/bin/env node
// §13 Thai text gate (spec §9): Thai in the agent pane wraps only between words, and its lines
// keep a line height of at least 1.6. Draws Thai fixtures (and Thai mixed with English and code)
// into a bare page with agentPane.css at several pane widths in Playwright's Chromium, finds
// where each line starts, and checks every break against the word boundaries of
// Intl.Segmenter("th"), which uses the same ICU dictionary as Chromium's line breaker.
// Needs a Thai font (macOS has one; on Linux, fonts-thai-tlwg). Prints JSON; exits 1 on a
// mid-word break or a short line.
// Usage: node test/smoke/thai.mjs [--out file.json]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(join(root, "vscode/contrib/cedian/browser/media/agentPane.css"), "utf8");

export const FIXTURES = [
  "ช่วยแก้บั๊กในหน้าตะกร้าสินค้าให้หน่อย ตัวนับแสดงจำนวนน้อยกว่ารายการจริงหนึ่งชิ้นทุกครั้งที่กดเพิ่มสินค้า",
  "ฉันอ่านไฟล์ basket.js แล้ว ปัญหาอยู่ที่ฟังก์ชัน render ซึ่งรับค่าจำนวนก่อนที่จะเพิ่มรายการใหม่เข้าไปในอาร์เรย์",
  "การทดสอบทั้งหมดผ่านแล้ว รวมทั้งกรณีที่ผู้ใช้กดปุ่มหลายครั้งติดต่อกันอย่างรวดเร็วและกรณีที่รายการว่างเปล่า",
  "ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ เบราว์เซอร์จึงต้องใช้พจนานุกรมเพื่อหาตำแหน่งที่ตัดบรรทัดได้อย่างถูกต้อง",
];
const WIDTHS = [220, 300, 420, 560];

const { chromium } = await import("playwright-core").catch(() => import("playwright"));
const browser = await chromium.launch(process.env.CEDIAN_CHROMIUM ? { executablePath: process.env.CEDIAN_CHROMIUM } : {});
const page = await browser.newPage();
await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}
  :root { --cedian-font-ui: -apple-system, "Sukhumvit Set", "Thonburi", "Loma", "Garuda", sans-serif; }
  </style><div class="cedian-agent-pane"><div class="col"><div class="ans" id="ans"></div></div></div>`);

const result = await page.evaluate(
  ({ fixtures, widths }) => {
    const ans = document.getElementById("ans");
    const col = ans.parentElement;
    const segmenter = new Intl.Segmenter("th", { granularity: "word" });
    const out = [];
    for (const width of widths) {
      col.style.width = `${width}px`;
      for (const text of fixtures) {
        ans.textContent = text;
        const node = ans.firstChild;
        const range = document.createRange();
        // A line starts where a character's box sits lower than the one before it.
        const starts = [];
        let top;
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect || rect.width === 0) continue;
          if (top !== undefined && rect.top > top + 1) starts.push(i);
          top = rect.top;
        }
        const bounds = new Set([...segmenter.segment(text)].map((s) => s.index));
        const midWord = starts.filter((i) => !bounds.has(i) && !/\s/.test(text[i - 1] ?? ""));
        const style = getComputedStyle(ans);
        out.push({
          width,
          lines: starts.length + 1,
          midWord: midWord.map((i) => `${text.slice(Math.max(0, i - 6), i)}|${text.slice(i, i + 6)}`),
          lineHeightRatio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
        });
      }
    }
    return out;
  },
  { fixtures: FIXTURES, widths: WIDTHS },
);
await browser.close();

const broken = result.filter((r) => r.midWord.length);
const short = result.filter((r) => r.lineHeightRatio < 1.6);
const multi = result.filter((r) => r.lines > 1).length;
const summary = { cases: result.length, wrapped: multi, midWord: broken, shortLines: short.length, lineHeightRatio: result[0]?.lineHeightRatio };
for (const r of broken) console.log(`thai: mid-word break at ${r.width}px: ${r.midWord.join(", ")}`);
console.log(`thai: ${result.length} cases, ${multi} wrapped, ${broken.length} with a mid-word break, line height ${summary.lineHeightRatio}`);
console.log(JSON.stringify(summary));
const out = process.argv.indexOf("--out");
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ summary, result }, null, 2));
process.exit(broken.length || short.length || multi === 0 ? 1 : 0);
