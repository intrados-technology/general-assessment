/* ============================================================
   INTRADOS DESIGN STUDIO – Test 1: General Assessment
   script.js – Complete Application Logic
   ============================================================ */

'use strict';

// ── Google Sheets integration endpoint (replace with your URL) ──
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxteJu1b_okEFYv4jbSF4Ne55bOfBsyIiIx3tnAVHq833I1f7c7aGcn7VVck--VI_a8tg/exec";
const ASSESSMENT_TYPE =
  document.querySelector('meta[name="assessment-type"]')?.content || 'General';

// ── Multi-Tab Protection ────────────────────────────────────────
// Each tab gets a unique ID. When an assessment starts, that ID is
// stored in localStorage('assessmentTab'). Any other tab that loads
// and finds a DIFFERENT tab ID already stored is blocked immediately.
const TAB_ID = Date.now().toString();

(function enforceTabOwnership() {
  const runningTab = localStorage.getItem('assessmentTab');
  if (
    localStorage.getItem('assessmentRunning') === 'true' &&
    runningTab &&
    runningTab !== TAB_ID
  ) {
    // Another tab owns this session — block this tab completely
    document.body.innerHTML = `
      <div style="
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        min-height:100vh;
        font-family:Arial,sans-serif;
        background:#f8f5ff;
        text-align:center;
        padding:40px 20px;
      ">
        <div style="
          background:#fff;
          border:1.5px solid #ddd6fe;
          border-radius:20px;
          padding:48px 40px;
          max-width:440px;
          box-shadow:0 8px 32px rgba(108,63,197,0.12);
        ">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2 style="color:#4E2E9A;margin:0 0 12px;font-size:22px;">
            Assessment Already Running
          </h2>
          <p style="color:#4B5563;line-height:1.6;margin:0 0 20px;">
            An active assessment session was detected in another tab.<br/>
            Please return to the original tab to continue.
          </p>
          <p style="color:#9CA3AF;font-size:12px;margin:0;">
            If you believe this is an error, close all tabs and reload.
          </p>
        </div>
      </div>`;
    throw new Error('IDS: Assessment already running in another tab. Tab blocked.');
  }
})();

// ── App State ───────────────────────────────────────────────────
const state = {
  candidate: {},       // Registration data
  answers:   {},       // { questionIndex: selectedOptionIndex }
  currentQ:  0,        // 0-based current question index
  timerSecs: 50 * 60, // 50 minutes in seconds (1 min × 50 questions)
  timerRef:  null,     // setInterval reference
  submitted: false,    // Guard against double-submission
  integrityFlags: []   // Logged proctoring events (tab switches, fullscreen exits, etc.)
};

// ── Restore saved answers on page load ──────────────────────────
try {
  const savedAnswers = localStorage.getItem('ids_answers');
  if (savedAnswers) {
    state.answers = JSON.parse(savedAnswers);
  }
} catch(e) {
  console.warn('Unable to restore saved answers');
}

// ── DOM References ──────────────────────────────────────────────
const DOM = {
  regSection:     document.getElementById('registration-section'),
  assSection:     document.getElementById('assessment-section'),
  confSection:    document.getElementById('confirmation-section'),
  timerDisplay:   document.getElementById('timer-display'),
  timerText:      document.getElementById('timer-text'),

  rulesModal:       document.getElementById('rules-modal'),
  btnRulesUnderstood: document.getElementById('btn-rules-understood'),

  formName:       document.getElementById('field-name'),
  formMobile:     document.getElementById('field-mobile'),
  formEmail:      document.getElementById('field-email'),
  formPosition:   document.getElementById('field-position'),
  formTrack:      document.getElementById('field-track'),
  formDomain:     document.getElementById('field-domain'),
  errName:        document.getElementById('err-name'),
  errMobile:      document.getElementById('err-mobile'),
  errEmail:       document.getElementById('err-email'),
  errPosition:    document.getElementById('err-position'),
  errTrack:       document.getElementById('err-track'),
  errDomain:      document.getElementById('err-domain'),
  btnStart:       document.getElementById('btn-start'),

  progressFill:   document.getElementById('progress-fill'),
  progressLabel:  document.getElementById('progress-label'),
  progressCount:  document.getElementById('progress-count'),
  sectionStrip:   document.getElementById('section-strip'),
  questionWrap:   document.getElementById('question-wrap'),
  btnPrev:        document.getElementById('btn-prev'),
  btnNext:        document.getElementById('btn-next'),
  btnSubmit:      document.getElementById('btn-submit'),
  unansweredHint: document.getElementById('unanswered-hint'),

  modal:          document.getElementById('submit-modal'),
  modalMsg:       document.getElementById('modal-unanswered-count'),
  btnModalCancel: document.getElementById('btn-modal-cancel'),
  btnModalConfirm:document.getElementById('btn-modal-confirm'),

  webcamModal:      document.getElementById('webcam-consent-modal'),
  btnWebcamAllow:   document.getElementById('btn-webcam-allow'),
  btnWebcamDecline: document.getElementById('btn-webcam-decline'),

  refId:          document.getElementById('ref-id')
};

// ── Exam Rules Modal ──────────────────────────────────────────────
// Shown automatically on page load, before the candidate can see or
// interact with the registration form. No skip/close-by-backdrop —
// the only way past it is the explicit "I Understand & Proceed" click.
DOM.btnRulesUnderstood.addEventListener('click', function() {
  DOM.rulesModal.classList.remove('open');
});

// ── Security ─────────────────────────────────────────────────────
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', function(e) {
  if (e.key === 'F12') { e.preventDefault(); return false; }
  if (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c'].includes(e.key)) { e.preventDefault(); return false; }
  if (e.ctrlKey && ['U','u','S','s'].includes(e.key)) { e.preventDefault(); return false; }
});
// ── Stale lock cleanup on tab close / crash ─────────────────────
// 'unload' fires even on crashes (best-effort). Clears the tab lock
// so a future session isn't blocked by a ghost lock.
window.addEventListener('unload', function() {
  if (!state.submitted) {
    localStorage.removeItem('assessmentRunning');
    localStorage.removeItem('assessmentTab');
  }
});

window.addEventListener('beforeunload', function(e) {
  if (!state.submitted && DOM.assSection.style.display === 'block') {
    e.preventDefault();
    e.returnValue = 'Your assessment is in progress. Are you sure you want to leave?';
    return e.returnValue;
  }
});

// ── Registration Validation ──────────────────────────────────────
function validateField(input, errorEl, validationFn) {
  const result = validationFn(input.value);
  if (result.valid) {
    input.classList.remove('error');
    input.classList.add('success');
    errorEl.classList.remove('show');
  } else {
    input.classList.add('error');
    input.classList.remove('success');
    errorEl.textContent = result.msg;
    errorEl.classList.add('show');
  }
  return result.valid;
}

const validators = {
  name:     v => v.trim().length > 0 ? { valid: true } : { valid: false, msg: 'Full name cannot be blank.' },
  mobile:   v => /^\d{10}$/.test(v.trim()) ? { valid: true } : { valid: false, msg: 'Please enter a valid 10-digit mobile number.' },
  email:    v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? { valid: true } : { valid: false, msg: 'Please provide a valid email address.' },
  position: v => v.trim().length > 0 ? { valid: true } : { valid: false, msg: 'Position applied for cannot be blank.' },
  track:    v => (v === 'Fresher' || v === 'Experienced') ? { valid: true } : { valid: false, msg: 'Please select whether you are applying as a Fresher or Experienced candidate.' },
  domain:   v => (v === 'Technical' || v === 'Non-Technical') ? { valid: true } : { valid: false, msg: 'Please select Technical or Non-Technical.' }
};

function checkFormValidity() {
  const ok = validators.name(DOM.formName.value).valid &&
             validators.mobile(DOM.formMobile.value).valid &&
             validators.email(DOM.formEmail.value).valid &&
             validators.position(DOM.formPosition.value).valid &&
             validators.track(DOM.formTrack.value).valid &&
             validators.domain(DOM.formDomain.value).valid;
  DOM.btnStart.disabled = !ok;

  // Update button icon and label to reflect state clearly
  var icon = document.getElementById('btn-start-icon');
  var text = document.getElementById('btn-start-text');
  if (icon && text) {
    if (ok) {
      icon.textContent = '✓';
      text.textContent = 'Begin Assessment';
    } else {
      icon.textContent = '🔒';
      text.textContent = 'Fill all fields to continue';
    }
  }
}

DOM.formName.addEventListener('input', () => { validateField(DOM.formName, DOM.errName, validators.name); checkFormValidity(); });
DOM.formMobile.addEventListener('input', () => {
  DOM.formMobile.value = DOM.formMobile.value.replace(/\D/g, '').slice(0, 10);
  validateField(DOM.formMobile, DOM.errMobile, validators.mobile);
  checkFormValidity();
});
DOM.formEmail.addEventListener('input',    () => { validateField(DOM.formEmail, DOM.errEmail, validators.email); checkFormValidity(); });
DOM.formPosition.addEventListener('input', () => { validateField(DOM.formPosition, DOM.errPosition, validators.position); checkFormValidity(); });
DOM.formTrack.addEventListener('change',   () => { validateField(DOM.formTrack, DOM.errTrack, validators.track); checkFormValidity(); });
DOM.formDomain.addEventListener('change',  () => { validateField(DOM.formDomain, DOM.errDomain, validators.domain); checkFormValidity(); });

// ── Test Integrity Measures ─────────────────────────────────────
// Active only while the assessment section is actually on screen.
// None of this can stop someone photographing the screen with a
// second physical device — that's outside what any web page can
// see or control. What this DOES do: block the easy same-device
// methods (copy-paste, opening a new tab to an AI tool, using the
// back button to escape), and log signals (fullscreen exits, tab
// switches) so flagged attempts can be manually reviewed rather
// than trusted blindly.
let integrityArmed = false;

function logIntegrityFlag(msg) {
  const ts = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  state.integrityFlags.push('[' + ts + ', Q' + (state.currentQ + 1) + '] ' + msg);
}

function handleFullscreenChange() {
  if (!integrityArmed) return;
  const inFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!inFullscreen) {
    logIntegrityFlag('Exited fullscreen — assessment auto-submitted');
    autoSubmitDueToViolation();
  }
}

function handleVisibilityChange() {
  if (!integrityArmed) return;
  if (document.hidden) {
    logIntegrityFlag('Tab/window switched away — assessment auto-submitted');
    autoSubmitDueToViolation();
  }
}

function handlePopState() {
  if (!integrityArmed) return;
  history.pushState(null, '', location.href); // immediately cancel the back navigation
  logIntegrityFlag('Attempted to navigate back');
}

function blockCopyAndContextMenu(e) {
  if (integrityArmed) e.preventDefault();
}

function requestFullscreenSafe() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { req.call(el); } catch(e) {} }
}

// ── Second-Monitor Detection ────────────────────────────────────
// screen.isExtended (Window Management API) currently only works in
// Chromium browsers (Chrome, Edge) — Safari and Firefox always report
// false, so this provides NO protection on those browsers. Best-effort
// only; feature-detected so it never errors where unsupported.
function hasSecondMonitor() {
  return ('isExtended' in screen) && screen.isExtended === true;
}

function handleScreenChange() {
  if (!integrityArmed) return;
  if (hasSecondMonitor()) {
    logIntegrityFlag('Second monitor connected during assessment — auto-submitted');
    autoSubmitDueToViolation();
  }
}

function armIntegrityMeasures() {
  integrityArmed = true;
  requestFullscreenSafe();
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', handlePopState);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('contextmenu', blockCopyAndContextMenu);
  document.addEventListener('copy', blockCopyAndContextMenu);
  document.addEventListener('cut', blockCopyAndContextMenu);
  if ('isExtended' in screen) {
    try { screen.addEventListener('change', handleScreenChange); } catch(e) {}
  }
}

function disarmIntegrityMeasures() {
  integrityArmed = false;
  window.removeEventListener('popstate', handlePopState);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('contextmenu', blockCopyAndContextMenu);
  document.removeEventListener('copy', blockCopyAndContextMenu);
  document.removeEventListener('cut', blockCopyAndContextMenu);
  if ('isExtended' in screen) {
    try { screen.removeEventListener('change', handleScreenChange); } catch(e) {}
  }
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch(e) {}
  }
}

function autoSubmitDueToViolation() {
  if (state.submitted) return;
  finaliseSubmission();
}

// ── Webcam Recording ─────────────────────────────────────────────
// Consent is asked explicitly before any camera access — nothing
// records silently. Once granted, recording runs for the full
// assessment and uploads in ~30-second chunks to Google Drive via
// the Apps Script backend (action: 'webcamChunk'), saved into a
// folder named "<ReferenceID>_<TEST_TYPE>". Chunked upload (rather
// than one file at the end) means a crash or connection drop still
// leaves whatever was recorded safely saved, and keeps each
// individual upload small. This covers EVERY submission path —
// normal finish, tab-switch, fullscreen-exit, second-monitor — since
// stopWebcamRecording() is called from finaliseSubmission() itself,
// which all of those funnel into.
const TEST_TYPE = 'G'; // 'G' for General Assessment, 'P' for all Professional Assessment portals
let mediaStream   = null;
let mediaRecorder = null;
let webcamChunkIndex = 0;

function showWebcamConsent() {
  return new Promise(function(resolve) {
    DOM.webcamModal.classList.add('open');
    DOM.btnWebcamAllow.onclick = function() {
      DOM.webcamModal.classList.remove('open');
      resolve(true);
    };
    DOM.btnWebcamDecline.onclick = function() {
      DOM.webcamModal.classList.remove('open');
      resolve(false);
    };
  });
}

async function startWebcamRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: false
    });
  } catch (err) {
    return false;
  }
  try {
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 150000
    });
  } catch (err) {
    try { mediaRecorder = new MediaRecorder(mediaStream); }
    catch (err2) { return false; }
  }
  webcamChunkIndex = 0;
  mediaRecorder.ondataavailable = function(e) {
    if (e.data && e.data.size > 0) {
      uploadWebcamChunk(e.data, webcamChunkIndex);
      webcamChunkIndex++;
    }
  };
  try { mediaRecorder.start(30000); } catch(e) { return false; } // emit a chunk every 30s
  return true;
}

function stopWebcamRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch(e) {}
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(function(t) { t.stop(); });
  }
}

function uploadWebcamChunk(blob, index) {
  var reader = new FileReader();
  reader.onloadend = function() {
    var base64 = reader.result.split(',')[1];
    fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:      'webcamChunk',
        referenceId: (state.candidate && state.candidate.refId) || 'unknown',
        testType:    TEST_TYPE,
        chunkIndex:  index,
        mimeType:    blob.type,
        data:        base64
      })
    }).catch(function(err) { console.warn('[IDS] Webcam chunk upload error:', err); });
  };
  reader.readAsDataURL(blob);
}

// ── Start Assessment ─────────────────────────────────────────────
DOM.btnStart.addEventListener('click', async function() {
  state.candidate = {
    name:     DOM.formName.value.trim(),
    mobile:   DOM.formMobile.value.trim(),
    email:    DOM.formEmail.value.trim(),
    position: DOM.formPosition.value.trim(),
    track:    DOM.formTrack.value.trim(),
    domain:   DOM.formDomain.value.trim()
  };
  // The real Reference ID isn't generated until finaliseSubmission() runs
  // at the very end — but webcam chunks upload throughout the whole exam.
  // Use a temporary session-based ID for chunk folder naming in the
  // meantime, based on mobile number + start time (reasonably unique).
  state.candidate.refId = state.candidate.mobile + '_' + Date.now();

  if (hasSecondMonitor()) {
    alert('A second monitor/display was detected. Please disconnect any secondary displays and refresh the page before starting this assessment.');
    return;
  }

  const consented = await showWebcamConsent();
  if (!consented) {
    alert('Webcam recording is required to begin this assessment.');
    return;
  }
  const recordingStarted = await startWebcamRecording();
  if (!recordingStarted) {
    alert('Could not access your webcam. Please allow camera access in your browser and try again.');
    return;
  }

  DOM.regSection.style.display   = 'none';
  DOM.assSection.style.display   = 'block';
  DOM.timerDisplay.style.display = 'flex';
  // Mark this tab as the authoritative assessment session
  localStorage.setItem('assessmentRunning', 'true');
  localStorage.setItem('assessmentTab', TAB_ID);
  armIntegrityMeasures();
  // Resume from the last answered question if answers were restored
  const lastAnswered = Object.keys(state.answers).length;
  renderQuestion(lastAnswered > 0 ? lastAnswered : 0);
  startTimer();
});

// ── Timer ─────────────────────────────────────────────────────────
function formatTime(s) {
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}

function startTimer() {
  DOM.timerText.textContent = formatTime(state.timerSecs);
  state.timerRef = setInterval(function() {
    state.timerSecs--;
    DOM.timerText.textContent = formatTime(state.timerSecs);
    if (state.timerSecs <= 0) {
      clearInterval(state.timerRef);
      if (!state.submitted) finaliseSubmission();
    } else if (state.timerSecs <= 60) {
      DOM.timerDisplay.classList.remove('warning');
      DOM.timerDisplay.classList.add('danger');
    } else if (state.timerSecs <= 300) {
      DOM.timerDisplay.classList.add('warning');
    }
  }, 1000);
}

// ── Answer Selection via Event Delegation ────────────────────────
// ONE listener on the stable parent — never removed, never duplicated.
// Reads clicks on .option-label children directly.
DOM.questionWrap.addEventListener('click', function(e) {
  const label = e.target.closest('.option-label');
  if (!label) return;

  const optionIndex = parseInt(label.getAttribute('data-option'), 10);
  if (isNaN(optionIndex)) return;

  // Save answer
  state.answers[state.currentQ] = optionIndex;
  // Persist answers to localStorage on every selection
  localStorage.setItem('ids_answers', JSON.stringify(state.answers));

  // Update visual selection — remove from all, add to clicked
  DOM.questionWrap.querySelectorAll('.option-label').forEach(function(l) {
    l.classList.remove('selected');
    l.setAttribute('aria-checked', 'false');
  });
  label.classList.add('selected');
  label.setAttribute('aria-checked', 'true');

  // Clear the unanswered warning now that a selection exists
  DOM.unansweredHint.classList.remove('show');
});

// ── Question Rendering ───────────────────────────────────────────
function renderQuestion(index) {
  state.currentQ = index;
  const q = SHUFFLED_QUESTIONS[index];
  const savedAnswer = state.answers[index]; // may be undefined

  // Progress
  const pct = Math.round(((index + 1) / SHUFFLED_QUESTIONS.length) * 100);
  DOM.progressFill.style.width      = pct + '%';
  DOM.progressLabel.textContent     = 'Question ' + (index + 1) + ' of ' + SHUFFLED_QUESTIONS.length;
  DOM.progressCount.textContent     = pct + '% Complete';
  DOM.sectionStrip.textContent      = 'Section ' + q.section + ': ' + q.sectionLabel;

  // Build options as <button> elements — natively clickable on all
  // browsers/devices regardless of user-select:none on the body.
  const optionsHTML = q.options.map(function(opt, i) {
    const isSelected = (savedAnswer === i);
    return '<li class="option-item">' +
      '<button class="option-label' + (isSelected ? ' selected' : '') + '" data-option="' + i + '" type="button" role="radio" aria-checked="' + isSelected + '">' +
        '<span class="option-indicator"></span>' +
        '<span class="option-text">' + escapeHTML(opt) + '</span>' +
      '</button>' +
    '</li>';
  }).join('');

  DOM.questionWrap.innerHTML =
    '<div class="question-card">' +
      '<div class="question-number">Q' + (index + 1) + '</div>' +
      '<p class="question-text">' + escapeHTML(q.text) + '</p>' +
      '<ul class="options-list" role="radiogroup" aria-label="Answer options">' +
        optionsHTML +
      '</ul>' +
    '</div>';

  // Buttons handle Enter natively; add Space for radio-group UX
  DOM.questionWrap.querySelectorAll('.option-label').forEach(function(btn) {
    btn.addEventListener('keydown', function(e) {
      if (e.key === ' ') { e.preventDefault(); btn.click(); }
    });
  });

  // Nav button states
  DOM.btnPrev.disabled            = (index === 0);
  const isLast                    = (index === SHUFFLED_QUESTIONS.length - 1);
  DOM.btnNext.style.display       = isLast ? 'none'        : 'inline-flex';
  DOM.btnSubmit.style.display     = isLast ? 'inline-flex' : 'none';

  // Reset warning state on every fresh render
  DOM.unansweredHint.classList.remove('show');
}

function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Navigation ───────────────────────────────────────────────────
DOM.btnPrev.addEventListener('click', function() {
  if (state.currentQ > 0) renderQuestion(state.currentQ - 1);
});

DOM.btnNext.addEventListener('click', function() {
  if (state.currentQ < SHUFFLED_QUESTIONS.length - 1) renderQuestion(state.currentQ + 1);
});


















// ── Submit ───────────────────────────────────────────────────────
DOM.btnSubmit.addEventListener('click', function() {
  const unanswered = SHUFFLED_QUESTIONS.length - Object.keys(state.answers).length;
  DOM.modalMsg.textContent = unanswered > 0
    ? 'You have ' + unanswered + ' unanswered question' + (unanswered > 1 ? 's' : '') + '.'
    : 'All questions answered. Ready to submit?';
  DOM.modal.classList.add('open');
});

DOM.btnModalCancel.addEventListener('click',  () => DOM.modal.classList.remove('open'));
DOM.btnModalConfirm.addEventListener('click', function() {
  DOM.modal.classList.remove('open');
  finaliseSubmission();
});

// ── Scoring ──────────────────────────────────────────────────────
function calculateScores() {
  var empScore = 0, emotScore = 0, attachScore = 0;

  SHUFFLED_QUESTIONS.forEach(function(q, i) {
    var chosen = state.answers[i];
    if (chosen === undefined) return;
    if (q.section === 'A') {
      empScore   += (chosen === q.correctIndex) ? 2 : 0;
    } else if (q.section === 'B') {
      emotScore  += q.weights[chosen];
    } else if (q.section === 'C') {
      attachScore += q.weights[chosen];
    }
  });

  var totalScore = empScore + emotScore + attachScore;
  var recommendation =
    totalScore >= 140 ? 'Exceptional' :
    totalScore >= 120 ? 'Strong Hire' :
    totalScore >= 100 ? 'Hire'        :
    totalScore >= 80  ? 'Borderline'  : 'Reject';

  // referenceId is generated in finaliseSubmission() after confirmed submit
  return { empScore, emotScore, attachScore, totalScore, recommendation };
}

// ── Google Sheet ID — used to read last RefID via public JSON feed ─
const SHEET_ID  = '1Ep0ESBJb-QxzBfN2oxIAH0RFJOPvCsNb4NpvmyWOfDA';
const SHEET_TAB = 'General%20Assessment';

// ── Final Submission ─────────────────────────────────────────────
// Flow:
//   1. Read last RefID from Google Sheet public JSON feed (no CORS)
//   2. Increment → generate new RefID locally
//   3. POST all data + new RefID to Apps Script (no-cors, always saves)
//   4. Display RefID to candidate immediately
//
// Sheet must be shared as "Anyone with the link can VIEW"
// ─────────────────────────────────────────────────────────────────
async function finaliseSubmission() {
  if (state.submitted) return;
  state.submitted = true;
  if (state.timerRef) clearInterval(state.timerRef);
  disarmIntegrityMeasures();
  stopWebcamRecording();

  DOM.assSection.style.display   = 'none';
  DOM.timerDisplay.style.display = 'none';
  DOM.confSection.style.display  = 'block';
  DOM.refId.textContent          = 'Generating...';

  var scores  = calculateScores();
  var year    = new Date().getFullYear();
  var subTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // ── Step 1: Read last RefID from sheet via gviz/tq JSON feed ──
  // This endpoint is publicly readable with ZERO CORS restrictions.
  // Queries column B (Reference ID), orders by col A (Timestamp) DESC,
  // returns only the most recent row — giving us the last RefID.
  var referenceId = 'IDS/JOB/' + year + '/001';

  try {
    // Query: get ALL of column B (RefID column), last 1 row by row order
    // No WHERE filter — STARTS WITH is not supported by gviz query language
    var query = encodeURIComponent('SELECT B LIMIT 1000');
    var feedUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
      '/gviz/tq?tqx=out:json&sheet=' + SHEET_TAB + '&tq=' + query;

    var resp = await fetch(feedUrl);
    var text = await resp.text();

    // Strip Google's JS wrapper: /*O_o*/google.visualization.Query.setResponse({...});
    var start   = text.indexOf('{');
    var end     = text.lastIndexOf('}');
    var jsonStr = text.substring(start, end + 1);
    var json    = JSON.parse(jsonStr);
    var rows    = json && json.table && json.table.rows;

    if (rows && rows.length > 0) {
      // Scan from the BOTTOM to find the last valid IDS/JOB/YYYY/NNN entry
      for (var i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].c || !rows[i].c[0] || !rows[i].c[0].v) continue;
        var cellVal = String(rows[i].c[0].v).trim();
        var match   = cellVal.match(/^IDS\/JOB\/\d{4}\/(\d+)$/);
        if (match) {
          var nextSerial = parseInt(match[1], 10) + 1;
          referenceId    = 'IDS/JOB/' + year + '/' + String(nextSerial).padStart(3, '0');
          console.info('[IDS] Last RefID:', cellVal, '→ next:', referenceId);
          break;
        }
      }
    } else {
      console.info('[IDS] Sheet empty — starting at 001');
    }

  } catch(err) {
    console.warn('[IDS] Could not read sheet:', err.message);
    referenceId = 'IDS/JOB/' + year + '/' + String(Date.now() % 100000).padStart(5, '0');
  }

  // ── Step 2: POST to Apps Script with no-cors (always works) ───
  var hrRecord = {
    referenceId:    referenceId,
    name:           state.candidate.name,
    mobile:         state.candidate.mobile,
    email:          state.candidate.email,
    position:       state.candidate.position,
    track:          state.candidate.track,
    domain:         state.candidate.domain,
    empScore:       scores.empScore,
    emotScore:      scores.emotScore,
    attachScore:    scores.attachScore,
    totalScore:     scores.totalScore,
    recommendation: scores.recommendation,
    submissionTime: subTime,
    integrityNotes: state.integrityFlags.join(' | '),
    answers:        state.answers
  };

  // Fire and forget — no-cors always saves, response unreadable but not needed
  fetch(SCRIPT_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheetName:      'General Assessment',
      referenceId:    hrRecord.referenceId,
      name:           hrRecord.name,
      mobile:         hrRecord.mobile,
      email:          hrRecord.email,
      position:       hrRecord.position,
      track:          hrRecord.track,
      domain:         hrRecord.domain,
      empScore:       hrRecord.empScore,
      emotScore:      hrRecord.emotScore,
      attachScore:    hrRecord.attachScore,
      totalScore:     hrRecord.totalScore,
      recommendation: hrRecord.recommendation,
      submissionTime: hrRecord.submissionTime,
      integrityNotes: hrRecord.integrityNotes
    })
  }).catch(function(err) { console.warn('[IDS] POST error:', err.message); });

  try { sessionStorage.setItem('ids_hr_record', JSON.stringify(hrRecord)); } catch(e) {}

  localStorage.removeItem('assessmentRunning');
  localStorage.removeItem('assessmentTab');
  localStorage.removeItem('ids_answers');

  // ── Step 3: Show RefID immediately ────────────────────────────
  DOM.refId.textContent = referenceId;
}

// ── PDF Report (HR only) ──────────────────────────────────────────
function generatePDFReport() {
  var record;
  try { record = JSON.parse(sessionStorage.getItem('ids_hr_record')); } catch(e) { record = null; }
  if (!record) { alert('No submission data found in this session.'); return; }

  var rows = SHUFFLED_QUESTIONS.map(function(q, i) {
    var chosen = record.answers[i];
    var ans = (chosen !== undefined) ? q.options[chosen] : '— Not answered —';
    return '<tr><td>' + q.id + '</td><td>Section ' + q.section + '</td><td>' + q.text + '</td><td>' + ans + '</td></tr>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>HR Report – ' + record.name + '</title>' +
    '<style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}h1{color:#6C3FC5}h2{color:#4E2E9A;margin:18px 0 8px}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#6C3FC5;color:#fff;padding:7px 10px;text-align:left}' +
    'td{padding:6px 10px;border-bottom:1px solid #ddd6fe;vertical-align:top}tr:nth-child(even) td{background:#f8f5ff}' +
    '.conf{color:#DC2626;font-size:10px;text-align:center;border-top:1px solid #ddd;padding-top:10px;margin-top:20px}</style></head><body>' +
    '<h1>INTRADOS DESIGN STUDIO</h1><p style="color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:.1em">HR Confidential Assessment Report</p>' +
    '<h2>Candidate Details</h2><table>' +
    '<tr><th>Field</th><th>Value</th></tr>' +
    '<tr><td>Reference ID</td><td>' + record.referenceId + '</td></tr>' +
    '<tr><td>Name</td><td>' + record.name + '</td></tr>' +
    '<tr><td>Mobile</td><td>' + record.mobile + '</td></tr>' +
    '<tr><td>Email</td><td>' + record.email + '</td></tr>' +
    '<tr><td>Position</td><td>' + record.position + '</td></tr>' +
    '<tr><td>Submitted</td><td>' + record.submissionTime + '</td></tr></table>' +
    '<h2>Scores</h2><table><tr><th>Section</th><th>Score</th><th>Max</th></tr>' +
    '<tr><td>A – Employability</td><td>' + record.empScore + '</td><td>40</td></tr>' +
    '<tr><td>B – Emotional Regulation</td><td>' + record.emotScore + '</td><td>60</td></tr>' +
    '<tr><td>C – Attachment Style</td><td>' + record.attachScore + '</td><td>60</td></tr>' +
    '<tr><td><strong>Total</strong></td><td><strong>' + record.totalScore + '</strong></td><td><strong>160</strong></td></tr>' +
    '<tr><td><strong>Recommendation</strong></td><td colspan="2"><strong>' + record.recommendation + '</strong></td></tr></table>' +
    '<h2>All Responses</h2><table><tr><th>#</th><th>Section</th><th>Question</th><th>Answer</th></tr>' + rows + '</table>' +
    '<p class="conf">CONFIDENTIAL – FOR HR USE ONLY</p></body></html>';

  var win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(function() { win.print(); }, 500);
}

window.generatePDFReport = generatePDFReport;