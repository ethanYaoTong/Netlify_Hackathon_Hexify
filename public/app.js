// Subscription Graveyard frontend. Plain JS, no build step.

const SPOOKY_ERROR = "The spirits couldn't read this file. Try another bank statement CSV.";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SUMMON_MS = REDUCED_MOTION ? 300 : 1500; // minimum time the summoning animation plays
const RISE_STAGGER_MS = 300;
const SLAY_MS = REDUCED_MOTION ? 0 : 900; // matches the .slaying animation
const CLEARED_DELAY_MS = REDUCED_MOTION ? 300 : 1400; // pause on the last tombstone before the win screen

const FREQUENCY_UNIT = { weekly: "week", fortnightly: "fortnight", monthly: "month", quarterly: "quarter", yearly: "year" };
const ROT_LABEL = ["Fresh", "Rotting", "Putrid", "Ancient"];

// What a year of savings buys you (Sydney prices).
const EQUIVALENTS = [
  { price: 4.8, one: "Opal trip", many: "Opal trips" },
  { price: 15, one: "Guzman y Gomez burrito", many: "Guzman y Gomez burritos" },
  { price: 5.5, one: "flat white", many: "flat whites" },
];

// Pixel art. Colours come from CSS variables so rot level can recolour the zombie.
// 14×16 zombie head: H hair, S skin, D shade, K black, E eye, T teeth, B blood
const ZOMBIE_PIXELS = [
  "....HHHHHH....",
  "..HHHSHHHHHH..",
  ".HSSSSSSSSSSH.",
  ".SSSSSSSSSSSS.",
  ".SDDDSSSSDDDS.",
  ".SKEKSSSSKEKS.",
  ".SKKKSSSSKKKS.",
  ".SSSSSDDSSSSD.",
  ".SSDSSKKSSSSD.",
  ".SSSDSSSSSSSS.",
  ".SKTKTKTKTKKS.",
  ".SSKKKKKKKKSS.",
  "..SBSSSSSSSS..",
  "...BSSSSSSS...",
  "....DSSSSD....",
  ".....DDDD.....",
];
// 12×13 tombstone: G outline, L stone, K cross, M grass, D dirt
const TOMB_PIXELS = [
  "....GGGG....",
  "..GGLLLLGG..",
  ".GLLLLLLLLG.",
  ".GLLLKKLLLG.",
  ".GLLKKKKLLG.",
  ".GLLLKKLLLG.",
  ".GLLLKKLLLG.",
  ".GLLLLLLLLG.",
  ".GLLLLLLLLG.",
  ".GLLLLLLLLG.",
  ".GLLLLLLLLG.",
  "MMMMMMMMMMMM",
  "MDMMDMMMDMMD",
];
// 11×5 bat: B body, E eye
const BAT_PIXELS = [
  "BB.......BB",
  "BBB.B.B.BBB",
  "BBBBEBEBBBB",
  ".BBBBBBBBB.",
  "..B..B..B..",
];

const $ = (id) => document.getElementById(id);
const screens = { landing: $("landing"), graveyard: $("graveyard"), cleared: $("cleared") };

// Everything about the current graveyard. Reset on every new summon.
const state = { subscriptions: [], slain: new Set(), savedYearly: 0, pendingPosts: [] };

const money = (n) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const wholeMoney = (n) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const monthYear = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tiny DOM helper. Uses textContent so merchant names from user CSVs can't inject HTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Pixel sprites
// ---------------------------------------------------------------------------

/** Turns a pixel map into an SVG <symbol>, one rect per horizontal run of the same colour. */
function pixelSymbol(id, pixels, fills) {
  const rects = [];
  pixels.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      let run = 1;
      while (row[x + run] === c) run++;
      if (fills[c]) rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" style="fill:${fills[c]}"/>`);
      x += run;
    }
  });
  return `<symbol id="${id}" viewBox="0 0 ${pixels[0].length} ${pixels.length}">${rects.join("")}</symbol>`;
}

function buildSprites() {
  const defs = document.createElement("div");
  defs.setAttribute("aria-hidden", "true");
  defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  defs.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
    ${pixelSymbol("zombie-sprite", ZOMBIE_PIXELS, { H: "var(--hair)", S: "var(--skin)", D: "var(--shade)", K: "#000", E: "var(--eye)", T: "#e8e0d0", B: "#c0262d" })}
    ${pixelSymbol("tomb-sprite", TOMB_PIXELS, { G: "#4a4540", L: "#8f877b", K: "#4a4540", M: "#3c7a2a", D: "#3b2a1c" })}
    ${pixelSymbol("bat-sprite", BAT_PIXELS, { B: "#6b2fb3", E: "#c0262d" })}
  </svg>`;
  document.body.prepend(defs);
}

function sprite(symbolId, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const symbol = document.getElementById(symbolId);
  svg.setAttribute("viewBox", symbol.getAttribute("viewBox"));
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${symbolId}`);
  svg.append(use);
  return svg;
}

// ---------------------------------------------------------------------------
// Screens and API calls
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const [key, screen] of Object.entries(screens)) screen.hidden = key !== name;
  document.body.dataset.screen = name;
  if (name !== "cleared") $("bats").replaceChildren();
  window.scrollTo(0, 0);
}

function showError(message) {
  const error = $("landing-error");
  error.textContent = message;
  error.hidden = false;
}

function setSummoning(on) {
  $("demo-btn").disabled = on;
  $("file-input").disabled = on;
  $("summoning").hidden = !on;
}

/** Sends CSV text to the detection engine and returns its JSON. */
async function detect(csvText) {
  let res;
  try {
    res = await fetch("/api/detect", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: csvText,
    });
  } catch {
    throw new Error("The spirits are unreachable. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error || SPOOKY_ERROR);
  return data;
}

/** Global counter. Returns null on failure so the UI can just hide it. */
async function fetchGlobalStats() {
  try {
    const res = await fetch("/api/slain");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Adds a slain zombie to the global counter. Failures are ignored: the local slay still counts. */
async function postSlain(yearlyCost) {
  try {
    const res = await fetch("/api/slain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yearlyCost }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function globalStatsText(stats) {
  if (!stats) return "";
  if (stats.zombiesSlain === 0) return "No one has slain a zombie yet. Be the first.";
  return `Players everywhere have slain ${plural(stats.zombiesSlain, "zombie")} worth ${wholeMoney(stats.totalSlainYearly)} a year.`;
}

async function refreshLandingCounter() {
  const text = globalStatsText(await fetchGlobalStats());
  $("landing-global").textContent = text;
  $("landing-global").hidden = !text;
}

async function summon(getCsvText) {
  $("landing-error").hidden = true;
  setSummoning(true);
  try {
    const csvText = await getCsvText();
    // Let the static play for the full summoning time even if the API is fast.
    const [result] = await Promise.all([detect(csvText), delay(SUMMON_MS)]);
    renderGraveyard(result);
    showScreen("graveyard");
  } catch (err) {
    showError(err.message || SPOOKY_ERROR);
  } finally {
    setSummoning(false);
  }
}

// ---------------------------------------------------------------------------
// Screen 2: the graveyard
// ---------------------------------------------------------------------------

const activeSubs = () => state.subscriptions.filter((s) => s.status === "active");
const remainingSubs = () => activeSubs().filter((s) => !state.slain.has(s.id));

function renderGraveyard({ subscriptions }) {
  state.subscriptions = subscriptions;
  state.slain = new Set();
  state.savedYearly = 0;
  state.pendingPosts = [];
  $("saved").textContent = `Saved ${money(0)} a year`;
  $("equivalents").textContent = "";
  updateSummary();

  // HP bars are relative to the most expensive zombie.
  const maxYearly = Math.max(...subscriptions.map((s) => s.yearlyCost), 1);
  const dormant = subscriptions.filter((s) => s.status === "dormant");

  // Active zombies first (most expensive first), dormant ones at the back.
  const cards = [...activeSubs(), ...dormant].map((s, i) => {
    const card = zombieCard(s, maxYearly);
    card.style.animationDelay = `${i * RISE_STAGGER_MS}ms`;
    return card;
  });
  $("zombies").replaceChildren(...cards);
}

function updateSummary() {
  const total = state.subscriptions.length;
  const remaining = remainingSubs();
  const drain = remaining.reduce((sum, s) => sum + s.yearlyCost, 0);
  const dormantCount = total - activeSubs().length;

  if (total === 0) {
    $("summary").textContent = "No zombies found";
    $("summary-sub").textContent = "Your graveyard is quiet. Try a longer statement to catch more.";
    return;
  }
  $("summary").textContent =
    remaining.length === 0
      ? "Every zombie is at rest"
      : `${plural(remaining.length, "zombie")} ${remaining.length === 1 ? "is" : "are"} draining ${money(drain)} a year`;
  $("summary-sub").textContent = dormantCount
    ? `Plus ${dormantCount} asleep that stopped charging you.`
    : "Strongest first. Slay them to save.";
}

function zombieCard(s, maxYearly) {
  const card = el("article", "zombie");
  card.dataset.rot = s.rotLevel;
  card.dataset.id = s.id;
  const asleep = s.status === "dormant";
  if (asleep) card.classList.add("dormant");

  const heading = el("div");
  heading.append(el("h3", "zombie-name", s.name), el("p", "zombie-level", `Lv ${s.rotLevel} ${ROT_LABEL[s.rotLevel] ?? ""}`));
  const top = el("div", "zombie-top");
  top.append(sprite("zombie-sprite", "sprite"), heading);

  const yearly = el("p", "zombie-yearly", money(s.yearlyCost));
  yearly.append(el("span", "", " a year"));

  const hp = el("div", "hp");
  hp.setAttribute("role", "img");
  hp.setAttribute("aria-label", `${Math.round((s.yearlyCost / maxYearly) * 100)}% of your most expensive subscription`);
  const fill = el("div", "hp-fill");
  fill.style.width = `${Math.max(4, (s.yearlyCost / maxYearly) * 100)}%`;
  hp.append(fill);

  const statuses = el("div", "statuses");
  if (s.priceHike) statuses.append(el("span", "status status-mutated", `Mutated +${money(s.priceHike.to - s.priceHike.from)}`));
  if (asleep) statuses.append(el("span", "status status-asleep", "zZ Asleep"));

  card.append(
    top,
    el("p", "zombie-price", `${money(s.amount)} / ${FREQUENCY_UNIT[s.frequency] ?? s.frequency}`),
    yearly,
    hp,
    el(
      "p",
      "zombie-since",
      asleep ? `Stopped charging in ${monthYear(s.lastCharged)}` : `Haunting you since ${monthYear(s.firstCharged)}`
    )
  );
  if (statuses.childElementCount) card.append(statuses);

  // Dormant zombies already stopped charging, so there's nothing to slay.
  if (!asleep) {
    const actions = el("div", "card-actions");
    const slayBtn = el("button", "btn-pixel btn-slay", "Slay");
    slayBtn.setAttribute("aria-label", `Slay ${s.name}`);
    slayBtn.addEventListener("click", () => openSlayDialog(s));
    actions.append(slayBtn);
    card.append(actions);
  }
  return card;
}

function tombCard(s) {
  const card = el("article", "zombie tomb");
  card.dataset.id = s.id;
  card.append(
    sprite("tomb-sprite", "tomb-sprite"),
    el("h3", "zombie-name", `RIP ${s.name}`),
    el("p", "tomb-years", `${s.firstCharged.slice(0, 4)}–${new Date().getFullYear()}`),
    el("p", "tomb-saved", `Saved ${money(s.yearlyCost)} a year`)
  );
  return card;
}

// ---------------------------------------------------------------------------
// Slay flow
// ---------------------------------------------------------------------------

const dialog = $("slay-dialog");
let dialogSub = null;

function openSlayDialog(s) {
  dialogSub = s;
  const portrait = $("slay-portrait");
  portrait.dataset.rot = s.rotLevel;
  portrait.replaceChildren(sprite("zombie-sprite", "sprite"));
  $("slay-title").textContent = `Slay ${s.name}?`;
  $("slay-text").textContent = `* ${s.name} drains ${money(s.yearlyCost)} a year. Cancel it on their site, then come back and finish it off.`;
  const link = $("slay-link");
  link.href = s.cancelUrl;
  link.textContent = s.known ? "Open cancel page ↗" : "Search how to cancel ↗";
  dialog.returnValue = "";
  dialog.showModal();
}

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "slay" && dialogSub) slay(dialogSub);
  dialogSub = null;
});

async function slay(s) {
  if (state.slain.has(s.id)) return;
  state.slain.add(s.id);
  state.pendingPosts.push(postSlain(s.yearlyCost));

  const from = state.savedYearly;
  state.savedYearly += s.yearlyCost;
  countUp(from, state.savedYearly);
  updateSummary();

  const card = $("zombies").querySelector(`[data-id="${CSS.escape(s.id)}"]`);
  if (card) {
    card.style.animationDelay = "0ms";
    card.classList.add("slaying");
    await delay(SLAY_MS);
    card.replaceWith(tombCard(s));
  }

  if (remainingSubs().length === 0) {
    await delay(CLEARED_DELAY_MS);
    showCleared();
  }
}

/** Counts the savings number up in chunky steps, like a score counter. */
function countUp(from, to) {
  const steps = REDUCED_MOTION ? 1 : 12;
  let i = 0;
  const tick = () => {
    i++;
    const value = from + ((to - from) * i) / steps;
    $("saved").textContent = `Saved ${money(value)} a year`;
    if (i < steps) setTimeout(tick, 45);
  };
  tick();
  $("equivalents").textContent = `That's ${equivalentPhrases(to).slice(0, 2).join(" or ")}`;
}

function equivalentPhrases(amount) {
  return EQUIVALENTS.map((e) => plural(Math.floor(amount / e.price), e.one, e.many));
}

// ---------------------------------------------------------------------------
// Screen 3: graveyard cleared
// ---------------------------------------------------------------------------

async function showCleared() {
  const count = state.slain.size;
  const cleared = count > 0 && remainingSubs().length === 0;

  $("cleared-title").textContent = cleared ? "Graveyard cleared" : count ? "You escaped the graveyard" : "You fled the graveyard";
  $("cleared-saved").textContent = `${money(state.savedYearly)} a year saved`;
  $("cleared-count").textContent = count
    ? `You slew ${plural(count, "zombie")}.`
    : "The zombies are still feeding. Come back when you're ready.";
  $("cleared-equivalents").replaceChildren(
    ...(count ? equivalentPhrases(state.savedYearly).map((p) => el("li", "", `= ${p}`)) : [])
  );
  $("cleared-global").textContent = "";
  showScreen("cleared");
  if (count) launchBats();

  // Wait for this player's slays to land, then show the updated global total.
  await Promise.allSettled(state.pendingPosts);
  $("cleared-global").textContent = globalStatsText(await fetchGlobalStats());
}

function launchBats() {
  if (REDUCED_MOTION) return;
  const bats = Array.from({ length: 9 }, () => {
    const bat = sprite("bat-sprite", "bat");
    bat.style.setProperty("--top", `${Math.round(5 + Math.random() * 70)}vh`);
    bat.style.setProperty("--duration", `${(3.5 + Math.random() * 3).toFixed(1)}s`);
    bat.style.setProperty("--delay", `${(Math.random() * 3).toFixed(1)}s`);
    return bat;
  });
  $("bats").replaceChildren(...bats);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

buildSprites();
refreshLandingCounter();

$("demo-btn").addEventListener("click", () =>
  summon(async () => {
    const res = await fetch("/demo-transactions.csv").catch(() => null);
    if (!res || !res.ok) throw new Error("The demo graveyard won't open. Try again in a moment.");
    return res.text();
  })
);

// The upload label acts as a menu button, so let keyboard users open the picker too.
$("upload-btn").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("file-input").click();
  }
});

$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (file) summon(() => file.text());
});

const backToStart = () => {
  showScreen("landing");
  refreshLandingCounter();
};
$("back-btn").addEventListener("click", backToStart);
$("again-btn").addEventListener("click", backToStart);
$("leave-btn").addEventListener("click", showCleared);
