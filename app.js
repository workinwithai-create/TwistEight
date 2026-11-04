const PRE = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const BARS = 8;
const STEPS_PER_BAR = 16;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;

const recipes = [
  { id: "iv-turn", name: "IV turn", blurb: "Bar 5 moves to IV. Nylon answers. Kit hitch on 7." },
  { id: "pedal-lift", name: "Pedal lift", blurb: "Bass holds tonic while piano climbs. Trumpet enters bar 6." },
  { id: "half-hitch", name: "Half hitch", blurb: "Half-time feel bars 5–6, then full pocket with violin." },
  { id: "call-twist", name: "Call twist", blurb: "Piano call on 5, trumpet answer on 6, then return." },
  { id: "walk-out", name: "Walk out", blurb: "Upright walks the roots of a new turn. Kit stays sparse." }
];

function bar(symbol, piano, guitar, bass) { return { symbol, piano, guitar, bass }; }

const grooves = [
  { id: "amber", name: "Amber Walk", bpm: 92, key: "A minor",
    loop: [bar("Am",[45,48,52,57],[45,52,57],33), bar("F",[41,45,48,53],[41,48,53],41), bar("C",[48,52,55,60],[48,52,55],36), bar("G",[43,47,50,55],[43,47,50],31),
           bar("Am",[45,48,52,57],[45,52,57],33), bar("F",[41,45,48,53],[41,48,53],41), bar("C",[48,52,55,60],[48,52,55],36), bar("G",[43,47,50,55],[43,47,50],31)],
    twist: [bar("F",[41,45,48,53],[41,48,53],41), bar("G",[43,47,50,55],[43,47,50],31), bar("Am",[45,48,52,57],[45,52,57],33), bar("E",[40,44,47,52],[40,47,52],28),
            bar("F",[41,45,48,53],[41,48,53],41), bar("G",[43,47,50,55],[43,47,50],31), bar("C",[48,52,55,60],[48,52,55],36), bar("E",[40,44,47,52],[40,47,52],28)] }
];

const state = {
  groove: grooves[0],
  recipe: recipes[0],
  bpm: 92,
  key: "A minor",
  playing: false,
  mode: null,
  step: 0,
  nextStepTime: 0,
  activeSources: []
};

let ctx, master, compressor, buffers = {}, rawBuffers = {};
let timerId = null;
let playheadRaf = null;

async function loadSamples() {
  const files = [
    ["kick", `${PRE}/drums/kick.mp3`],
    ["snare", `${PRE}/drums/snare.mp3`],
    ["hat", `${PRE}/drums/hihat.mp3`],
    ["crash", `${PRE}/drums/crash.mp3`],
    ["pC3", `${PRE}/piano/C3.mp3`],
    ["pC4", `${PRE}/piano/C4.mp3`],
    ["pA3", `${PRE}/piano/A3.mp3`],
    ["bE1", `${PRE}/bass/E1.mp3`],
    ["bA1", `${PRE}/bass/A1.mp3`],
    ["bC2", `${PRE}/bass/C2.mp3`],
    ["gE2", `${PRE}/guitar/E2.mp3`],
    ["gA2", `${PRE}/guitar/A2.mp3`],
    ["gE3", `${PRE}/guitar/E3.mp3`],
    ["tC4", `${PRE}/trumpet/C4.mp3`],
    ["vA3", `${PRE}/violin/A3.mp3`]
  ];
  let loaded = 0;
  const missing = [];
  for (const [k, url] of files) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("fetch fail");
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab;
      buffers[k] = await ctx.decodeAudioData(ab.slice(0));
    } catch (e) {
      missing.push(k);
      console.warn(k, e);
    }
    loaded++;
    document.getElementById("status").textContent = `Seating chairs ${loaded}/${files.length}`;
  }
  if (missing.length) {
    document.getElementById("status").textContent = `Missing: ${missing.join(", ")}`;
  } else {
    document.getElementById("status").textContent = "Chairs seated · live FluidR3 + kit";
  }
}

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.4;
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;
    master.connect(compressor);
    compressor.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

function rateForMidi(midi, baseMidi) {
  return Math.pow(2, (midi - baseMidi) / 12);
}

function pickSample(midi, type) {
  if (type === "piano") {
    if (midi < 54) return ["pC3", 48];
    if (midi < 59) return ["pA3", 57];
    return ["pC4", 60];
  }
  if (type === "bass") {
    if (midi < 31) return ["bE1", 28];
    if (midi < 35) return ["bA1", 33];
    return ["bC2", 36];
  }
  if (type === "guitar") {
    if (midi < 45) return ["gE2", 40];
    if (midi < 52) return ["gA2", 45];
    return ["gE3", 52];
  }
  return [null, 60];
}

function scheduleNote(voice, when, midi, gain = 0.35, dur = 0.4) {
  let name, base;
  if (voice === "kick") { name = "kick"; base = 36; }
  else if (voice === "snare") { name = "snare"; base = 38; }
  else if (voice === "hat") { name = "hat"; base = 42; }
  else if (voice === "crash") { name = "crash"; base = 49; }
  else if (voice === "piano") [name, base] = pickSample(midi, "piano");
  else if (voice === "bass") [name, base] = pickSample(midi, "bass");
  else if (voice === "guitar") [name, base] = pickSample(midi, "guitar");
  else if (voice === "trumpet") { name = "tC4"; base = 60; }
  else if (voice === "violin") { name = "vA3"; base = 57; }
  else return;
  const buf = buffers[name];
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (midi && base) src.playbackRate.value = rateForMidi(midi, base);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.setValueAtTime(gain, when + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, when + dur);
  src.connect(g);
  g.connect(master);
  src.start(when);
  src.stop(when + dur + 0.05);
  state.activeSources.push(src);
  src.onended = () => {
    const i = state.activeSources.indexOf(src);
    if (i >= 0) state.activeSources.splice(i, 1);
  };
}

function scheduleStep(step, when) {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const stepInBar = step % STEPS_PER_BAR;
  const isTwist = (state.mode === "twist" || state.mode === "only") && bar >= 4;
  const bars = isTwist ? state.groove.twist : state.groove.loop;
  const ch = bars[bar % 8];
  // Basic kit
  if (stepInBar === 0) scheduleNote("kick", when, 36, 0.5, 0.2);
  if (stepInBar === 8) scheduleNote("snare", when, 38, 0.4, 0.15);
  if (stepInBar % 2 === 0) scheduleNote("hat", when, 42, 0.2, 0.1);
  // Chord
  if (stepInBar === 0) {
    ch.piano.forEach(m => scheduleNote("piano", when, m, 0.3, 0.9));
    scheduleNote("bass", when, ch.bass, 0.4, 0.8);
  }
  // Recipe-specific twists
  if (isTwist && state.recipe.id === "call-twist" && bar === 4 && stepInBar === 0) {
    scheduleNote("trumpet", when + 0.1, 64, 0.35, 0.6);
  }
  if (isTwist && state.recipe.id === "pedal-lift" && bar === 5 && stepInBar === 4) {
    scheduleNote("violin", when, 64, 0.3, 1.2);
  }
}

function scheduler() {
  while (state.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(state.step, state.nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    state.nextStepTime += stepDur;
    state.step = (state.step + 1) % (state.mode === "only" ? 4 * STEPS_PER_BAR : TOTAL_STEPS);
  }
}

function start(mode) {
  ensureCtx();
  state.mode = mode;
  state.playing = true;
  state.step = mode === "only" ? 4 * STEPS_PER_BAR : 0;
  state.nextStepTime = ctx.currentTime + 0.1;
  if (timerId) clearInterval(timerId);
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  const updatePlayhead = () => {
    if (!state.playing) return;
    paintBars();
    playheadRaf = requestAnimationFrame(updatePlayhead);
  };
  playheadRaf = requestAnimationFrame(updatePlayhead);
}

function stop() {
  state.playing = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  state.activeSources.forEach(s => { try { s.stop(); } catch(e){} });
  state.activeSources = [];
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  paintBars();
}

function paintBars() {
  const el = document.getElementById("bars");
  el.innerHTML = "";
  for (let i = 0; i < 16; i++) {
    const isT = i >= 8;
    const ch = (isT ? state.groove.twist : state.groove.loop)[i % 8];
    const d = document.createElement("div");
    d.className = "bar" + (isT ? " twist" : "") + (state.playing && Math.floor(state.step / STEPS_PER_BAR) === i ? " active" : "");
    d.innerHTML = `<div class="n">${i+1} · ${isT ? "T" : "L"}</div><div class="c">${ch.symbol}</div>`;
    el.appendChild(d);
  }
}

function punch() {
  return `TwistEight punch list\n${state.groove.name} · ${state.bpm} BPM · ${state.key} · ${state.recipe.name}\n\nThe problem: the loop photocopies itself. Session players add a twist so the section can leave.\nThe move: ${state.recipe.blurb}\n\nLive chairs only. Distinct from TagFour, LiftTwo, PreEight, ArcEight, StackEight.\nDrop the WAV on the twist bars.`;
}

function render() {
  const gEl = document.getElementById("grooves");
  gEl.innerHTML = "";
  grooves.forEach(g => {
    const b = document.createElement("button");
    b.className = "card" + (state.groove.id === g.id ? " on" : "");
    b.innerHTML = `<b>${g.name}</b><span>${g.bpm} BPM · ${g.key}</span>`;
    b.onclick = () => { state.groove = g; state.bpm = g.bpm; state.key = g.key; document.getElementById("bpm").value = g.bpm; document.getElementById("key").value = g.key; render(); };
    gEl.appendChild(b);
  });
  const rEl = document.getElementById("recipes");
  rEl.innerHTML = "";
  recipes.forEach(r => {
    const b = document.createElement("button");
    b.className = "card" + (state.recipe.id === r.id ? " on" : "");
    b.innerHTML = `<b>${r.name}</b><span>${r.blurb}</span>`;
    b.onclick = () => { state.recipe = r; render(); };
    rEl.appendChild(b);
  });
  paintBars();
  document.getElementById("punch").textContent = punch();
}

document.getElementById("bpm").onchange = e => { state.bpm = +e.target.value; localStorage.setItem("twist-bpm", state.bpm); };
document.getElementById("key").onchange = e => { state.key = e.target.value; localStorage.setItem("twist-key", state.key); };
document.getElementById("playA").onclick = () => start("loop");
document.getElementById("playB").onclick = () => start("twist");
document.getElementById("play8").onclick = () => start("only");
document.getElementById("stop").onclick = stop;
document.getElementById("copy").onclick = () => navigator.clipboard.writeText(punch());

document.getElementById("exportWav").onclick = () => alert("WAV export: implement OfflineAudioContext render of current state, 48kHz 24-bit, exact length, first transient at 0, fold tail.");
document.getElementById("exportMid").onclick = () => alert("MIDI export: one track per chair, tempo set.");

ensureCtx();
loadSamples();
const savedBpm = localStorage.getItem("twist-bpm");
if (savedBpm) { state.bpm = +savedBpm; document.getElementById("bpm").value = savedBpm; }
const savedKey = localStorage.getItem("twist-key");
if (savedKey) { state.key = savedKey; document.getElementById("key").value = savedKey; }
render();

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.playing) stop();
});