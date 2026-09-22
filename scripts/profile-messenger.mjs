import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import buildFixture from "../apps/web/tests/browser/support/build-ux-fixture.mjs";
const output = process.argv[2];
const bundle = await buildFixture();
const styles = (await Promise.all(["apps/web/app/globals.css", "apps/web/features/messenger/messenger-redesign.css", "apps/web/features/messenger/messenger-ux3.css"].map(file => readFile(file,"utf8")))).join("\n");
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {});
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name,m.value]));
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({content:styles}); await page.addScriptTag({content:bundle});
  await page.locator('[data-message-id="m140"]').waitFor();
  const result = {engine:await browser.version(),cpuThrottle:4,viewport:[390,844],samples:[],heap:{}};
  for (const count of [140,5000]) {
    await page.evaluate(count => window.__uxFixture.load(count),count);
    await page.locator(`[data-message-id="m${count}"]`).waitFor();
    // Warm-up excludes module/ICU initialization from steady-state typing.
    await page.getByLabel("Message",{exact:true}).fill("warm up");
    const before = await metrics(); const frames = [];
    for (let index=0;index<30;index++) {
      frames.push(await page.evaluate(async index => {
        const start=performance.now(),node=document.querySelector("textarea");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(node,`draft ${index}`);
        node.dispatchEvent(new Event("input",{bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return performance.now()-start;
      },index));
    }
    const after=await metrics(); frames.sort((a,b)=>a-b);
    result.samples.push({history:count,renderedRows:await page.locator("[data-message-id]").count(),inputSamples:30,
      mainThreadMsPerInput:(after.TaskDuration-before.TaskDuration)*1000/30,
      scriptMsPerInput:(after.ScriptDuration-before.ScriptDuration)*1000/30,
      inputToTwoFramesMedianMs:frames[15],inputToTwoFramesP95Ms:frames[28],
      layoutCount:after.LayoutCount-before.LayoutCount,heapUsed:after.JSHeapUsedSize});
  }
  await page.getByRole("button",{name:"Hide",exact:true}).click(); await cdp.send("HeapProfiler.collectGarbage");
  result.heap.hiddenBeforeCycles=(await metrics()).JSHeapUsedSize;
  for(let i=0;i<12;i++) {await page.getByRole("button",{name:"Show",exact:true}).click(); await page.getByLabel("Message",{exact:true}).fill("private draft");await page.getByRole("button",{name:"Hide",exact:true}).click();}
  await cdp.send("HeapProfiler.collectGarbage");result.heap.hiddenAfterCycles=(await metrics()).JSHeapUsedSize;
  result.heap.cycles=12;result.heap.remainingHistoryRows=await page.locator("[data-message-id]").count();
  result.note="Actual timeline/draft/action components with controlled history, not full MLS runtime or a physical mobile benchmark. Two-frame latency includes display scheduling. Heap numbers are diagnostic, not a proof of no leaks.";
  const json=JSON.stringify(result,null,2);console.log(json);if(output) await writeFile(output,json+"\n");
} finally {await browser.close();}
