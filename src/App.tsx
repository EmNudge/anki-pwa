import "./App.css";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { Card, CardButtons } from "./components/Card";
import type { Answer } from "./components/Card";
import { css } from "solid-styled";
import { getRenderedCardString } from "./utils/render";
import { computeDeckInfo } from "./utils/deckInfo";
import { FilePicker } from "./components/FilePicker";
import {
  ankiCachePromise,
  ankiDataSig,
  cardsSig,
  currentReviewCardSig,
  deckInfoSig,
  initializeReviewQueue,
  mediaFilesSig,
  moveToNextReviewCard,
  reviewQueueSig,
  schedulerEnabledSig,
  schedulerSettingsModalOpenSig,
  selectedCardSig,
  selectedDeckIdSig,
  selectedTemplateSig,
  setBlobSig,
  setDeckInfoSig,
  setSchedulerSettingsModalOpenSig,
  setSelectedCardSig,
  setSelectedDeckIdSig,
  templatesSig,
} from "./stores";
import { SRSVisualization } from "./components/SRSVisualization";
import { SchedulerSettingsModal } from "./components/SchedulerSettings";
import { CommandPalette } from "./components/CommandPalette";
import { FileInfo } from "./components/FileInfo";
import { useCommands } from "./useCommands";
import { isTruthy } from "./utils/assert";

function App() {
  // eslint-disable-next-line no-unused-expressions
  css`
    main {
      display: grid;
      grid-template-columns: 300px 1fr 400px;
      min-height: 100vh;
    }

    :global(hr) {
      margin: 1rem 0;
    }

    .layout-left-column {
      grid-column: 1;
      grid-row: 1;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: var(--color-surface);
      border-right: 1px solid var(--color-border);
      padding: var(--spacing-4);
      text-align: left;
    }

    .layout-center-column {
      grid-column: 2;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-8) var(--spacing-4);
    }

    .layout-right-column {
      grid-column: 3;
      grid-row: 1;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      padding: var(--spacing-4);
      text-align: left;
    }

    @media (max-width: 1200px) {
      main {
        grid-template-columns: 1fr;
        min-height: auto;
      }

      .layout-left-column,
      .layout-center-column,
      .layout-right-column {
        grid-column: 1;
        position: static;
        height: auto;
        overflow: visible;
        border: none;
      }

      .layout-left-column {
        grid-row: 1;
        border-bottom: 1px solid var(--color-border);
      }
      .layout-center-column {
        grid-row: 2;
        background: transparent;
      }
      .layout-right-column {
        grid-row: 3;
        border-top: 1px solid var(--color-border);
      }
    }

    .dropdowns {
      display: flex;
      gap: 1rem;
      justify-content: center;
    }

    .keyboard-hint {
      text-align: right;
      display: inline-block;
      opacity: 0.5;
      grid-column: 1 / -1;
      margin-top: var(--spacing-4);

      button {
        padding: 0.5rem;
        border-radius: 0.25rem;
      }
    }
  `;

  const [activeSide, setActiveSide] = createSignal<"front" | "back">("front");
  const [reviewStartTime, setReviewStartTime] = createSignal<number>(Date.now());
  const commands = useCommands();

  // Compute deck info from anki data (pure derived state)
  const computedDeckInfo = createMemo(() => {
    const ankiData = ankiDataSig();
    return ankiData ? computeDeckInfo(ankiData) : null;
  });

  // Sync computed deck info to global signal and handle initial deck selection
  createEffect(() => {
    const deckInfo = computedDeckInfo();
    if (deckInfo) {
      // Use untrack to read previous deck info without creating a dependency
      const previousDeckInfo = untrack(() => deckInfoSig());
      setDeckInfoSig(deckInfo);

      // Only set initial selected deck when loading a new deck (not when user selects "All Cards")
      // Check if this is a new deck by comparing the deck name
      const isNewDeck = !previousDeckInfo || previousDeckInfo.name !== deckInfo.name;
      if (isNewDeck && deckInfo.subdecks.length > 0) {
        setSelectedDeckIdSig(deckInfo.subdecks[0]!.id);
      }
    }
  });

  // Initialize review queue when cards are loaded and scheduler is enabled
  // Also track selectedDeckIdSig to ensure re-initialization on deck change
  createEffect(() => {
    const cards = cardsSig();
    const templates = templatesSig();
    const schedulerEnabled = schedulerEnabledSig();
    selectedDeckIdSig(); // Track deck changes explicitly

    if (cards.length > 0 && templates && templates.length > 0 && schedulerEnabled) {
      initializeReviewQueue();
    }
  });

  // Get current card based on mode
  const currentCardData = createMemo(() => {
    if (schedulerEnabledSig()) {
      const reviewCard = currentReviewCardSig();
      if (!reviewCard) return null;

      return {
        cardIndex: reviewCard.cardIndex,
        templateIndex: reviewCard.templateIndex,
        reviewCard,
      };
    }

    return {
      cardIndex: selectedCardSig(),
      templateIndex: selectedTemplateSig(),
      reviewCard: null,
    };
  });

  const renderedCard = createMemo(() => {
    const data = currentCardData();
    if (!data) return null;

    const template = cardsSig()[data.cardIndex]?.templates[data.templateIndex];
    const card = cardsSig()[data.cardIndex];

    if (!template || !card) {
      return null;
    }

    const frontSideHtml = getRenderedCardString({
      templateString: template.qfmt,
      variables: { ...card.values },
      mediaFiles: mediaFilesSig(),
    });

    const backSideHtml = getRenderedCardString({
      templateString: template.afmt,
      // https://docs.ankiweb.net/templates/fields.html#special-fields
      variables: { ...card.values, FrontSide: frontSideHtml },
      mediaFiles: mediaFilesSig(),
    });

    return { frontSideHtml, backSideHtml };
  });

  const updateActiveSide = (side: "front" | "back") => {
    setActiveSide(side);
    const card = renderedCard();
    if (!card) return;

    if (side === "front") {
      const audioFilenames = getAudioFilenames(card.frontSideHtml);
      for (const filename of audioFilenames) {
        new Audio(filename).play();
      }
    } else {
      const frontSideAudioFilenames = new Set(getAudioFilenames(card.frontSideHtml));
      const backSideAudioFilenames = new Set(getAudioFilenames(card.backSideHtml));
      const newAudioFilenames = backSideAudioFilenames.difference(frontSideAudioFilenames);

      for (const filename of newAudioFilenames) {
        new Audio(filename).play();
      }
    }

    function getAudioFilenames(html: string) {
      const allAudioContainers = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelectorAll<HTMLAudioElement>(`div.audio-container[data-autoplay] audio`);

      return [...allAudioContainers].map((audio) => audio.src).filter(isTruthy);
    }
  };

  // Calculate intervals for scheduler mode
  const intervals = createMemo(() => {
    if (!schedulerEnabledSig()) return undefined;

    const reviewCard = currentReviewCardSig();
    const queue = reviewQueueSig();

    if (!reviewCard || !queue) return undefined;

    return queue.getNextIntervals(reviewCard);
  });

  return (
    <>
      <main>
        {/* LEFT COLUMN: File Info */}
        <div class="layout-left-column">{deckInfoSig() && <FileInfo />}</div>

        {/* CENTER COLUMN: Card */}
        <div class="layout-center-column">
          {(() => {
            const card = renderedCard();
            if (!card) {
              return cardsSig().length === 0 ? (
                <FilePicker
                  onFileChange={async (file) => {
                    const cache = await ankiCachePromise;
                    await cache.put("anki-deck", new Response(file));

                    setBlobSig(file);
                  }}
                />
              ) : null;
            }

            return (
              <>
                <Card
                  front={<div innerHTML={card.frontSideHtml} />}
                  back={<div innerHTML={card.backSideHtml} />}
                  activeSide={activeSide()}
                  intervals={intervals()}
                  onReveal={() => {
                    updateActiveSide("back");
                    setReviewStartTime(Date.now());
                  }}
                  onChooseAnswer={async (answer: Answer) => {
                    if (schedulerEnabledSig()) {
                      // Scheduler mode: process review
                      const reviewCard = currentReviewCardSig();
                      const queue = reviewQueueSig();

                      if (reviewCard && queue) {
                        const reviewTimeMs = Date.now() - reviewStartTime();
                        await queue.processReview(reviewCard, answer, reviewTimeMs);
                        moveToNextReviewCard();
                      }
                    } else {
                      // Simple mode: just move to next card
                      setSelectedCardSig((prevCard) => prevCard + 1);
                    }

                    updateActiveSide("front");
                    setReviewStartTime(Date.now());
                  }}
                />
                <CardButtons
                  activeSide={activeSide()}
                  intervals={intervals()}
                  onReveal={() => {
                    updateActiveSide("back");
                    setReviewStartTime(Date.now());
                  }}
                  onChooseAnswer={async (answer: Answer) => {
                    if (schedulerEnabledSig()) {
                      // Scheduler mode: process review
                      const reviewCard = currentReviewCardSig();
                      const queue = reviewQueueSig();

                      if (reviewCard && queue) {
                        const reviewTimeMs = Date.now() - reviewStartTime();
                        await queue.processReview(reviewCard, answer, reviewTimeMs);
                        moveToNextReviewCard();
                      }
                    } else {
                      // Simple mode: just move to next card
                      setSelectedCardSig((prevCard) => prevCard + 1);
                    }

                    updateActiveSide("front");
                    setReviewStartTime(Date.now());
                  }}
                />
              </>
            );
          })()}
        </div>

        {/* RIGHT COLUMN: SRS Visualization */}
        <div class="layout-right-column">{cardsSig().length > 0 && <SRSVisualization />}</div>
      </main>

      <SchedulerSettingsModal
        isOpen={schedulerSettingsModalOpenSig()}
        onClose={() => setSchedulerSettingsModalOpenSig(false)}
      />
      <CommandPalette commands={commands()} />
    </>
  );
}

export default App;
