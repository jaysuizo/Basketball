import { db } from "./firebase.js?v=20260228-1";
import {
  onValue,
  ref,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const SCOREBOARD_PATH = "scoreboard";
const scoreboardRef = ref(db, SCOREBOARD_PATH);
const offsetRef = ref(db, ".info/serverTimeOffset");
const controlLockRef = ref(db, "controlLock");

const GAME_DURATION = 600;
const OVERTIME_DURATION = 300;
const DEFAULT_SHOT = 24;
const DEFAULT_MAX_PERIOD = 4;
const MAX_TEAM_FOULS = 5;
const GAME_ZERO_BUZZER_SECONDS = 3;
const SHOT_ZERO_BUZZER_SECONDS = 1;
const LOCK_TTL_MS = 10000;
const LOCK_HEARTBEAT_MS = 3000;
const NAME_AUTOSAVE_DELAY_MS = 350;
const TIME_NUDGE_SECONDS = 60;
const MAX_GAME_SECONDS = 15 * 60;
const CANVAS_PRESETS = [
  { name: "xl", width: 1600, height: 900, minWidth: 1760, minHeight: 900 },
  { name: "lg", width: 1536, height: 864, minWidth: 1450, minHeight: 760 },
  { name: "md", width: 1366, height: 768, minWidth: 1160, minHeight: 650 },
  { name: "sm", width: 1200, height: 675, minWidth: 900, minHeight: 500 },
  { name: "xs", width: 1024, height: 576, minWidth: 0, minHeight: 0 },
];
const CANVAS_SIZE_CLASSES = ["canvas-xl", "canvas-lg", "canvas-md", "canvas-sm", "canvas-xs"];
const MIN_CANVAS_SCALE = 0.3;
const CANVAS_GUTTER_PX = 10;
const ALWAYS_ENABLED_KEYS = new Set([
  "homeName",
  "awayName",
  "homeAdd1",
  "homeAdd2",
  "homeAdd3",
  "awayAdd1",
  "awayAdd2",
  "awayAdd3",
]);

function getTimeoutAllowance(period, maxPeriod = DEFAULT_MAX_PERIOD) {
  const safePeriod = Math.max(1, Number(period) || 1);
  const safeMaxPeriod = Math.max(1, Number(maxPeriod) || DEFAULT_MAX_PERIOD);
  if (safePeriod > safeMaxPeriod) return 1;
  if (safePeriod === safeMaxPeriod) return 2;
  return 1;
}

function getTimeoutLimitFromState(state = latest) {
  const period = Math.max(1, Number(state?.period ?? 1));
  const maxPeriod = Math.max(1, Number(state?.maxPeriod ?? DEFAULT_MAX_PERIOD));
  return getTimeoutAllowance(period, maxPeriod);
}

const el = (id) => document.getElementById(id);
const elements = {
  controlText: el("controlText"),
  statusText: el("statusText"),
  timerText: el("timerText"),
  shotClockText: el("shotClockText"),
  homeName: el("homeName"),
  awayName: el("awayName"),
  homeScore: el("homeScore"),
  awayScore: el("awayScore"),
  homeFouls: el("homeFouls"),
  awayFouls: el("awayFouls"),
  homeTimeouts: el("homeTimeouts"),
  awayTimeouts: el("awayTimeouts"),
  quarterSelect: el("quarterSelect"),
  gameMinutesInput: el("gameMinutesInput"),
  gameSecondsInput: el("gameSecondsInput"),
  applyTimeBtn: el("applyTimeBtn"),
  homeApplyTimeBtn: el("homeApplyTimeBtn"),
  homeTimeMinusBtn: el("homeTimeMinusBtn"),
  homeTimePlusBtn: el("homeTimePlusBtn"),
  gameToggleBtn: el("gameToggleBtn"),
  resetGameBtn: el("resetGameBtn"),
  endGameBtn: el("endGameBtn"),
  shotToggleBtn: el("shotToggleBtn"),
  shot14Btn: el("shot14Btn"),
  shot24Btn: el("shot24Btn"),
  posHomeBtn: el("posHomeBtn"),
  posNoneBtn: el("posNoneBtn"),
  posAwayBtn: el("posAwayBtn"),
  homeScoreMinus: el("homeScoreMinus"),
  homeScorePlus: el("homeScorePlus"),
  homeAdd1: el("homeAdd1"),
  homeAdd2: el("homeAdd2"),
  homeAdd3: el("homeAdd3"),
  awayScoreMinus: el("awayScoreMinus"),
  awayScorePlus: el("awayScorePlus"),
  awayAdd1: el("awayAdd1"),
  awayAdd2: el("awayAdd2"),
  awayAdd3: el("awayAdd3"),
  homeFoulMinus: el("homeFoulMinus"),
  homeFoulPlus: el("homeFoulPlus"),
  awayFoulMinus: el("awayFoulMinus"),
  awayFoulPlus: el("awayFoulPlus"),
  homeTimeoutMinus: el("homeTimeoutMinus"),
  homeTimeoutPlus: el("homeTimeoutPlus"),
  awayTimeoutMinus: el("awayTimeoutMinus"),
  awayTimeoutPlus: el("awayTimeoutPlus"),
  resetAllBtn: el("resetAllBtn"),
  fullscreenBtn: el("fullscreenBtn"),
  landscapeOverlay: el("landscapeOverlay"),
  scoreboardContainer: document.querySelector(".scoreboard-container"),
};

let latest = null;
let serverTimeOffset = 0;
const controllerId = `ctrl-${Math.random().toString(36).slice(2, 10)}`;
let hasControl = false;
let lockTimer = null;
let nameAutosaveTimer = null;
let scaleRaf = null;
let timeoutSyncPeriodKey = null;
const nameDraft = {
  home: null,
  away: null,
};

function registerControllerPwa() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker-controller.js")
      .catch((error) => {
        console.warn("Service worker registration failed:", error);
      });
  });
}

function now() {
  return Date.now() + serverTimeOffset;
}

function setControlsEnabled(enabled) {
  Object.entries(elements).forEach(([key, node]) => {
    if (!node) return;
    if (!(node instanceof HTMLButtonElement) && !(node instanceof HTMLInputElement) && !(node instanceof HTMLSelectElement)) {
      return;
    }
    if (
      key === "controlText" ||
      key === "statusText" ||
      key === "timerText" ||
      key === "shotClockText" ||
      key === "fullscreenBtn" ||
      key === "gameMinutesInput" ||
      key === "gameSecondsInput" ||
      key === "applyTimeBtn" ||
      ALWAYS_ENABLED_KEYS.has(key)
    ) return;
    node.disabled = !enabled;
  });
}

function updateControlText() {
  if (!elements.controlText) return;
  elements.controlText.textContent = hasControl
    ? "CONTROL: ACTIVE"
    : "CONTROL: READ ONLY";
  elements.controlText.style.color = hasControl ? "#22c55e" : "#f59e0b";
}

function updateFullscreenUi() {
  const active = !!document.fullscreenElement;
  document.body.classList.toggle("is-fullscreen", active);
  if (elements.fullscreenBtn) {
    elements.fullscreenBtn.textContent = active ? "Exit Full Screen" : "Full Screen";
  }
  refreshViewportLayout();
}

async function toggleFullscreen() {
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) {
        await root.requestFullscreen();
      }
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (_) {
    // ignore unsupported environments
  } finally {
    updateFullscreenUi();
    tryLockLandscapeOrientation();
  }
}

function isPortraitViewport() {
  const orientationType = screen.orientation?.type;
  if (typeof orientationType === "string") {
    return orientationType.startsWith("portrait");
  }

  const orientationMedia = window.matchMedia?.("(orientation: portrait)");
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const byDimensions = viewportHeight > viewportWidth;

  if (orientationMedia && typeof orientationMedia.matches === "boolean") {
    return orientationMedia.matches === byDimensions
      ? orientationMedia.matches
      : byDimensions;
  }
  return byDimensions;
}

function readSafeInset(name) {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name)
  );
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function applyOrientationUiState() {
  const isPortrait = isPortraitViewport();
  document.body.classList.toggle("portrait-blocked", isPortrait);
  if (elements.landscapeOverlay) {
    elements.landscapeOverlay.setAttribute("aria-hidden", isPortrait ? "false" : "true");
  }
}

async function tryLockLandscapeOrientation() {
  if (!screen.orientation?.lock) return;
  try {
    await screen.orientation.lock("landscape");
  } catch (_) {
    // browsers can require fullscreen or user gesture
  }
}

function applyControllerCanvasScale() {
  const canvas = elements.scoreboardContainer;
  if (!canvas) return;

  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const safeTop = readSafeInset("--safe-top");
  const safeRight = readSafeInset("--safe-right");
  const safeBottom = readSafeInset("--safe-bottom");
  const safeLeft = readSafeInset("--safe-left");
  const preset = CANVAS_PRESETS.find((item) => viewportWidth >= item.minWidth && viewportHeight >= item.minHeight)
    ?? CANVAS_PRESETS[CANVAS_PRESETS.length - 1];

  const availableWidth = Math.max(
    1,
    viewportWidth - safeLeft - safeRight - CANVAS_GUTTER_PX * 2
  );
  const availableHeight = Math.max(
    1,
    viewportHeight - safeTop - safeBottom - CANVAS_GUTTER_PX * 2
  );
  const scale = Math.min(
    availableWidth / preset.width,
    availableHeight / preset.height,
    1
  );
  const clampedScale = Math.max(MIN_CANVAS_SCALE, scale);
  const scaledWidth = preset.width * clampedScale;
  const scaledHeight = preset.height * clampedScale;
  const offsetX = safeLeft + CANVAS_GUTTER_PX + Math.max(0, (availableWidth - scaledWidth) / 2);
  const offsetY = safeTop + CANVAS_GUTTER_PX + Math.max(0, (availableHeight - scaledHeight) / 2);
  const tinyDevice = clampedScale < 0.56 || viewportHeight < 430;

  canvas.style.width = `${preset.width}px`;
  canvas.style.height = `${preset.height}px`;
  canvas.style.left = `${offsetX}px`;
  canvas.style.top = `${offsetY}px`;
  canvas.style.transformOrigin = "top left";
  canvas.style.transform = `scale(${clampedScale})`;
  document.body.classList.remove(...CANVAS_SIZE_CLASSES);
  document.body.classList.add(`canvas-${preset.name}`);
  document.body.classList.toggle("tiny-device", tinyDevice);
}

function queueControllerCanvasScale() {
  if (scaleRaf !== null) {
    cancelAnimationFrame(scaleRaf);
  }
  scaleRaf = requestAnimationFrame(() => {
    scaleRaf = null;
    applyControllerCanvasScale();
  });
}

function refreshViewportLayout() {
  applyOrientationUiState();
  queueControllerCanvasScale();
}

function paintBodyState(data) {
  const isEnded = data.status === "ended";
  const isRunning = data.clockRunning === true && !isEnded;
  document.body.classList.toggle("running", isRunning);
  document.body.classList.toggle("paused", !isRunning && !isEnded);
  document.body.classList.toggle("game-ended", isEnded);
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatFoulsDisplay(value) {
  const safe = Math.max(0, Number(value ?? 0));
  return safe >= MAX_TEAM_FOULS ? "P" : `${safe}`;
}

function getGameRemaining(data) {
  const duration = data.gameDuration ?? GAME_DURATION;
  const elapsed = data.elapsedBeforePause ?? 0;
  if (data.clockRunning && data.clockStartedAt) {
    const add = (now() - data.clockStartedAt) / 1000;
    return Math.max(0, duration - elapsed - add);
  }
  return Math.max(0, duration - elapsed);
}

function getShotRemaining(data) {
  const duration = data.shotPartialReset ?? data.shotDuration ?? DEFAULT_SHOT;
  const elapsed = data.shotElapsedBeforePause ?? 0;
  if (data.shotClockRunning && data.shotStartedAt) {
    const add = (now() - data.shotStartedAt) / 1000;
    return Math.max(0, duration - elapsed - add);
  }
  return Math.max(0, duration - elapsed);
}

function buildZeroTimeTransition(current) {
  const eventTime = now();
  const period = Number(current.period ?? 1);
  const maxPeriod = Number(current.maxPeriod ?? DEFAULT_MAX_PERIOD);
  const hasNextQuarter = period < maxPeriod;
  const homeScore = Number(current.homeScore ?? 0);
  const awayScore = Number(current.awayScore ?? 0);
  const isTie = homeScore === awayScore;

  if (hasNextQuarter) {
    const nextPeriod = period + 1;
    const nextTimeouts = getTimeoutAllowance(nextPeriod, maxPeriod);
    return {
      ...current,
      period: nextPeriod,
      homeTimeouts: nextTimeouts,
      awayTimeouts: nextTimeouts,
      gameDuration: GAME_DURATION,
      elapsedBeforePause: 0,
      clockStartedAt: null,
      clockRunning: false,
      shotDuration: DEFAULT_SHOT,
      shotPartialReset: DEFAULT_SHOT,
      shotElapsedBeforePause: 0,
      shotClockRunning: false,
      shotStartedAt: null,
      status: "paused",
      buzzer: true,
      buzzerDuration: GAME_ZERO_BUZZER_SECONDS,
      buzzerAt: eventTime,
      lastUpdated: eventTime,
    };
  }

  if (isTie) {
    const nextOvertime = Number(current.overtime ?? 0) + 1;
    const nextPeriod = maxPeriod + nextOvertime;
    const nextTimeouts = getTimeoutAllowance(nextPeriod, maxPeriod);
    return {
      ...current,
      overtime: nextOvertime,
      period: nextPeriod,
      homeTimeouts: nextTimeouts,
      awayTimeouts: nextTimeouts,
      gameDuration: OVERTIME_DURATION,
      elapsedBeforePause: 0,
      clockStartedAt: null,
      clockRunning: false,
      shotDuration: DEFAULT_SHOT,
      shotPartialReset: DEFAULT_SHOT,
      shotElapsedBeforePause: 0,
      shotClockRunning: false,
      shotStartedAt: null,
      status: "paused",
      buzzer: true,
      buzzerDuration: GAME_ZERO_BUZZER_SECONDS,
      buzzerAt: eventTime,
      lastUpdated: eventTime,
    };
  }

  return {
    ...current,
    clockRunning: false,
    clockStartedAt: null,
    shotClockRunning: false,
    shotStartedAt: null,
    status: "ended",
    buzzer: true,
    buzzerDuration: GAME_ZERO_BUZZER_SECONDS,
    buzzerAt: eventTime,
    lastUpdated: eventTime,
  };
}

async function ensureScoreboardExists() {
  const snapshot = await new Promise((resolve) => onValue(scoreboardRef, resolve, { onlyOnce: true }));
  if (snapshot.exists()) return;
  const initialTimeouts = getTimeoutAllowance(1, DEFAULT_MAX_PERIOD);
  await set(scoreboardRef, {
    homeName: "HOME",
    awayName: "AWAY",
    homeScore: 0,
    awayScore: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeTimeouts: initialTimeouts,
    awayTimeouts: initialTimeouts,
    period: 1,
    maxPeriod: DEFAULT_MAX_PERIOD,
    overtime: 0,
    gameDuration: GAME_DURATION,
    elapsedBeforePause: 0,
    clockStartedAt: null,
    clockRunning: false,
    shotDuration: DEFAULT_SHOT,
    shotPartialReset: DEFAULT_SHOT,
    shotElapsedBeforePause: 0,
    shotStartedAt: null,
    shotClockRunning: false,
    possession: "none",
    status: "paused",
    buzzer: false,
    buzzerDuration: 0,
    buzzerAt: null,
    lastUpdated: now(),
  });
}

function paint(data) {
  const homeFouls = Math.max(0, Number(data.homeFouls ?? 0));
  const awayFouls = Math.max(0, Number(data.awayFouls ?? 0));
  const timeoutLimit = getTimeoutLimitFromState(data);
  const homeTimeouts = Math.min(timeoutLimit, Math.max(0, Number(data.homeTimeouts ?? 0)));
  const awayTimeouts = Math.min(timeoutLimit, Math.max(0, Number(data.awayTimeouts ?? 0)));

  elements.homeScore.textContent = `${data.homeScore ?? 0}`;
  elements.awayScore.textContent = `${data.awayScore ?? 0}`;
  if (elements.homeFouls) elements.homeFouls.textContent = formatFoulsDisplay(homeFouls);
  if (elements.awayFouls) elements.awayFouls.textContent = formatFoulsDisplay(awayFouls);
  if (elements.homeTimeouts) elements.homeTimeouts.textContent = `${homeTimeouts}`;
  if (elements.awayTimeouts) elements.awayTimeouts.textContent = `${awayTimeouts}`;
  elements.timerText.textContent = formatClock(getGameRemaining(data));
  elements.shotClockText.textContent = `${Math.ceil(getShotRemaining(data))}`;

  if (nameDraft.home !== null) {
    elements.homeName.value = nameDraft.home;
  } else if (document.activeElement !== elements.homeName) {
    elements.homeName.value = data.homeName ?? "HOME";
  }

  if (nameDraft.away !== null) {
    elements.awayName.value = nameDraft.away;
  } else if (document.activeElement !== elements.awayName) {
    elements.awayName.value = data.awayName ?? "AWAY";
  }

  const period = String(data.period ?? 1);
  if (elements.quarterSelect.value !== period) {
    elements.quarterSelect.value = period;
  }
  if (elements.posNoneBtn) {
    elements.posNoneBtn.textContent = `QTR ${period}`;
  }

  if (elements.homeTimeoutPlus) {
    elements.homeTimeoutPlus.disabled = !hasControl || homeTimeouts >= timeoutLimit;
  }
  if (elements.awayTimeoutPlus) {
    elements.awayTimeoutPlus.disabled = !hasControl || awayTimeouts >= timeoutLimit;
  }
  if (elements.homeTimeoutMinus) {
    elements.homeTimeoutMinus.disabled = !hasControl || homeTimeouts <= 0;
  }
  if (elements.awayTimeoutMinus) {
    elements.awayTimeoutMinus.disabled = !hasControl || awayTimeouts <= 0;
  }

  const remaining = getGameRemaining(data);
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);
  if (elements.gameMinutesInput && document.activeElement !== elements.gameMinutesInput) {
    elements.gameMinutesInput.value = `${minutes}`;
  }
  if (elements.gameSecondsInput && document.activeElement !== elements.gameSecondsInput) {
    elements.gameSecondsInput.value = `${seconds}`;
  }

  const status = (data.status ?? "paused").toUpperCase();
  elements.statusText.textContent = status;
  paintBodyState(data);
  paintPossession(data.possession ?? "none");

  elements.gameToggleBtn.textContent = data.clockRunning ? "PAUSE" : "START";
  const shotBase = Math.round(data.shotPartialReset ?? data.shotDuration ?? DEFAULT_SHOT);
  elements.shotToggleBtn.textContent = data.shotClockRunning ? "PAUSE SHOT" : `SHOT +- CLOCK ${shotBase}`;
}

function paintPossession(possession) {
  elements.posHomeBtn?.classList.toggle("active-home", possession === "home");
  elements.posNoneBtn?.classList.toggle("active-none", possession === "none" || !possession);
  elements.posAwayBtn?.classList.toggle("active-away", possession === "away");
}

async function setPossession(possession) {
  if (!hasControl) return;
  await update(scoreboardRef, {
    possession,
    lastUpdated: now(),
  });
}

async function mutateNumber(path, delta, min = 0, max = Number.POSITIVE_INFINITY, requireControl = true) {
  if (requireControl && !hasControl) return;
  await runTransaction(ref(db, `${SCOREBOARD_PATH}/${path}`), (current) => {
    const next = (current ?? 0) + delta;
    const bounded = Math.max(min, Math.min(max, next));
    return bounded;
  });
}

async function mutateTimeout(path, delta) {
  if (!hasControl) return;
  await runTransaction(scoreboardRef, (current) => {
    if (!current) return current;
    const timeoutLimit = getTimeoutLimitFromState(current);
    const currentValue = Math.max(0, Number(current[path] ?? 0));
    const nextValue = Math.max(0, Math.min(timeoutLimit, currentValue + delta));
    return {
      ...current,
      [path]: nextValue,
      lastUpdated: now(),
    };
  });
}

async function saveNames() {
  const homeName = (nameDraft.home ?? elements.homeName.value).trim().toUpperCase() || "HOME";
  const awayName = (nameDraft.away ?? elements.awayName.value).trim().toUpperCase() || "AWAY";
  if (latest && homeName === (latest.homeName ?? "HOME") && awayName === (latest.awayName ?? "AWAY")) {
    nameDraft.home = null;
    nameDraft.away = null;
    return;
  }
  await update(scoreboardRef, {
    homeName,
    awayName,
    lastUpdated: now(),
  });
  nameDraft.home = null;
  nameDraft.away = null;
}

function clearNameAutosaveTimer() {
  if (nameAutosaveTimer) {
    clearTimeout(nameAutosaveTimer);
    nameAutosaveTimer = null;
  }
}

function queueNameAutosave() {
  clearNameAutosaveTimer();
  nameAutosaveTimer = setTimeout(() => {
    nameAutosaveTimer = null;
    saveNames().catch((error) => {
      console.error("Name auto-save failed:", error);
    });
  }, NAME_AUTOSAVE_DELAY_MS);
}

async function flushNameAutosave() {
  clearNameAutosaveTimer();
  await saveNames();
}

async function setQuarter() {
  if (!hasControl) return;
  const selectedPeriod = Number(elements.quarterSelect.value) || 1;
  const quarterTimeouts = getTimeoutAllowance(selectedPeriod, DEFAULT_MAX_PERIOD);
  await update(scoreboardRef, {
    period: selectedPeriod,
    homeTimeouts: quarterTimeouts,
    awayTimeouts: quarterTimeouts,
    maxPeriod: DEFAULT_MAX_PERIOD,
    overtime: 0,
    lastUpdated: now(),
  });
}

async function syncTimeoutAllowanceForPeriod(data = latest) {
  if (!hasControl || !data) return;
  const period = Math.max(1, Number(data.period ?? 1));
  const maxPeriod = Math.max(1, Number(data.maxPeriod ?? DEFAULT_MAX_PERIOD));
  const periodKey = `${period}:${maxPeriod}`;
  if (timeoutSyncPeriodKey === periodKey) return;

  const targetTimeouts = getTimeoutAllowance(period, maxPeriod);
  const parsedHome = Number(data.homeTimeouts);
  const parsedAway = Number(data.awayTimeouts);
  const nextHomeTimeouts = Number.isFinite(parsedHome)
    ? Math.max(0, Math.min(targetTimeouts, parsedHome))
    : targetTimeouts;
  const nextAwayTimeouts = Number.isFinite(parsedAway)
    ? Math.max(0, Math.min(targetTimeouts, parsedAway))
    : targetTimeouts;

  if (nextHomeTimeouts === parsedHome && nextAwayTimeouts === parsedAway) {
    timeoutSyncPeriodKey = periodKey;
    return;
  }

  await update(scoreboardRef, {
    homeTimeouts: nextHomeTimeouts,
    awayTimeouts: nextAwayTimeouts,
    lastUpdated: now(),
  });
  timeoutSyncPeriodKey = periodKey;
}

async function toggleGameClock() {
  if (!hasControl) return;
  await runTransaction(scoreboardRef, (current) => {
    if (!current) return current;
    const state = { ...current };
    const remaining = getGameRemaining(state);

    if (state.clockRunning) {
      state.elapsedBeforePause = (state.elapsedBeforePause ?? 0) + ((now() - (state.clockStartedAt ?? now())) / 1000);
      state.clockRunning = false;
      state.clockStartedAt = null;
      if (state.shotClockRunning) {
        state.shotElapsedBeforePause =
          (state.shotElapsedBeforePause ?? 0) + ((now() - (state.shotStartedAt ?? now())) / 1000);
      }
      state.shotClockRunning = false;
      state.shotStartedAt = null;
      if (remaining <= 0) {
        return buildZeroTimeTransition(state);
      }
      state.status = "paused";
    } else {
      if (remaining <= 0) {
        return buildZeroTimeTransition(state);
      }
      if (state.status === "ended") {
        return state;
      }
      state.clockStartedAt = now();
      state.clockRunning = true;
      const shotRemaining = getShotRemaining(state);
      if (shotRemaining > 0) {
        state.shotStartedAt = now();
        state.shotClockRunning = true;
      }
      state.status = "running";
    }
    state.lastUpdated = now();
    return state;
  });
}

async function resetGameClock() {
  if (!hasControl) return;
  await update(scoreboardRef, {
    gameDuration: GAME_DURATION,
    elapsedBeforePause: 0,
    clockStartedAt: null,
    clockRunning: false,
    shotDuration: DEFAULT_SHOT,
    shotPartialReset: DEFAULT_SHOT,
    shotElapsedBeforePause: 0,
    shotClockRunning: false,
    shotStartedAt: null,
    status: "paused",
    buzzer: false,
    lastUpdated: now(),
  });
}

function parseGameInputSeconds() {
  if (!elements.gameMinutesInput || !elements.gameSecondsInput) {
    return latest ? Math.ceil(getGameRemaining(latest)) : GAME_DURATION;
  }
  const minutesRaw = Number(elements.gameMinutesInput?.value ?? 10);
  const secondsRaw = Number(elements.gameSecondsInput?.value ?? 0);
  if (!Number.isFinite(minutesRaw) || !Number.isFinite(secondsRaw)) {
    return null;
  }
  return Math.floor(minutesRaw * 60 + secondsRaw);
}

function clampGameSeconds(totalSeconds) {
  return Math.max(1, Math.min(MAX_GAME_SECONDS, Math.floor(totalSeconds)));
}

function syncGameTimeInputs(totalSeconds) {
  const safeSeconds = clampGameSeconds(totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (elements.gameMinutesInput) elements.gameMinutesInput.value = `${minutes}`;
  if (elements.gameSecondsInput) elements.gameSecondsInput.value = `${seconds}`;
}

async function applyGameTime(overrideSeconds = null) {
  const inputSeconds = Number.isFinite(overrideSeconds)
    ? Number(overrideSeconds)
    : parseGameInputSeconds();
  if (inputSeconds === null) {
    alert("Invalid time value.");
    return;
  }

  const totalSeconds = clampGameSeconds(inputSeconds);
  syncGameTimeInputs(totalSeconds);
  const wasRunning = latest?.clockRunning === true;
  const payload = {
    gameDuration: totalSeconds,
    elapsedBeforePause: 0,
    clockStartedAt: wasRunning ? now() : null,
    clockRunning: wasRunning,
    status: wasRunning ? "running" : "paused",
    buzzer: false,
    lastUpdated: now(),
  };

  try {
    await update(scoreboardRef, payload);
    if (latest) {
      latest = { ...latest, ...payload };
      paint(latest);
    }
  } catch (error) {
    console.error("Set Time failed:", error);
    alert("Set Time failed. Check Firebase connection/rules.");
  }
}

async function nudgeGameTime(deltaSeconds) {
  const baseSeconds = latest ? Math.ceil(getGameRemaining(latest)) : GAME_DURATION;
  const nextSeconds = clampGameSeconds(baseSeconds + deltaSeconds);
  syncGameTimeInputs(nextSeconds);
  await applyGameTime(nextSeconds);
}

async function endGame() {
  if (!hasControl) return;
  await update(scoreboardRef, {
    clockRunning: false,
    clockStartedAt: null,
    shotClockRunning: false,
    shotStartedAt: null,
    status: "ended",
    lastUpdated: now(),
  });
}

async function resetAll() {
  if (!hasControl) return;
  const initialTimeouts = getTimeoutAllowance(1, DEFAULT_MAX_PERIOD);
  await set(scoreboardRef, {
    homeName: "HOME",
    awayName: "AWAY",
    homeScore: 0,
    awayScore: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeTimeouts: initialTimeouts,
    awayTimeouts: initialTimeouts,
    period: 1,
    maxPeriod: DEFAULT_MAX_PERIOD,
    overtime: 0,
    gameDuration: GAME_DURATION,
    elapsedBeforePause: 0,
    clockStartedAt: null,
    clockRunning: false,
    shotDuration: DEFAULT_SHOT,
    shotPartialReset: DEFAULT_SHOT,
    shotElapsedBeforePause: 0,
    shotStartedAt: null,
    shotClockRunning: false,
    possession: "none",
    status: "paused",
    buzzer: false,
    buzzerDuration: 0,
    buzzerAt: null,
    lastUpdated: now(),
  });
}

async function setShotDuration(duration) {
  if (!hasControl) return;
  await update(scoreboardRef, {
    shotDuration: duration,
    shotPartialReset: duration,
    shotElapsedBeforePause: 0,
    shotStartedAt: null,
    shotClockRunning: false,
    lastUpdated: now(),
  });
}

async function toggleShotClock() {
  if (!hasControl) return;
  await runTransaction(scoreboardRef, (current) => {
    if (!current) return current;
    const state = { ...current };
    const remaining = getShotRemaining(state);

    if (state.shotClockRunning) {
      state.shotElapsedBeforePause =
        (state.shotElapsedBeforePause ?? 0) + ((now() - (state.shotStartedAt ?? now())) / 1000);
      state.shotClockRunning = false;
      state.shotStartedAt = null;
    } else if (remaining > 0) {
      state.shotStartedAt = now();
      state.shotClockRunning = true;
    }

    state.lastUpdated = now();
    return state;
  });
}

function bindEvents() {
  elements.homeName.addEventListener("input", (e) => {
    const nextValue = String(e.target.value ?? "").toUpperCase();
    if (e.target.value !== nextValue) {
      e.target.value = nextValue;
    }
    nameDraft.home = nextValue;
    queueNameAutosave();
  });
  elements.awayName.addEventListener("input", (e) => {
    const nextValue = String(e.target.value ?? "").toUpperCase();
    if (e.target.value !== nextValue) {
      e.target.value = nextValue;
    }
    nameDraft.away = nextValue;
    queueNameAutosave();
  });
  elements.homeName.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    flushNameAutosave().catch((error) => {
      console.error("Name auto-save failed:", error);
    });
  });
  elements.awayName.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    flushNameAutosave().catch((error) => {
      console.error("Name auto-save failed:", error);
    });
  });
  elements.homeName.addEventListener("blur", () => {
    flushNameAutosave().catch((error) => {
      console.error("Name auto-save failed:", error);
    });
  });
  elements.awayName.addEventListener("blur", () => {
    flushNameAutosave().catch((error) => {
      console.error("Name auto-save failed:", error);
    });
  });
  elements.quarterSelect.addEventListener("change", setQuarter);
  elements.applyTimeBtn?.addEventListener("click", applyGameTime);
  elements.homeApplyTimeBtn?.addEventListener("click", applyGameTime);
  elements.homeTimeMinusBtn?.addEventListener("click", () => nudgeGameTime(-TIME_NUDGE_SECONDS));
  elements.homeTimePlusBtn?.addEventListener("click", () => nudgeGameTime(TIME_NUDGE_SECONDS));
  elements.gameToggleBtn.addEventListener("click", toggleGameClock);
  elements.resetGameBtn?.addEventListener("click", resetGameClock);
  elements.endGameBtn?.addEventListener("click", endGame);
  elements.shotToggleBtn.addEventListener("click", toggleShotClock);
  elements.shot14Btn.addEventListener("click", () => setShotDuration(14));
  elements.shot24Btn.addEventListener("click", () => setShotDuration(24));
  elements.posHomeBtn.addEventListener("click", () => setPossession("home"));
  elements.posNoneBtn.addEventListener("click", () => setPossession("none"));
  elements.posAwayBtn.addEventListener("click", () => setPossession("away"));
  elements.resetAllBtn.addEventListener("click", resetAll);

  elements.homeScoreMinus.addEventListener("click", () => mutateNumber("homeScore", -1));
  elements.homeScorePlus.addEventListener("click", () => mutateNumber("homeScore", 1));
  elements.homeAdd1.addEventListener("click", () => mutateNumber("homeScore", 1, 0, Number.POSITIVE_INFINITY, false));
  elements.homeAdd2.addEventListener("click", () => mutateNumber("homeScore", 2, 0, Number.POSITIVE_INFINITY, false));
  elements.homeAdd3.addEventListener("click", () => mutateNumber("homeScore", 3, 0, Number.POSITIVE_INFINITY, false));
  elements.awayScoreMinus.addEventListener("click", () => mutateNumber("awayScore", -1));
  elements.awayScorePlus.addEventListener("click", () => mutateNumber("awayScore", 1));
  elements.awayAdd1.addEventListener("click", () => mutateNumber("awayScore", 1, 0, Number.POSITIVE_INFINITY, false));
  elements.awayAdd2.addEventListener("click", () => mutateNumber("awayScore", 2, 0, Number.POSITIVE_INFINITY, false));
  elements.awayAdd3.addEventListener("click", () => mutateNumber("awayScore", 3, 0, Number.POSITIVE_INFINITY, false));

  elements.homeFoulMinus.addEventListener("click", () => mutateNumber("homeFouls", -1, 0, MAX_TEAM_FOULS));
  elements.homeFoulPlus.addEventListener("click", () => mutateNumber("homeFouls", 1, 0, MAX_TEAM_FOULS));
  elements.awayFoulMinus.addEventListener("click", () => mutateNumber("awayFouls", -1, 0, MAX_TEAM_FOULS));
  elements.awayFoulPlus.addEventListener("click", () => mutateNumber("awayFouls", 1, 0, MAX_TEAM_FOULS));

  elements.homeTimeoutMinus.addEventListener("click", () => mutateTimeout("homeTimeouts", -1));
  elements.homeTimeoutPlus.addEventListener("click", () => mutateTimeout("homeTimeouts", 1));
  elements.awayTimeoutMinus.addEventListener("click", () => mutateTimeout("awayTimeouts", -1));
  elements.awayTimeoutPlus.addEventListener("click", () => mutateTimeout("awayTimeouts", 1));
  elements.fullscreenBtn?.addEventListener("click", toggleFullscreen);

  document.addEventListener("fullscreenchange", updateFullscreenUi);
  document.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") toggleFullscreen();
  });
  window.addEventListener("resize", refreshViewportLayout);
  window.addEventListener("orientationchange", refreshViewportLayout);
  window.visualViewport?.addEventListener("resize", refreshViewportLayout);
  screen.orientation?.addEventListener?.("change", refreshViewportLayout);
  document.addEventListener(
    "pointerdown",
    () => {
      tryLockLandscapeOrientation();
    },
    { once: true }
  );
}

function startLocalRefresh() {
  setInterval(async () => {
    if (!latest) return;
    if (!hasControl) {
      paint(latest);
      return;
    }

    if (latest.clockRunning && getGameRemaining(latest) <= 0) {
      await runTransaction(scoreboardRef, (current) => {
        if (!current) return current;
        if (current.clockRunning !== true) return current;
        return buildZeroTimeTransition(current);
      });
      return;
    }

    if (latest.shotClockRunning && getShotRemaining(latest) <= 0) {
      const eventTime = now();
      await update(scoreboardRef, {
        shotClockRunning: false,
        shotStartedAt: null,
        buzzer: true,
        buzzerDuration: SHOT_ZERO_BUZZER_SECONDS,
        buzzerAt: eventTime,
        lastUpdated: eventTime,
      });
      return;
    }

    paint(latest);
  }, 150);
}

async function tryAcquireLock() {
  try {
    const tx = await runTransaction(controlLockRef, (current) => {
      const currentTime = now();
      if (!current || !current.owner || !current.timestamp || currentTime - current.timestamp > LOCK_TTL_MS) {
        return { owner: controllerId, timestamp: currentTime };
      }
      if (current.owner === controllerId) {
        return { owner: controllerId, timestamp: currentTime };
      }
      return current;
    });

    const owner = tx.snapshot?.val()?.owner ?? null;
    hasControl = owner === controllerId;
  } catch (_) {
    hasControl = false;
  }
  setControlsEnabled(hasControl);
  updateControlText();
  if (hasControl && latest) {
    syncTimeoutAllowanceForPeriod(latest).catch((error) => {
      console.error("Timeout allocation sync failed:", error);
    });
  }
}

function startLockHeartbeat() {
  stopLockHeartbeat();
  lockTimer = setInterval(async () => {
    await tryAcquireLock();
  }, LOCK_HEARTBEAT_MS);
}

function stopLockHeartbeat() {
  if (!lockTimer) return;
  clearInterval(lockTimer);
  lockTimer = null;
}

async function releaseLock() {
  try {
    await runTransaction(controlLockRef, (current) => {
      if (!current || current.owner !== controllerId) return current;
      return null;
    });
  } catch (_) {
    // best effort
  }
}

async function init() {
  registerControllerPwa();
  await ensureScoreboardExists();
  bindEvents();
  updateFullscreenUi();
  refreshViewportLayout();
  tryLockLandscapeOrientation();
  setControlsEnabled(false);
  updateControlText();

  onValue(offsetRef, (snapshot) => {
    serverTimeOffset = snapshot.val() ?? 0;
  });

  onValue(scoreboardRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const prevPeriod = latest ? Number(latest.period ?? 1) : null;
    latest = snapshot.val();
    const currentPeriod = Number(latest.period ?? 1);
    if (prevPeriod !== null && currentPeriod !== prevPeriod) {
      timeoutSyncPeriodKey = null;
    }
    paint(latest);
    if (hasControl) {
      syncTimeoutAllowanceForPeriod(latest).catch((error) => {
        console.error("Timeout allocation sync failed:", error);
      });
    }
  });

  await tryAcquireLock();
  startLockHeartbeat();
  window.addEventListener("beforeunload", () => {
    clearNameAutosaveTimer();
    stopLockHeartbeat();
    releaseLock();
  });

  startLocalRefresh();
}

init().catch((error) => {
  console.error("Controller init failed:", error);
});
