// Runs inline in every generated page (see scripts/build_site.mjs's wrapPage)
// and on quiz.html, so this is a plain classic script, not an ES module. The
// build emits a prelude before it that defines DIFFICULTIES, TAGS,
// ASSESSMENT_HREF and QUIZ_PAGE_GROUP, followed by scripts/quiz-common.js
// (isMcqItem, shuffleArray, setPressed).

function scrapeFromDom() {
  const items = [];
  document.querySelectorAll('h2').forEach(h2 => {
    if (!/^Q\d+\./.test(h2.textContent.trim())) return;
    // Collect every `[Tag]` code span in the heading (not just the first —
    // a question can carry a difficulty tag *and* a Scenario tag, and some
    // headings also contain unrelated backticked tokens mid-sentence, e.g.
    // Self-RAG's `[IsSup]` reflection token).
    const codeTokens = Array.from(h2.querySelectorAll('code'))
      .map(el => el.textContent.match(/^\[([A-Za-z]+)\]$/))
      .filter(Boolean)
      .map(m => m[1]);
    const difficulty = codeTokens.find(t => DIFFICULTIES.includes(t)) || 'Basic';
    const tags = codeTokens.filter(t => TAGS.includes(t));
    const questionText = h2.textContent
      .replace(/^Q\d+\.\s*/, '')
      .replace(/(\s*\[[A-Za-z]+\])+\s*$/, '')
      .trim();
    // For [MCQ] questions, an option <ul> sits between the heading and
    // <details> — read it off before continuing the walk to <details>.
    let el = h2.nextElementSibling;
    let options = null;
    if (el && el.tagName === 'UL' && tags.includes('MCQ')) {
      options = Array.from(el.children).map(li => {
        const m = li.textContent.match(/^\s*([A-Z])\.\s/);
        if (!m) return null;
        return { letter: m[1], html: li.innerHTML.replace(/^(\s*)([A-Z])\.\s*/, '$1') };
      }).filter(Boolean);
      el = el.nextElementSibling;
    }
    while (el && el.tagName !== 'DETAILS') el = el.nextElementSibling;
    const answerHTML = el ? el.innerHTML : '<summary>No answer found</summary>';
    const correctMatch = el ? el.textContent.match(/\bCorrect:\s*([A-Z])\./) : null;
    const correct = correctMatch ? correctMatch[1] : null;
    items.push({ questionText, difficulty, tags, answerHTML, options, correct, section: null, sectionGroup: null, href: null });
  });
  return items;
}

function loadQuestions() {
  const dataEl = document.getElementById('quiz-data');
  if (!dataEl) return scrapeFromDom();
  const raw = JSON.parse(dataEl.textContent);
  return raw.map(item => ({
    questionText: item.question,
    difficulty: item.difficulty,
    tags: item.tags || [],
    answerHTML: item.answer,
    options: item.options || null,
    correct: item.correct || null,
    section: item.section || null,
    sectionGroup: item.sectionGroup || null,
    href: item.href || null,
  }));
}

const allQuestions = loadQuestions();

let filtered = [], currentIndex = 0, correctCount = 0, reviewCount = 0;
let difficultyFilter = 'All';
let scenarioOnly = false;
let typeFilter = 'All';
let answered = false;

function applyFilters() {
  let result = allQuestions;
  if (difficultyFilter !== 'All') {
    result = result.filter(q => q.difficulty === difficultyFilter);
  }
  if (scenarioOnly) {
    result = result.filter(q => q.tags.includes('Scenario'));
  }
  if (typeFilter === 'MCQ') {
    result = result.filter(isMcqItem);
  } else if (typeFilter === 'Flashcard') {
    result = result.filter(q => !isMcqItem(q));
  }
  const sectionSelect = document.getElementById('section-select');
  if (sectionSelect && sectionSelect.value !== 'All') {
    result = result.filter(q => q.section === sectionSelect.value);
  }
  const shuffleToggle = document.getElementById('shuffle-toggle');
  if (shuffleToggle && shuffleToggle.checked) {
    result = shuffleArray(result);
  }
  return result;
}

// Live "N questions match" readout under the filter bar, plus disabling
// Start when the combination is empty. Both elements are optional so the
// same script keeps working on pages whose bar lacks them.
function updateMatchCount() {
  const countEl = document.getElementById('quiz-match-count');
  const startBtn = document.getElementById('quiz-start-btn');
  if (!countEl && !startBtn) return;
  const n = applyFilters().length;
  if (countEl) {
    countEl.textContent = n === 0
      ? 'No questions match these filters'
      : n === 1 ? '1 question matches' : `${n.toLocaleString('en-US')} questions match`;
    countEl.classList.toggle('empty', n === 0);
  }
  if (startBtn) startBtn.disabled = n === 0;
}

function setFilter(level, btn) {
  const target = btn || (typeof event !== 'undefined' ? event.target : null);
  if (target) setPressed('.filter-btn', target.closest('.filter-btn') || target);
  difficultyFilter = level;
  filtered = applyFilters();
  if (currentIndex >= filtered.length) currentIndex = 0;
  if (document.getElementById('quiz-panel').classList.contains('visible')) {
    currentIndex = 0;
    renderQuestion();
  }
  updateMatchCount();
}

function onScenarioChange() {
  const toggle = document.getElementById('scenario-toggle');
  scenarioOnly = !!(toggle && toggle.checked);
  filtered = applyFilters();
  currentIndex = 0;
  if (document.getElementById('quiz-panel').classList.contains('visible')) {
    renderQuestion();
  }
  updateMatchCount();
}

function onSectionChange() {
  filtered = applyFilters();
  currentIndex = 0;
  if (document.getElementById('quiz-panel').classList.contains('visible')) {
    renderQuestion();
  }
  updateMatchCount();
}

// Called from the Type segmented control with the value directly. Falls
// back to reading a legacy `#type-select` dropdown if invoked with no args.
function onTypeChange(value, btn) {
  if (typeof value === 'string') {
    typeFilter = value;
    if (btn) setPressed('.type-btn', btn);
  } else {
    const select = document.getElementById('type-select');
    typeFilter = select ? select.value : 'All';
  }
  filtered = applyFilters();
  currentIndex = 0;
  if (document.getElementById('quiz-panel').classList.contains('visible')) {
    renderQuestion();
  }
  updateMatchCount();
}

// Returns every control in the filter bar to its default, then refreshes
// the match count. Does not touch an in-progress quiz session.
function resetFilters() {
  difficultyFilter = 'All';
  typeFilter = 'All';
  scenarioOnly = false;
  const firstDiff = document.querySelector('.filter-btn');
  if (firstDiff) setPressed('.filter-btn', firstDiff);
  const firstType = document.querySelector('.type-btn');
  if (firstType) setPressed('.type-btn', firstType);
  ['scenario-toggle', 'shuffle-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  const sectionSelect = document.getElementById('section-select');
  if (sectionSelect) sectionSelect.value = 'All';
  filtered = applyFilters();
  currentIndex = 0;
  updateMatchCount();
}

function onShuffleChange() {
  filtered = applyFilters();
  currentIndex = 0;
  if (document.getElementById('quiz-panel').classList.contains('visible')) {
    renderQuestion();
  }
  updateMatchCount();
}

function startQuiz() {
  filtered = applyFilters();
  currentIndex = 0;
  correctCount = 0;
  reviewCount = 0;
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('quiz-overlay').classList.add('visible');
  document.getElementById('quiz-panel').classList.add('visible');
  renderQuestion();
}

function renderQuestion() {
  if (filtered.length === 0) {
    document.getElementById('quiz-panel').innerHTML = `
      <div class="quiz-header">
        <div><strong>No questions match these filters</strong></div>
        <button onclick="exitQuiz()" style="border: none; background: none; cursor: pointer; font-size: 1.2em;">✕</button>
      </div>
    `;
    return;
  }
  const q = filtered[currentIndex];
  answered = false;
  const progress = ((currentIndex + 1) / filtered.length * 100);
  const diffClass = q.difficulty.toLowerCase();
  const tagBadges = q.tags.map(t => `<span class="tag-badge ${t.toLowerCase()}">${t}</span>`).join('');
  const sectionLine = q.section
    ? `<div class="quiz-section">${q.section}</div>`
    : '';
  const openLink = (q.section && q.href)
    ? `<a class="quiz-open" href="${q.href}">Open in section page ↗</a>`
    : '';

  const mcq = isMcqItem(q);
  const optionsHtml = mcq
    ? `<div class="mcq-options">${q.options.map(o =>
        `<button class="mcq-option" data-letter="${o.letter}" onclick="chooseOption('${o.letter}')"><span class="mcq-letter">${o.letter}.</span> ${o.html}</button>`
      ).join('')}</div>
    <div id="mcq-result" class="mcq-result"></div>`
    : '';
  const buttonsHtml = mcq
    ? `<button onclick="skipQuestion()">Skip →</button>`
    : `<button class="primary" onclick="showAnswer()">Show Answer</button>
       <button onclick="skipQuestion()">Skip →</button>`;

  const html = `
    <div class="quiz-header">
      <div>
        <strong>Question ${currentIndex + 1} / ${filtered.length}</strong>
        <span class="difficulty-badge ${diffClass}">${q.difficulty}</span>${tagBadges}
      </div>
      <button onclick="exitQuiz()" style="border: none; background: none; cursor: pointer; font-size: 1.2em;">✕</button>
    </div>
    <div class="quiz-progress">
      <div class="quiz-progress-bar" style="width: ${progress}%"></div>
    </div>
    ${sectionLine}
    <div class="quiz-question">${q.questionText}</div>
    ${optionsHtml}
    <div id="answer-container" style="display: none;">
      <div class="quiz-answer">${q.answerHTML}</div>
      ${openLink}
    </div>
    <div class="quiz-buttons">
      ${buttonsHtml}
    </div>
  `;
  document.getElementById('quiz-panel').innerHTML = html;
}

function chooseOption(letter) {
  if (answered) return;
  answered = true;
  const q = filtered[currentIndex];
  document.querySelectorAll('.mcq-option').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.letter === q.correct) btn.classList.add('correct');
    else if (btn.dataset.letter === letter) btn.classList.add('wrong');
  });
  const isRight = letter === q.correct;
  if (isRight) correctCount++;
  else reviewCount++;
  const resultEl = document.getElementById('mcq-result');
  if (resultEl) {
    resultEl.textContent = isRight ? 'Correct!' : `Not quite — the answer is ${q.correct}.`;
  }
  const container = document.getElementById('answer-container');
  if (container) container.style.display = 'block';
  const buttons = document.querySelector('.quiz-buttons');
  if (buttons) {
    buttons.innerHTML = `<button class="primary" onclick="nextQuestion()">Next →</button>`;
  }
}

function showAnswer() {
  const container = document.getElementById('answer-container');
  container.style.display = 'block';
  const buttons = document.querySelector('.quiz-buttons');
  buttons.innerHTML = `
    <button class="primary" onclick="markCorrect()" style="background: #4caf50; border-color: #4caf50;">✓ Got it</button>
    <button onclick="markReview()">✗ Review again</button>
  `;
}

function markCorrect() {
  correctCount++;
  nextQuestion();
}

function markReview() {
  reviewCount++;
  nextQuestion();
}

function skipQuestion() {
  nextQuestion();
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex < filtered.length) {
    renderQuestion();
  } else {
    showSummary();
  }
}

// Link into the self-assessment with the current practice filters carried
// over (difficulty, and the section group when the session is confined to
// one). ASSESSMENT_HREF / QUIZ_PAGE_GROUP come from the build prelude.
function assessmentHandoffHref() {
  const params = new URLSearchParams();
  if (difficultyFilter !== 'All') params.set('difficulty', difficultyFilter);
  let group = typeof QUIZ_PAGE_GROUP !== 'undefined' ? QUIZ_PAGE_GROUP : null;
  if (!group && filtered.length > 0) {
    const groups = new Set(filtered.map(q => q.sectionGroup).filter(Boolean));
    if (groups.size === 1) group = groups.values().next().value;
  }
  if (group) params.set('group', group);
  const base = typeof ASSESSMENT_HREF !== 'undefined' ? ASSESSMENT_HREF : 'assessment.html';
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function showSummary() {
  const percentage = Math.round((correctCount / filtered.length) * 100);
  const html = `
    <div class="quiz-summary">
      <h3>Quiz Complete! 🎉</h3>
      <p style="font-size: 1.1em; margin: 1.5rem 0;">You got <strong>${correctCount} out of ${filtered.length}</strong> correct.</p>
      <div class="quiz-score">${percentage}%</div>
      <p style="color: #666; margin: 1rem 0;">${reviewCount} to review</p>
      <p class="quiz-handoff"><a href="${assessmentHandoffHref()}">Think you know it? Take a timed assessment →</a></p>
      <button onclick="restartQuiz()">← Try Again</button>
      <button onclick="exitQuiz()" style="background: #666; border-color: #666; margin-left: 1rem;">Exit Quiz</button>
    </div>
  `;
  document.getElementById('quiz-panel').innerHTML = html;
}

function restartQuiz() {
  currentIndex = 0;
  correctCount = 0;
  reviewCount = 0;
  renderQuestion();
}

function exitQuiz() {
  document.getElementById('quiz-panel').classList.remove('visible');
  document.getElementById('quiz-overlay').classList.remove('visible');
  document.getElementById('main-content').classList.remove('hidden');
}

// Keyboard shortcut: press a letter key to choose that MCQ option, as long
// as the quiz panel is open, the current card is an unanswered MCQ, and the
// keystroke isn't meant for a focused form control (a <select> or <input>
// in the filter bar).
document.addEventListener('keydown', (e) => {
  const panel = document.getElementById('quiz-panel');
  if (!panel || !panel.classList.contains('visible') || answered) return;
  const target = e.target;
  if (target && /^(SELECT|INPUT|TEXTAREA)$/.test(target.tagName)) return;
  const q = filtered[currentIndex];
  if (!q || !isMcqItem(q)) return;
  const letter = e.key.toUpperCase();
  if (q.options.some(o => o.letter === letter)) chooseOption(letter);
});

updateMatchCount();
