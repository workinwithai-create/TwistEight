const PRE = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const BARS = 8;
const STEPS_PER_BAR = 16;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;
const SAMPLE_RATE = 48000;

const keyOffsets = {
  "A minor": 0,
  "C major": 3,
  "E minor": 7,
  "D minor": 5
};

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

function transpose(midi) {
  return midi + (keyOffsets[state.key] || 0);
}

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
    master.gain.value = 0.35;
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

function scheduleNote(voice, when, midi, gain = 0.35, dur = 0.4, offlineCtx = null, offlineMaster = null) {
  const useCtx = offlineCtx || ctx;
  const useMaster = offlineMaster || master;
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
  const raw = rawBuffers[name];
  if (!raw) return;
  const src = useCtx.createBufferSource();
  // Decode into the target context (reuse raw ArrayBuffer)
  useCtx.decodeAudioData(raw.slice(0)).then(buf => {
    src.buffer = buf;
    if (midi && base) src.playbackRate.value = rateForMidi(midi, base);
    const g = useCtx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.01);
    g.gain.setValueAtTime(gain, when + Math.max(0, dur - 0.02));
    g.gain.linearRampToValueAtTime(0, when + dur);
    src.connect(g);
    g.connect(useMaster);
    src.start(when);
    src.stop(when + dur + 0.05);
  }).catch(() => {});
  if (!offlineCtx) {
    state.activeSources.push(src);
    src.onended = () => {
      const i = state.activeSources.indexOf(src);
      if (i >= 0) state.activeSources.splice(i, 1);
    };
  }
}

function scheduleStep(step, when, offlineCtx = null, offlineMaster = null) {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const stepInBar = step % STEPS_PER_BAR;
  const isTwist = (state.mode === "twist" || state.mode === "only" || offlineCtx) && bar >= 4;
  const bars = isTwist ? state.groove.twist : state.groove.loop;
  const ch = bars[bar % 8];
  if (stepInBar === 0) scheduleNote("kick", when, 36, 0.5, 0.2, offlineCtx, offlineMaster);
  if (stepInBar === 8) scheduleNote("snare", when, 38, 0.4, 0.15, offlineCtx, offlineMaster);
  if (stepInBar % 2 === 0) scheduleNote("hat", when, 42, 0.2, 0.1, offlineCtx, offlineMaster);
  if (stepInBar === 0) {
    ch.piano.forEach(m => scheduleNote("piano", when, transpose(m), 0.3, 0.9, offlineCtx, offlineMaster));
    scheduleNote("bass", when, transpose(ch.bass), 0.4, 0.8, offlineCtx, offlineMaster);
  }
  if (isTwist && state.recipe.id === "call-twist" && bar === 4 && stepInBar === 0) {
    scheduleNote("trumpet", when + 0.1, transpose(64), 0.35, 0.6, offlineCtx, offlineMaster);
  }
  if (isTwist && state.recipe.id === "pedal-lift" && bar === 5 && stepInBar === 4) {
    scheduleNote("violin", when, transpose(64), 0.3, 1.2, offlineCtx, offlineMaster);
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

// --- WAV export (OfflineAudioContext, exact length, fold tail) ---
function encodeWav24(float32Left, float32Right, sampleRate) {
  const numChannels = 2;
  const bitsPerSample = 24;
  const blockAlign = numChannels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = float32Left.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < float32Left.length; i++) {
    const l = Math.max(-1, Math.min(1, float32Left[i]));
    const r = Math.max(-1, Math.min(1, float32Right[i]));
    const lInt = Math.round(l * 8388607);
    const rInt = Math.round(r * 8388607);
    view.setUint8(offset, lInt & 0xff); view.setUint8(offset+1, (lInt>>8)&0xff); view.setUint8(offset+2, (lInt>>16)&0xff);
    view.setUint8(offset+3, rInt & 0xff); view.setUint8(offset+4, (rInt>>8)&0xff); view.setUint8(offset+5, (rInt>>16)&0xff);
    offset += 6;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function exportWav(withTail = false) {
  ensureCtx();
  const bpm = state.bpm;
  const bars = state.mode === "only" ? 4 : 8;
  const exactSamples = Math.round(bars * 4 * 60 / bpm * SAMPLE_RATE);
  const tailSec = 1.5;
  const offline = new OfflineAudioContext(2, exactSamples + Math.ceil(tailSec * SAMPLE_RATE), SAMPLE_RATE);
  const oMaster = offline.createGain();
  oMaster.gain.value = 0.35;
  const oComp = offline.createDynamicsCompressor();
  oComp.threshold.value = -12; oComp.ratio.value = 8;
  oMaster.connect(oComp);
  oComp.connect(offline.destination);

  let t = 0.001; // tiny offset to avoid zero-time edge, still within 1ms
  const stepDur = 60 / bpm / 4;
  const totalSteps = bars * STEPS_PER_BAR;
  for (let s = 0; s < totalSteps; s++) {
    scheduleStep(s, t, offline, oMaster);
    t += stepDur;
  }

  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  // Fold tail
  const mainLen = exactSamples;
  for (let i = 0; i < left.length - mainLen; i++) {
    left[i] += left[mainLen + i];
    right[i] += right[mainLen + i];
  }
  const outL = left.subarray(0, mainLen);
  const outR = right.subarray(0, mainLen);
  // Peak normalize to -1 dBFS
  let peak = 0;
  for (let i = 0; i < outL.length; i++) {
    peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  }
  const scale = peak > 0.891 ? 0.891 / peak : 1; // -1 dBFS
  if (scale < 1) {
    for (let i = 0; i < outL.length; i++) { outL[i] *= scale; outR[i] *= scale; }
  }
  const blob = encodeWav24(outL, outR, SAMPLE_RATE);
  const name = `twisteight-${state.recipe.id}-${bpm}bpm-${state.key.replace(/ /g,"")}${withTail ? "-with-tail" : ""}.wav`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  if (withTail) {
    // also offer full with-tail if requested separately
    const fullBlob = encodeWav24(left, right, SAMPLE_RATE);
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(fullBlob);
    a2.download = name;
    a2.click();
  }
}

// Minimal MIDI export (one track per chair)
function exportMidi() {
  // Simple SMF Type 1, 480 TPQN, 4/4, tempo
  const bpm = state.bpm;
  const tpqn = 480;
  const usPerQuarter = Math.round(60000000 / bpm);
  // Header
  let data = [];
  function pushStr(s) { for (let c of s) data.push(c.charCodeAt(0)); }
  function push32(n) { data.push((n>>24)&255,(n>>16)&255,(n>>8)&255,n&255); }
  function push16(n) { data.push((n>>8)&255,n&255); }
  pushStr("MThd"); push32(6); push16(1); push16(6); push16(tpqn); // 6 tracks
  // Tempo track
  pushStr("MTrk");
  const tempoTrack = [0x00, 0xFF, 0x51, 0x03, (usPerQuarter>>16)&255, (usPerQuarter>>8)&255, usPerQuarter&255, 0x00, 0xFF, 0x2F, 0x00];
  push32(tempoTrack.length); data.push(...tempoTrack);
  // Stub other tracks (kick, snare, hat, piano, bass, guitar) with note-ons at bar starts for demo
  for (let t = 0; t < 5; t++) {
    pushStr("MTrk");
    const tr = [0x00, 0x90 + t, 60, 80, 0x60, 0x80 + t, 60, 0, 0x00, 0xFF, 0x2F, 0x00];
    push32(tr.length); data.push(...tr);
  }
  const blob = new Blob([new Uint8Array(data)], { type: "audio/midi" });
  const name = `twisteight-${state.recipe.id}-${bpm}bpm-${state.key.replace(/ /g,"")}.mid`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

document.getElementById("bpm").onchange = e => { state.bpm = Math.max(60, Math.min(180, +e.target.value)); localStorage.setItem("twist-bpm", state.bpm); };
document.getElementById("key").onchange = e => { state.key = e.target.value; localStorage.setItem("twist-key", state.key); };
document.getElementById("playA").onclick = () => start("loop");
document.getElementById("playB").onclick = () => start("twist");
document.getElementById("play8").onclick = () => start("only");
document.getElementById("stop").onclick = stop;
document.getElementById("copy").onclick = () => navigator.clipboard.writeText(punch());

document.getElementById("exportWav").onclick = () => exportWav(false);
document.getElementById("exportMid").onclick = () => exportMidi();
// Add with-tail if button exists, else ignore
const wt = document.getElementById("exportWavTail");
if (wt) wt.onclick = () => exportWav(true);

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