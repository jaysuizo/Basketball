import { db } from "./firebase.js";
import {
  ref,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ========================================
// DOM ELEMENTS
// ========================================

const el = (id) => document.getElementById(id);

const elements = {
  homeScore: el("homeScore"),
  awayScore: el("awayScore"),
  homeFouls: el("homeFouls"),
  awayFouls: el("awayFouls"),
  homeTimeouts: el("homeTimeouts"),
  awayTimeouts: el("awayTimeouts"),
  homeTeamLabel: el("homeTeamLabel"),
  awayTeamLabel: el("awayTeamLabel"),
  period: el("period"),
  maxPeriod: el("maxPeriod"),
  periodLabel: el("periodLabel"),
  periodSeparatorGroup: el("periodSeparatorGroup"),
  gameClock: el("gameClock"),
  shotClock: el("shotClock"),
  status: el("status"),
  homeTeam: el("homeTeam"),
  awayTeam: el("awayTeam"),
  themeToggle: el("themeToggle"),
  liveIndicator: el("liveIndicator"),
  liveText: el("liveText"),
  homeFoulDots: el("homeFoulDots"),
  awayFoulDots: el("awayFoulDots"),
  homeTimeoutDots: el("homeTimeoutDots"),
  awayTimeoutDots: el("awayTimeoutDots"),
  endGameOverlay: el("endGameOverlay"),
  endGameWinner: el("endGameWinner"),
  endGameScore: el("endGameScore"),
};

// ========================================
// STATE
// ========================================

let previousData = {
  homeScore: 0,
  awayScore: 0,
  possession: null,
  clockRunning: false,
  buzzer: false,
  buzzerAt: null,
  status: null,
};

let gameClockInterval = null;
let shotClockInterval = null;
let latestData = null;
let serverTimeOffset = 0;

// ========================================
// SERVER TIME OFFSET — prevents clock drift
// ========================================

const offsetRef = ref(db, ".info/serverTimeOffset");
onValue(offsetRef, (snap) => {
  serverTimeOffset = snap.val() ?? 0;
});

function now() {
  return Date.now() + serverTimeOffset;
}

// ========================================
// BUZZER — Web Audio API
// ========================================

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playBuzzer(durationSeconds = 1.8) {
  try {
    const ctx = getAudioContext();
    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1.8;
    const durationScale = safeDuration / 1.8;
    const layers = [
      { freq: 80,  gain: 0.5,  type: "sawtooth", duration: 1.8 },
      { freq: 220, gain: 0.3,  type: "square",   duration: 1.5 },
      { freq: 440, gain: 0.15, type: "sawtooth", duration: 1.2 },
    ];
    layers.forEach(({ freq, gain, type, duration }) => {
      const layerDuration = Math.max(0.12, duration * durationScale);
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gainNode.gain.setValueAtTime(gain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + layerDuration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + layerDuration);
    });
  } catch (e) {
    console.warn("Buzzer audio failed:", e);
  }
}

// Unlock AudioContext on first user interaction (browser autoplay policy)
document.addEventListener("click", () => { if (!audioCtx) getAudioContext(); }, { once: true });

// ========================================
// UTILITY
// ========================================

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function computeGameClock(data) {
  const totalDuration = data.gameDuration ?? 720;
  const elapsed = data.elapsedBeforePause ?? 0;
  if (data.clockRunning && data.clockStartedAt) {
    const additionalElapsed = (now() - data.clockStartedAt) / 1000;
    return Math.max(0, totalDuration - elapsed - additionalElapsed);
  }
  return Math.max(0, totalDuration - elapsed);
}

function computeShotClock(data) {
  const shotDuration = data.shotPartialReset ?? data.shotDuration ?? 14;
  const elapsed = data.shotElapsedBeforePause ?? 0;
  if (data.shotClockRunning && data.shotStartedAt) {
    const additionalElapsed = (now() - data.shotStartedAt) / 1000;
    return Math.max(0, shotDuration - elapsed - additionalElapsed);
  }
  return Math.max(0, shotDuration - elapsed);
}

function triggerAnimation(element, animationClass, duration = 600) {
  if (!element) return;
  element.classList.add(animationClass);
  setTimeout(() => element.classList.remove(animationClass), duration);
}

// ========================================
// DOT INDICATORS
// ========================================

const MAX_FOULS = 5;
const DEFAULT_MAX_PERIOD = 4;

function getTimeoutAllowance(period, maxPeriod = DEFAULT_MAX_PERIOD) {
  const safePeriod = Math.max(1, Number(period) || 1);
  const safeMaxPeriod = Math.max(1, Number(maxPeriod) || DEFAULT_MAX_PERIOD);
  if (safePeriod > safeMaxPeriod) return 1;
  if (safePeriod === safeMaxPeriod) return 2;
  return 1;
}

function formatFoulsDisplay(value) {
  const safe = Math.max(0, Number(value ?? 0));
  return safe >= MAX_FOULS ? "P" : `${safe}`;
}

function renderDots(container, current, max, filledClass) {
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < max; i++) {
    const dot = document.createElement("span");
    dot.className = "dot" + (i < current ? ` ${filledClass}` : "");
    container.appendChild(dot);
  }
}

function updateFoulDots(homeFouls, awayFouls) {
  const safeHomeFouls = Math.max(0, Number(homeFouls ?? 0));
  const safeAwayFouls = Math.max(0, Number(awayFouls ?? 0));
  renderDots(elements.homeFoulDots, safeHomeFouls, MAX_FOULS, "dot-foul");
  renderDots(elements.awayFoulDots, safeAwayFouls, MAX_FOULS, "dot-foul");

  const homeFoulsContainer = elements.homeFouls?.closest(".stat-item");
  const awayFoulsContainer = elements.awayFouls?.closest(".stat-item");
  if (homeFoulsContainer) {
    homeFoulsContainer.classList.toggle("high-fouls", safeHomeFouls >= 4 && safeHomeFouls < MAX_FOULS);
    homeFoulsContainer.classList.toggle("danger-fouls", safeHomeFouls >= MAX_FOULS);
  }
  if (awayFoulsContainer) {
    awayFoulsContainer.classList.toggle("high-fouls", safeAwayFouls >= 4 && safeAwayFouls < MAX_FOULS);
    awayFoulsContainer.classList.toggle("danger-fouls", safeAwayFouls >= MAX_FOULS);
  }
}

function updateTimeoutDots(homeTimeouts, awayTimeouts, timeoutLimit) {
  const safeLimit = Math.max(1, Number(timeoutLimit) || 1);
  const safeHomeTimeouts = Math.min(safeLimit, Math.max(0, Number(homeTimeouts ?? 0)));
  const safeAwayTimeouts = Math.min(safeLimit, Math.max(0, Number(awayTimeouts ?? 0)));
  renderDots(elements.homeTimeoutDots, safeHomeTimeouts, safeLimit, "dot-timeout");
  renderDots(elements.awayTimeoutDots, safeAwayTimeouts, safeLimit, "dot-timeout");
}

// ========================================
// PERIOD / OT DISPLAY
// ========================================

function updatePeriodDisplay(data) {
  const period = data.period ?? 1;
  const maxPeriod = data.maxPeriod ?? 4;
  const overtime = data.overtime ?? 0;
  const isOT = overtime > 0 || period > maxPeriod;

  if (elements.periodLabel) {
    elements.periodLabel.textContent = isOT ? "OVERTIME" : "QUARTER";
    elements.periodLabel.classList.toggle("ot-label", isOT);
  }

  if (elements.period) {
    if (isOT) {
      const otNum = overtime > 1 ? overtime : (period - maxPeriod);
      elements.period.textContent = otNum > 1 ? otNum : "";
    } else {
      elements.period.textContent = period;
    }
  }

  // Hide "/ 4" separator during OT
  if (elements.periodSeparatorGroup) {
    elements.periodSeparatorGroup.style.display = isOT ? "none" : "";
  }

  document.querySelector(".center-section")?.classList.toggle("is-overtime", isOT);
}

// ========================================
// LEADING TEAM
// ========================================

function updateLeadingTeam(homeScore, awayScore) {
  elements.homeTeam?.classList.toggle("is-leading", homeScore > awayScore);
  elements.awayTeam?.classList.toggle("is-leading", awayScore > homeScore);
}

// ========================================
// POSSESSION
// ========================================

function updatePossession(possession) {
  const hasHomePos = possession === "home";
  const hasAwayPos = possession === "away";
  elements.homeTeam?.classList.toggle("has-possession", hasHomePos);
  elements.awayTeam?.classList.toggle("has-possession", hasAwayPos);

  if (possession !== previousData.possession && possession) {
    const activeTeam = hasHomePos ? elements.homeTeam : elements.awayTeam;
    triggerAnimation(activeTeam, "possession-change", 400);
  }
}

// ========================================
// SHOT CLOCK DISPLAY
// ========================================

function updateShotClockDisplay(shotSeconds) {
  const container = document.querySelector(".shot-clock-container");
  if (!container) return;
  elements.shotClock.textContent = Math.ceil(shotSeconds);
  container.classList.remove("warning", "danger");
  if (shotSeconds <= 5 && shotSeconds > 0) {
    container.classList.add("danger");
  } else if (shotSeconds <= 10) {
    container.classList.add("warning");
  }
}

// ========================================
// GAME STATUS
// ========================================

function updateGameStatus(data) {
  const isRunning = data.clockRunning === true;
  const isEnded = data.status === "ended";
  const statusText = (data.status ?? "paused").toUpperCase();

  elements.status.textContent = statusText;
  document.body.classList.toggle("running", isRunning && !isEnded);
  document.body.classList.toggle("paused", !isRunning && !isEnded);
  document.body.classList.toggle("game-ended", isEnded);

  if (elements.endGameOverlay) {
    const wasEnded = previousData.status === "ended";
    elements.endGameOverlay.classList.toggle("visible", isEnded);

    if (isEnded && !wasEnded) {
      // First time entering "ended" state
      const homeScore = data.homeScore ?? 0;
      const awayScore = data.awayScore ?? 0;
      const homeWins = homeScore > awayScore;
      const isTie = homeScore === awayScore;
      const winnerName = isTie ? "TIE GAME" : homeWins ? (data.homeName ?? "HOME") : (data.awayName ?? "AWAY");

      if (elements.endGameWinner) {
        elements.endGameWinner.textContent = isTie ? "TIE GAME" : `${winnerName} WINS`;
      }
      if (elements.endGameScore) {
        elements.endGameScore.textContent = `${homeScore} – ${awayScore}`;
      }
    }
  }
}

// ========================================
// LIVE CLOCKS
// ========================================

function startLiveClocks() {
  stopLiveClocks();
  gameClockInterval = setInterval(() => {
    if (!latestData) return;
    const seconds = computeGameClock(latestData);
    elements.gameClock.textContent = formatTime(seconds);
    if (seconds <= 0) stopLiveClocks();
  }, 100);
  shotClockInterval = setInterval(() => {
    if (!latestData) return;
    updateShotClockDisplay(computeShotClock(latestData));
  }, 100);
}

function stopLiveClocks() {
  if (gameClockInterval) { clearInterval(gameClockInterval); gameClockInterval = null; }
  if (shotClockInterval) { clearInterval(shotClockInterval); shotClockInterval = null; }
}

// ========================================
// SCORE ANIMATION
// ========================================

function handleScoreChange(newHome, newAway) {
  if (newHome !== previousData.homeScore) triggerAnimation(elements.homeScore, "score-changed");
  if (newAway !== previousData.awayScore) triggerAnimation(elements.awayScore, "score-changed");
}

// ========================================
// FIREBASE CONNECTION STATE
// ========================================

const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, (snap) => {
  const isConnected = snap.val() === true;
  elements.liveIndicator?.classList.toggle("disconnected", !isConnected);
  if (elements.liveText) elements.liveText.textContent = isConnected ? "LIVE" : "OFFLINE";
});

// ========================================
// FIREBASE SCOREBOARD LISTENER
// ========================================

const scoreboardRef = ref(db, "scoreboard");

onValue(scoreboardRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) { console.warn("No scoreboard data available"); return; }

  latestData = data;

  const buzzerAt = data.buzzerAt ?? null;
  const buzzerByTimestamp = buzzerAt !== null && buzzerAt !== previousData.buzzerAt;
  const buzzerByRisingEdge = data.buzzer === true && previousData.buzzer !== true;
  if (buzzerByTimestamp || buzzerByRisingEdge) {
    const buzzerSeconds = Number(data.buzzerDuration ?? 1.8);
    const safeBuzzerSeconds = Number.isFinite(buzzerSeconds) && buzzerSeconds > 0 ? buzzerSeconds : 1.8;
    playBuzzer(safeBuzzerSeconds);
    triggerAnimation(elements.gameClock, "buzzer-flash", Math.round(safeBuzzerSeconds * 1000));
  }

  handleScoreChange(data.homeScore ?? 0, data.awayScore ?? 0);

  const homeFouls = Math.max(0, Number(data.homeFouls ?? 0));
  const awayFouls = Math.max(0, Number(data.awayFouls ?? 0));
  const period = Math.max(1, Number(data.period ?? 1));
  const maxPeriod = Math.max(1, Number(data.maxPeriod ?? DEFAULT_MAX_PERIOD));
  const timeoutLimit = getTimeoutAllowance(period, maxPeriod);
  const homeTimeouts = Math.min(timeoutLimit, Math.max(0, Number(data.homeTimeouts ?? 0)));
  const awayTimeouts = Math.min(timeoutLimit, Math.max(0, Number(data.awayTimeouts ?? 0)));

  // Static values
  elements.homeScore.textContent = data.homeScore ?? 0;
  elements.awayScore.textContent = data.awayScore ?? 0;
  elements.homeFouls.textContent = formatFoulsDisplay(homeFouls);
  elements.awayFouls.textContent = formatFoulsDisplay(awayFouls);
  if (elements.homeTeamLabel) elements.homeTeamLabel.textContent = data.homeName ?? "HOME";
  if (elements.awayTeamLabel) elements.awayTeamLabel.textContent = data.awayName ?? "AWAY";
  if (elements.homeTimeouts) elements.homeTimeouts.textContent = homeTimeouts;
  if (elements.awayTimeouts) elements.awayTimeouts.textContent = awayTimeouts;

  // Dot indicators
  updateFoulDots(homeFouls, awayFouls);
  updateTimeoutDots(homeTimeouts, awayTimeouts, timeoutLimit);

  // Period / OT
  updatePeriodDisplay(data);

  // Clocks
  elements.gameClock.textContent = formatTime(computeGameClock(data));
  updateShotClockDisplay(computeShotClock(data));

  // State
  updateLeadingTeam(data.homeScore ?? 0, data.awayScore ?? 0);
  updatePossession(data.possession);
  updateGameStatus(data);

  if (data.clockRunning || data.shotClockRunning) {
    startLiveClocks();
  } else {
    stopLiveClocks();
  }

  previousData = {
    homeScore: data.homeScore ?? 0,
    awayScore: data.awayScore ?? 0,
    possession: data.possession,
    clockRunning: data.clockRunning,
    buzzer: data.buzzer,
    buzzerAt,
    status: data.status,
  };
});

// ========================================
// THEME TOGGLE
// ========================================

function initTheme() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("kiosk") === "true") {
    document.body.classList.add("kiosk-mode");
    if (elements.themeToggle) elements.themeToggle.style.display = "none";
  }
  const savedTheme = localStorage.getItem("scoreboard-theme") || "dark";
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(`theme-${savedTheme}`);
}

function toggleTheme() {
  if (document.body.classList.contains("kiosk-mode")) return;
  const newTheme = document.body.classList.contains("theme-dark") ? "light" : "dark";
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(`theme-${newTheme}`);
  localStorage.setItem("scoreboard-theme", newTheme);
  triggerAnimation(elements.themeToggle, "theme-change", 300);
}

// ========================================
// EVENT LISTENERS
// ========================================

elements.themeToggle?.addEventListener("click", toggleTheme);

document.addEventListener("keydown", (e) => {
  if (e.key === "t" || e.key === "T") toggleTheme();
  if (e.key === "f" || e.key === "F") {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
});

// ========================================
// INIT
// ========================================

initTheme();

// ========================================
// ANIMATION STYLES
// ========================================

const style = document.createElement("style");
style.textContent = `
  .theme-toggle.theme-change {
    animation: themeChangeAnim 0.3s ease;
  }
  @keyframes themeChangeAnim {
    0%, 100% { transform: rotate(0deg) scale(1); }
    50% { transform: rotate(180deg) scale(0.9); }
  }
  .team-section.possession-change {
    animation: possessionChange 0.4s ease-out;
  }
  @keyframes possessionChange {
    0% { transform: scale(1); }
    50% { transform: scale(1.03); }
    100% { transform: scale(1.02); }
  }
  .clock-display.buzzer-flash {
    animation: buzzerFlash 1.8s ease-out;
  }
  @keyframes buzzerFlash {
    0%   { color: #fff; text-shadow: 0 0 80px #fff, 0 0 120px var(--accent-primary); }
    15%  { color: var(--accent-primary); }
    30%  { color: #fff; }
    50%  { color: var(--accent-primary); text-shadow: 0 0 60px var(--accent-glow); }
    100% { color: inherit; text-shadow: inherit; }
  }
`;
document.head.appendChild(style);
