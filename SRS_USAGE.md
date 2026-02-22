# SRS Scheduler Usage Guide

This Anki PWA client now includes an optional SM-2 spaced repetition scheduler!

## Quick Start

1. **Load a deck**: Upload an `.apkg` file using the file picker
2. **Enable the scheduler**: Press `Cmd+K` (or `Ctrl+K`) to open the command palette, then select "Enable SM-2 Scheduler" or press `Ctrl+R`
3. **Start reviewing**: The app will now show cards based on their due dates and track your progress

## Features

### SM-2 Spaced Repetition Algorithm
- Calculates optimal review intervals based on your performance
- Real intervals shown on answer buttons (no more hardcoded values!)
- Review state persists across sessions in IndexedDB

### SRS Visualization Panel
The visualization panel shows:

#### Queue Overview
- **Cards Due**: Total number of cards waiting to be reviewed
- **Current Position**: Your progress (e.g., "5 of 20")

#### Daily Progress
- **New Cards**: Progress towards daily new card limit (default: 20)
- **Reviews**: Progress towards daily review limit (default: 200)
- Visual progress bars that turn green when limits are reached

#### Current Card State
Real-time SM-2 algorithm data:
- **Status**: "New" (never seen) or "Review" (previously studied)
- **Due In**: Time until next review (e.g., "5d", "2h", "15m", "Now")
- **Ease Factor**: Difficulty multiplier (default 2.5)
  - Higher = easier card (longer intervals)
  - Lower = harder card (shorter intervals)
  - Range: typically 1.3 - 3.0
- **Interval**: Days between reviews (grows with successful reviews)
- **Repetitions**: Consecutive successful reviews (resets on "Again")
- **Card ID**: Unique identifier for debugging

### Collapsible Panel
- Click the "SRS Scheduler" header to collapse/expand
- Keeps the visualization out of the way while reviewing

## How the Algorithm Works

### Answer Buttons Map to SM-2 Ratings:
- **Again** → Rating 0 (complete blackout) - shortest interval
- **Hard** → Rating 3 (correct with serious difficulty)
- **Good** → Rating 4 (correct with hesitation)
- **Easy** → Rating 5 (perfect response) - longest interval

### How Intervals Change:
1. **New cards** start with short intervals (minutes/hours)
2. Each **successful review** (Hard/Good/Easy) increases the interval
3. **"Again" resets** the card to a short interval
4. The **ease factor** adjusts based on your answers:
   - "Again" decreases ease (makes future intervals shorter)
   - "Easy" increases ease (makes future intervals longer)

## Default Settings

```javascript
dailyNewLimit: 20          // Max new cards per day
dailyReviewLimit: 200      // Max reviews per day
showAheadOfSchedule: false // Don't show cards before they're due
```

Settings are stored per deck and persist across sessions.

## Simple Mode (Scheduler Disabled)

When the scheduler is disabled (default state):
- Cards appear sequentially
- Answer buttons show hardcoded intervals
- No review state is saved
- Best for quick browsing or preview

Toggle back to simple mode anytime with `Cmd+K` → "Disable SM-2 Scheduler"

## Data Persistence

All review data is stored locally in IndexedDB:
- **Card review states**: Due dates, intervals, ease factors
- **Review history**: Complete log of all reviews
- **Daily statistics**: New cards and reviews completed each day
- **Settings**: Per-deck scheduler configuration

Your data stays private and works offline!

## Troubleshooting

### Cards not showing up?
- Check if you've hit your daily limits (shown in the visualization)
- Make sure the scheduler is enabled (status badge shows "Active")

### Progress bars not updating?
- Refresh the page to reset daily stats if needed
- Daily stats reset at midnight local time

### Errors in console?
All SM-2 parsing errors are caught and logged to the console with details. Cards that fail to parse are skipped gracefully.

## Keyboard Shortcuts

- `Space`: Reveal answer
- `a`: Answer "Again"
- `h`: Answer "Hard"
- `g`: Answer "Good"
- `e`: Answer "Easy"
- `Cmd+K` / `Ctrl+K`: Open command palette
- `Ctrl+R`: Toggle scheduler on/off

## Supported Algorithms

- **SM-2**: Classic SuperMemo-2 algorithm (default)
- **FSRS**: Free Spaced Repetition Scheduler - a modern, machine learning-based algorithm with configurable parameters

Switch between algorithms via the Scheduler Settings (Cmd+K → "Scheduler Settings").
