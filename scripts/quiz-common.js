// Shared browser helpers for the practice quiz (scripts/quiz.js) and the
// self-assessment (scripts/assessment.js). Inlined by scripts/build_site.mjs
// as a plain classic script, immediately after a build-generated prelude that
// defines DIFFICULTIES and TAGS (from scripts/lib/questions.mjs) plus the
// per-page ASSESSMENT_HREF and QUIZ_PAGE_GROUP constants.

// An item only renders as a multiple-choice card if it's tagged [MCQ] *and*
// carries a usable options list and correct letter -- otherwise (e.g. a
// scrape that failed to find the option <ul>) it degrades to a flashcard
// rather than rendering a broken quiz.
function isMcqItem(q) {
  return !!q && Array.isArray(q.tags) && q.tags.includes('MCQ') && Array.isArray(q.options) && q.options.length > 0 && !!q.correct;
}

function shuffleArray(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Marks `btn` as the pressed member of a segmented control (the other
// buttons matching `selector` are released). Keeps the .active class and
// aria-pressed in step so sighted and screen-reader users see the same state.
function setPressed(selector, btn) {
  document.querySelectorAll(selector).forEach(b => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
