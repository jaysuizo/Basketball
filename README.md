# Basketball Scoreboard

This project displays a basketball scoreboard using data stored in **Firebase**.  
The UI shows home/away scores, fouls, timeouts, game clock, shot clock, and possession.  
Data is synchronized in real-time from Firebase, so updates in the database reflect immediately on the scoreboard.  
**The scoreboard automatically listens for changes, so the UI updates instantly when the game data changes.**

## Data Source

This scoreboard reads game state from a **Firebase Realtime Database** using the following endpoint:  
https://basketball-scoreboard-9907f-default-rtdb.asia-southeast1.firebasedatabase.app/scoreboard.json

## JSON Structure

The Firebase data follows this structure:

| Field                  | Type    | Description |
|------------------------|--------|-------------|
| awayFouls              | number | Fouls committed by the away team |
| awayName               | string | Name of the away team |
| awayScore              | number | Points scored by the away team |
| awayTimeouts           | number | Remaining timeouts for the away team |
| buzzer                 | boolean| Sound the buzzer (true/false) |
| clockRunning           | boolean| Game clock running state |
| clockStartedAt         | number | Timestamp when the game clock started (ms) |
| elapsedBeforePause     | number | Seconds elapsed before last pause |
| gameDuration           | number | Duration of one period in seconds |
| homeFouls              | number | Fouls committed by the home team |
| homeName               | string | Name of the home team |
| homeScore              | number | Points scored by the home team |
| homeTimeouts           | number | Remaining timeouts for the home team |
| lastUpdated            | number | Timestamp of last update (ms) |
| maxPeriod              | number | Total regulation periods |
| overtime               | number | Number of overtime periods |
| period                 | number | Current period number |
| possession             | string | Current possession ("home", "away", or "none") |
| shotClockRunning       | boolean| Shot clock running state |
| shotDuration           | number | Shot clock duration in seconds |
| shotElapsedBeforePause | number | Shot clock seconds elapsed before last pause |
| shotPartialReset       | number | Partial reset value for shot clock |
| shotStartedAt          | number | Timestamp when shot clock last started |
| status                 | string | Game status ("running", "paused", "ended") |

## How It Works

1. Scoreboard reads the game state from **Firebase** in real-time.  
2. Any updates (scores, fouls, timeouts, clocks) in Firebase automatically update the UI.  
3. The UI uses the fields above to display the current game state accurately.  

## Setup

1. Open `index.html` in a browser or run a local server.  
2. The scoreboard will fetch data from the public Firebase endpoint automatically.

## Scoreboard Controller

A controller UI is included for managing the live scoreboard at `scoreboard`:

- Open `controller.html`
- Supports:
  - edit home and away team names
  - quarter selector (1-4)
  - game clock play/pause with one button
  - reset game clock to 12:00
  - shot clock controls: 14, 24, play/pause
  - score controls: plus and minus
  - fouls and timeouts controls: plus and minus
  - single-controller lock (`controlLock`) to avoid two tabs controlling at once
  - PWA-ready controller install (mobile app via Add to Home Screen)

### Install Controller As Mobile App

1. Host the project on HTTPS (Firebase Hosting or GitHub Pages).
2. Open `controller.html` on your phone browser.
3. Use browser menu -> **Add to Home Screen**.
4. Launch from phone home screen as a standalone app.

### Controller Firebase Path

```json
{
  "scoreboard": {
    "homeName": "HOME",
    "awayName": "AWAY",
    "homeScore": 0,
    "awayScore": 0,
    "homeFouls": 0,
    "awayFouls": 0,
    "homeTimeouts": 0,
    "awayTimeouts": 0,
    "period": 1,
    "maxPeriod": 4
  }
}
```

### Security Rules

Use `firebase.rules.json` to restrict writes to authenticated referee users:

- `.read`: public for live viewers
- `.write`: users with custom claim `role = referee`
- applies to `scoreboard` and `controlLock`
