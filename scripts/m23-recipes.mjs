// DEV-only live recipe matrix: node scripts/m23-recipes.mjs (Vite :5173, Chrome CDP :9222).
// LIVE_ONLY=1 reruns four UI transactions without replacing matrix.json.
// CASES=fire-special,ice-special limits presentation captures for local review.
// Restart Vite after source edits if its filesystem watcher does not refresh modules.
// Synthetic cases cover absent generated type/category pairs and are labelled in matrix.json.
import { mkdir, writeFile } from 'node:fs/promises'
const config = { port: Number(process.env.CDP_PORT ?? 9222) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function connect() {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/json/list`)
  } catch (error) {
    throw new Error(`Cannot reach Chrome CDP on port ${config.port}: ${error.message}`)
  }
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}`)
  const targets = await response.json()
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  if (!page) throw new Error(`No page target found on CDP port ${config.port}`)

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 0
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen
    socket.onerror = () => reject(new Error('CDP WebSocket connection failed'))
  })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
      else request.resolve(message.result)
      return
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {})
  }
  socket.onclose = () => {
    for (const request of pending.values()) request.reject(new Error('CDP WebSocket closed'))
    pending.clear()
  }

  return {
    close: () => socket.close(),
    on(method, listener) {
      const registered = listeners.get(method) ?? []
      registered.push(listener)
      listeners.set(method, registered)
    },
    call(method, params = {}) {
      return new Promise((resolveCall, reject) => {
        const id = ++nextId
        pending.set(id, { method, resolve: resolveCall, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}


const cdp = await connect()
const call = cdp.call
const errors = []
cdp.on('Runtime.exceptionThrown', (event) => errors.push(event))
cdp.on('Runtime.consoleAPICalled', (event) => { if (event.type === 'error') errors.push(event) })
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const waitFor = async (expression, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100) }
  throw new Error(`Timeout: ${expression}`)
}
const click = (expression) => evaluate(`(${expression}).click()`)
try {
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Page.bringToFront')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await call('Page.navigate', { url: 'http://127.0.0.1:5173/?m23Scenario=m23-current-parity-v1&graphics=balanced&motion=full&cueStep=0&vfxLab=1' })
  await waitFor('Boolean(window.__MOBIE_M23_BASELINE__?.active)')
  await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title')
  await click('document.querySelector(".title-screen__adventure")')
  await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region Select')
  await click('document.querySelector(".region-card")')
  await waitFor('[...document.querySelectorAll("button")].some((button) => button.textContent?.includes("出戰"))', 15_000, 'Encounter')
  await evaluate(`(() => {
    const supply = document.querySelector('.supply-opt')
    if (supply) supply.click()
    const engage = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('出戰'))
    if (!engage) return false
    engage.click()
    return true
  })()`)
  await waitFor('document.querySelectorAll(".poke-card").length >= 3', 15_000, 'Team Select')
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.poke-card')].slice(0, 3)
    cards.forEach((card) => card.click())
    return cards.length
  })()`)
  await waitFor('[...document.querySelectorAll("button")].some((button) => !button.disabled && button.textContent?.includes("3/3"))', 5_000, 'enabled Team Select engage action')
  await evaluate(`[...document.querySelectorAll('button')].find((button) => !button.disabled && button.textContent?.includes('3/3')).click()`)
  await waitFor('Boolean(window.__MOBIE_M23_RECIPES__)', 25_000, 'Battle')


  await waitFor('Boolean(window.__MOBIE_M23_RECIPES__)')
  await evaluate('window.__MOBIE_M23_BASELINE__.resume()')
  await waitFor('Boolean(document.querySelector(".move-slot"))')
  await sleep(600)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await waitFor('!window.matchMedia("(prefers-reduced-motion: reduce)").matches')
  const root = 'test-runs/m23/chrome-ticket14'
  await mkdir(root, { recursive: true })
  const scenarios = await evaluate('window.__MOBIE_M23_RECIPES__.scenarios()')
  const records = []
  for (const scenario of scenarios.filter((scenario) => process.env.LIVE_ONLY !== '1' && (!process.env.CASES || process.env.CASES.split(',').includes(scenario.id)))) {
    for (const phase of ['cast', 'impact']) {
      const metrics = await evaluate(`window.__MOBIE_M23_RECIPES__.show(${JSON.stringify(scenario.id)}, ${JSON.stringify(phase)})`)
      if (metrics.runtime.activeParticles === 0 && !(scenario.recipe.result === 'miss' && phase === 'impact')) throw new Error(`No particles: ${scenario.id} ${phase}`)
      await sleep(180)
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const file = `${scenario.id}-${phase}.png`
      await writeFile(`${root}/${file}`, Buffer.from(data, 'base64'))
      records.push({ ...scenario, phase, metrics, screenshot: file })
    }
    console.log(`Captured ${scenario.id} (${scenario.source})`)
  }
  if (records.length) await writeFile(`${root}/matrix.json`, JSON.stringify({
    scope: 'Live battle canvas DEV direct presentation cues; not reducer transactions or performance release evidence',
    browser: await call('Browser.getVersion'), viewport: { width: 1024, height: 768, dpr: 1 },
    motion: 'CDP prefers-reduced-motion:no-preference; app full', records, errors,
  }, null, 2))
  const captureBattle = async (kind) => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${root}/battle-${kind}.png`, Buffer.from(data, 'base64'))
  }
  const battleRecords=[]
  for (const kind of ['special','status','miss','immune']) {
   await evaluate(`window.__MOBIE_M23_RECIPES__.prepareBattle(${JSON.stringify(kind)})`)
   await sleep(400)
   const targetBefore = await evaluate('(() => { const foe = window.__MOBIE_M23_BASELINE__.battleState().foe; return { index: foe.activeIndex, hp: foe.members[foe.activeIndex].currentHp } })()')
   await evaluate(`(() => {
    document.querySelectorAll('.dmg-num.is-on').forEach(node=>node.classList.remove('is-on')); window.__recipeDamage=[];
    window.__recipeObserver?.disconnect();
    window.__recipeObserver=new MutationObserver(()=>{
      for(const node of document.querySelectorAll('.dmg-num.is-on')) {
        const host=document.querySelector('.battle-scene-host'); const bounds=node.parentElement.getBoundingClientRect(); const entry={text:node.textContent,left:node.style.left,top:node.style.top,at:performance.now(),hostWidth:bounds.width,hostHeight:bounds.height,playerImpact:host.dataset.battleAnchorPlayerImpact,foeImpact:host.dataset.battleAnchorFoeImpact};
        if(!window.__recipeDamage.some(x=>x.text===entry.text&&x.left===entry.left&&x.top===entry.top)) {
          window.__recipeDamage.push(entry)
          setTimeout(() => { entry.after250ms = { left: node.style.left, top: node.style.top,
            cameraShot: host.dataset.battleCameraShot, playerImpact: host.dataset.battleAnchorPlayerImpact,
            foeImpact: host.dataset.battleAnchorFoeImpact } }, 250)
        }
      }
    });window.__recipeObserver.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});
    document.querySelector('.move-slot').click()
   })()`)
   const deadline=Date.now()+20000
   let captured=false
   while(Date.now()<deadline) {
    const state=await evaluate(`({phase:window.__MOBIE_M23_BASELINE__.runtimeState().phase,damage:window.__recipeDamage,feed:window.__MOBIE_M23_BASELINE__.feed()})`)
    if(state.damage.length&&!captured){await captureBattle(kind);captured=true}
    if(state.phase==='playerChoice'&&state.feed.length>1){
      const targetAfter = await evaluate('(() => { const foe = window.__MOBIE_M23_BASELINE__.battleState().foe; return { index: foe.activeIndex, hp: foe.members[foe.activeIndex].currentHp } })()')
      battleRecords.push({kind,...state,captured,targetBefore,targetAfter});break
    }
    await evaluate(`(() => {const field=document.querySelector('.battle-input-surface .tap-field');if(field)for(let i=0;i<8;i++)field.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:512,clientY:384}))})()`)
    await sleep(80)
   }
   if(!captured)await captureBattle(kind)
   if(battleRecords.at(-1)?.kind!==kind)throw Error(`Timed out ${kind}`)
   console.log(`Executed live ${kind}`)
  }

  await evaluate('window.__recipeObserver?.disconnect()')
  for (const record of battleRecords) {
    if (!Number.isFinite(record.targetBefore.hp) || !Number.isFinite(record.targetAfter.hp)) throw new Error('Target HP is unavailable')
    if (['miss', 'immune'].includes(record.kind) && (record.targetBefore.index !== record.targetAfter.index || record.targetBefore.hp !== record.targetAfter.hp)) throw new Error('Miss/immune changed target HP')
    for (const entry of record.damage) {
      if (!entry.after250ms || entry.left !== entry.after250ms.left || entry.top !== entry.after250ms.top) throw new Error('Float spawn coordinate changed after250ms')
    }
    if (record.kind === 'status' && !record.feed.some((entry) => entry.text.includes('攻擊大幅提升'))) throw new Error('Missing live status result')
    if (record.kind === 'miss' && !record.damage.some((entry) => entry.text.includes('MISS'))) throw new Error('Missing live MISS float')
    if (record.kind === 'immune' && !record.damage.some((entry) => entry.text.includes('沒效果'))) throw new Error('Missing live immune float')
  }
  await writeFile(`${root}/battle.json`, JSON.stringify({
    scope: 'Live UI commands and turn transactions; miss accuracy0 and immune target ghost are DEV fixture modifications',
    anchorLimit: 'DOM diagnostic anchor is sampled at cue publication, not exact spawn; no 8px assertion is made',
    records: battleRecords, errors,
  }, null, 2))
  if (errors.length) throw new Error(`${errors.length} runtime/console errors; see matrix.json`)
} finally {
  await evaluate('window.__recipeObserver?.disconnect()').catch(() => {})
  cdp.close()
}
