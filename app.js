/* Reemplaza esta URL por la URL /exec de tu Web App de Apps Script. */
const ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbxOYwG4U49o9C_zesWVKMlGyieWv5qgA0ArdJalXUzSnZ1uQphX3IuJFY_o7lXzdDWL/exec';
const STORAGE_KEY = 'quiz-programacion-estado';
const DEVTOOLS_GRACE_MS = 2 * 60 * 1000;

const state = {
  questions: [],
  currentIndex: 0,
  answers: [],
  startedAt: null,
  timerId: null,
  secondsLeft: 0,
  questionStartedAt: null,
  questionDuration: 0,
  devtoolsOpenedAt: null,
  devtoolsOpen: false,
  devtoolsTriggered: false,
  finalizing: false
};

const $ = (selector) => document.querySelector(selector);
const screens = {
  start: $('#start-screen'),
  exam: $('#exam-screen'),
  result: $('#result-screen'),
  blocked: $('#blocked-screen')
};

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove('active'));
  if (screens[name]) {
    screens[name].classList.add('active');
  }
}

async function loadQuestions() {
  const response = await fetch('preguntas.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar el cuestionario.');
  state.questions = await response.json();
  if (!Array.isArray(state.questions) || state.questions.length === 0) {
    throw new Error('El cuestionario está vacío.');
  }
}

function saveState() {
  const registration = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...registration,
      nombre: registration.nombre,
      correo: registration.correo,
      startedAt: state.startedAt,
      currentIndex: state.currentIndex,
      answers: state.answers,
      questionStartedAt: state.questionStartedAt,
      questionDuration: state.questionDuration,
      devtoolsOpenedAt: state.devtoolsOpenedAt,
      devtoolsTriggered: state.devtoolsTriggered,
      finalizing: state.finalizing
    })
  );
}

function renderQuestion() {
  const question = state.questions[state.currentIndex];
  $('#progress').textContent = `Pregunta ${state.currentIndex + 1} de ${state.questions.length}`;
  $('#question-title').textContent = question.pregunta;
  $('#code-container').innerHTML = question.tieneCodigo
    ? `<pre><code>${escapeHtml(question.codigo)}</code></pre>`
    : '';
  
  const savedAnswer = state.answers[state.currentIndex];
  $('#options').innerHTML = question.opciones
    .map((option, index) => {
      const isChecked = savedAnswer === index ? 'checked' : '';
      return `<label class="option"><input type="radio" name="respuesta" value="${index}" ${isChecked}><span>${escapeHtml(option)}</span></label>`;
    })
    .join('');

  // Si reanudamos la pregunta, calculamos el tiempo restante; si es nueva, usamos el total
  let initialSeconds = question.tiempoSegundos;
  if (state.questionStartedAt && state.questionDuration) {
    const elapsed = Math.floor((Date.now() - state.questionStartedAt) / 1000);
    initialSeconds = Math.max(0, state.questionDuration - elapsed);
  } else {
    state.questionStartedAt = Date.now();
    state.questionDuration = question.tiempoSegundos;
    saveState();
  }

  startTimer(initialSeconds);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

function startTimer(seconds) {
  clearInterval(state.timerId);
  state.secondsLeft = Number(seconds);
  updateTimer();
  state.timerId = setInterval(() => {
    state.secondsLeft -= 1;
    updateTimer();
    if (state.secondsLeft <= 0) {
      advanceQuestion();
    }
  }, 1000);
}

function updateTimer() {
  const timer = $('#timer');
  if (timer) {
    timer.textContent = `${Math.max(0, state.secondsLeft)} s`;
    timer.classList.toggle('warning', state.secondsLeft <= 10);
  }
}

function recordAnswer() {
  const selected = document.querySelector('input[name="respuesta"]:checked');
  state.answers[state.currentIndex] = selected ? Number(selected.value) : null;
  saveState();
}

function advanceQuestion() {
  if (state.finalizing) return;
  recordAnswer();
  
  // Limpiamos los tiempos de la pregunta anterior para que la siguiente arranque desde cero
  state.questionStartedAt = null;
  state.questionDuration = 0;

  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    saveState();
    renderQuestion();
  } else {
    finalizeExam(false);
  }
}

function calculateResult() {
  const details = state.questions.map((question, index) => {
    const selectedIndex = state.answers[index] ?? null;
    return {
      question,
      selectedIndex,
      correct: selectedIndex === question.respuestaCorrecta
    };
  });
  return { details, score: details.filter((detail) => detail.correct).length };
}

function renderResults(result) {
  $('#result-summary').textContent = `Puntaje: ${result.score}/${state.questions.length} | Tiempo empleado: ${formatDuration(Date.now() - state.startedAt)}`;
  $('#result-details').innerHTML = result.details
    .map(({ question, selectedIndex, correct }) => {
      const selected = selectedIndex === null ? 'Sin respuesta' : question.opciones[selectedIndex];
      const correctAnswer = question.opciones[question.respuestaCorrecta];
      return `<div class="result-item">
        <h3>${question.id}. ${escapeHtml(question.pregunta)}</h3>
        <p>Tu respuesta: ${escapeHtml(selected)}</p>
        <p>Respuesta correcta: ${escapeHtml(correctAnswer)}</p>
        <p class="${correct ? 'correct' : 'incorrect'}">${escapeHtml(correct ? question.mensajeExito : question.mensajeFallo)}</p>
      </div>`;
    })
    .join('');
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

async function sendResults(result) {
  if (!ENDPOINT_URL || ENDPOINT_URL.startsWith('PEGAR_AQUI')) return false;

  const registration = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const payload = {
    nombre: registration.nombre,
    correo: registration.correo,
    respuestas: result.details.map(({ question, selectedIndex, correct }) => ({
      id: question.id,
      seleccionada: selectedIndex,
      correcta: question.respuestaCorrecta,
      esCorrecta: correct
    })),
    notaFinal: `${result.score}/${state.questions.length}`,
    tiempoEmpleado: formatDuration(Date.now() - state.startedAt)
  };

  const response = await fetch(ENDPOINT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Error en el servidor: ${response.statusText}`);
  }

  return true;
}

async function finalizeExam(blocked) {
  if (state.finalizing) return;
  state.finalizing = true;
  clearInterval(state.timerId);
  recordAnswer();

  const result = calculateResult();
  if (blocked) {
    showScreen('blocked');
    $('#blocked-status').textContent = 'Enviando el resultado...';
  } else {
    renderResults(result);
    showScreen('result');
    $('#send-status').textContent = 'Enviando el resultado...';
  }

  try {
    const sent = await sendResults(result);
    const status = sent
      ? 'Resultado enviado correctamente.'
      : 'Resultado calculado. Configura ENDPOINT_URL para activar el envío.';
    if (blocked) $('#blocked-status').textContent = status;
    else $('#send-status').textContent = status;
  } catch (error) {
    const errorMsg = 'No fue posible enviar el resultado. Conserva esta pantalla para informar al profesor.';
    if (blocked) $('#blocked-status').textContent = errorMsg;
    else $('#send-status').textContent = errorMsg;
    console.error(error);
  }

  localStorage.removeItem(STORAGE_KEY);
}

function detectDevTools() {
  if (!state.startedAt || state.finalizing) return;

  const sizeThreshold = 160;
  // 1. Detección por diferencia de dimensiones (paneles lateral/inferior acoplados)
  const openedByResize =
    window.outerWidth - window.innerWidth > sizeThreshold ||
    window.outerHeight - window.innerHeight > sizeThreshold;

  // 2. Detección por retardo con debugger (funciona con paneles desacoplados o flotantes)
  const start = performance.now();
  debugger;
  const openedByDebugger = performance.now() - start > 100;

  const opened = openedByResize || openedByDebugger;

  if (opened && !state.devtoolsOpen) {
    state.devtoolsOpen = true;
    if (state.devtoolsTriggered) {
      finalizeExam(true);
      return;
    }
    state.devtoolsTriggered = true;
    state.devtoolsOpenedAt = Date.now();
    saveState();
    window.alert(
      'Advertencia: cierra las Herramientas de Desarrollador. Si permanecen abiertas durante 2 minutos, la evaluación terminará automáticamente.'
    );
  } else if (!opened) {
    state.devtoolsOpen = false;
  }

  if (state.devtoolsOpenedAt && Date.now() - state.devtoolsOpenedAt >= DEVTOOLS_GRACE_MS) {
    finalizeExam(true);
  }
}

async function initSession() {
  const savedStateRaw = localStorage.getItem(STORAGE_KEY);
  if (!savedStateRaw) return;

  try {
    const saved = JSON.parse(savedStateRaw);
    if (saved.startedAt && !saved.finalizing) {
      await loadQuestions();
      state.startedAt = saved.startedAt;
      state.currentIndex = saved.currentIndex || 0;
      state.answers = saved.answers || [];
      state.questionStartedAt = saved.questionStartedAt || null;
      state.questionDuration = saved.questionDuration || 0;
      state.devtoolsOpenedAt = saved.devtoolsOpenedAt || null;
      state.devtoolsTriggered = saved.devtoolsTriggered || false;

      showScreen('exam');
      renderQuestion();
    }
  } catch (error) {
    console.error('No se pudo restaurar la sesión:', error);
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Event Listeners
$('#registration-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const nombre = String(form.get('nombre')).trim();
  const correo = String(form.get('correo')).trim();
  $('#registration-error').textContent = '';

  if (!nombre || !correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    $('#registration-error').textContent = 'Ingresa un nombre y un correo institucional válido.';
    return;
  }

  try {
    await loadQuestions();
    state.startedAt = Date.now();
    state.currentIndex = 0;
    state.answers = [];
    state.questionStartedAt = null;
    state.questionDuration = 0;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        nombre,
        correo,
        startedAt: state.startedAt,
        currentIndex: 0,
        answers: []
      })
    );

    showScreen('exam');
    renderQuestion();
  } catch (error) {
    $('#registration-error').textContent = error.message;
  }
});

$('#answer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  advanceQuestion();
});

document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (
    event.key === 'F12' ||
    (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(event.key.toUpperCase()))
  ) {
    event.preventDefault();
  }
});

// Inicialización de la aplicación
setInterval(detectDevTools, 1000);
initSession();