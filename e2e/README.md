# E2E Tests with Playwright

This directory contains end-to-end tests for the Anki PWA using Playwright.

## Test Coverage

The test suite covers the following major features:

### 1. Card Display (`card-display.spec.ts`)
- Cards display with front side initially
- Front content is visible
- Reveal button works correctly
- Back side displays after revealing
- Cards have proper structure
- Navigation between cards works

### 2. SRS Algorithm (`srs-algorithm.spec.ts`)
- Interval times are displayed for each answer option
- Different intervals for different answer options (Again, Hard, Good, Easy)
- Review state persists in IndexedDB
- Intervals update after reviewing cards
- Daily statistics are tracked
- Different answer ratings are handled correctly

### 3. Keyboard Shortcuts (`keyboard-shortcuts.spec.ts`)
- Space key reveals cards
- 'a' key answers "Again"
- 'h' key answers "Hard"
- 'g' key answers "Good"
- 'e' key answers "Easy"
- Full review flow works with keyboard only
- Keys are properly scoped (no action on wrong side)

## Running Tests

```bash
# Run all e2e tests
pnpm run test:e2e

# Run tests with UI
pnpm run test:e2e:ui

# Run tests in headed mode (see browser)
pnpm run test:e2e:headed

# Debug tests
pnpm run test:e2e:debug
```

## Test Setup

The tests use a fixture (`fixtures.ts`) that:
- Loads the example Anki deck (`example_music_intervals.apkg`)
- Clears IndexedDB before each test
- Clears deck cache before each test
- Provides utility functions for test setup

## Notes

- Tests use the real Anki deck file from `src/ankiParser/__tests__/example_music_intervals.apkg`
- Tests verify both UI state and database persistence
- Keyboard shortcuts are tested to ensure accessibility
- SRS algorithm behavior is validated through intervals and database state
