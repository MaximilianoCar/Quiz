const ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbxOYwG4U49o9C_zesWVKMlGyieWv5qgA0ArdJalXUzSnZ1uQphX3IuJFY_o7lXzdDWL/exec';
const STORAGE_KEY = 'quiz-programacion-sesion';
const DEVTOOLS_GRACE_MS = 2 * 60 * 1000;

const state = { sessionId: null, total: 0, question: null, index: 0, answers: [], startedAt: null, remainingSeconds: null, timerId: null, secondsLeft: 0, devtoolsOpenedAt: null, devtoolsOpen: false, devtoolsTriggered: false, finalizing: false };
const $ = (selector) => document.querySelector(selector);
const screens = { start: $('#start-screen'), exam: $('#exam-screen'), result: $('#result-screen'), blocked: $('#blocked-screen') };

function showScreen(name) { Object.values(screens).forEach((screen) => screen.classList.remove('active')); screens[name].classList.add('active'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function formatDuration(milliseconds) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${Math.floor(seconds / 60)} min ${seconds % 60} s`; }
function readSession() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
function saveState() { const saved = readSession(); localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, sessionId: state.sessionId, total: state.total, index: state.index, answers: state.answers, startedAt: state.startedAt, devtoolsOpenedAt: state.devtoolsOpenedAt, devtoolsTriggered: state.devtoolsTriggered })); }

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Error de conexión: ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'El servidor rechazó la solicitud.');
  return data;
}

async function startExam(nombre, correo) {
  const data = await request(`${ENDPOINT_URL}?action=start&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`, { cache: 'no-store' });
  state.sessionId = data.sessionId; state.total = data.total; state.question = data.question; state.index = data.index; state.answers = []; state.startedAt = Date.now(); state.remainingSeconds = data.remainingSeconds;
  saveState(); showScreen('exam'); renderQuestion();
}

async function restoreSession() {
  const saved = readSession();
  if (!saved.sessionId) return;
  const data = await request(`${ENDPOINT_URL}?action=question&sessionId=${encodeURIComponent(saved.sessionId)}`, { cache: 'no-store' });
  state.sessionId = saved.sessionId; state.total = data.total; state.question = data.question; state.index = data.index; state.answers = saved.answers || []; state.startedAt = saved.startedAt || Date.now(); state.remainingSeconds = data.remainingSeconds; state.devtoolsOpenedAt = saved.devtoolsOpenedAt || null; state.devtoolsTriggered = Boolean(saved.devtoolsTriggered);
  showScreen('exam'); renderQuestion();
}

function renderQuestion() {
  const question = state.question;
  $('#progress').textContent = `Pregunta ${state.index + 1} de ${state.total}`;
  $('#question-title').textContent = question.pregunta;
  $('#code-container').innerHTML = question.tieneCodigo ? `<pre><code>${escapeHtml(question.codigo)}</code></pre>` : '';
  $('#options').innerHTML = question.opciones.map((option, index) => `<label class="option"><input type="radio" name="respuesta" value="${index}"><span>${escapeHtml(option)}</span></label>`).join('');
  $('#answer-form button[type="submit"]').textContent = state.index === state.total - 1 ? 'Finalizar' : 'Siguiente';
  startTimer(state.remainingSeconds ?? question.tiempoSegundos);
}

function startTimer(seconds) { clearInterval(state.timerId); state.secondsLeft = Number(seconds); updateTimer(); state.timerId = setInterval(() => { state.secondsLeft -= 1; updateTimer(); if (state.secondsLeft <= 0) submitAnswer(null); }, 1000); }
function updateTimer() { $('#timer').textContent = `${Math.max(0, state.secondsLeft)} s`; $('#timer').classList.toggle('warning', state.secondsLeft <= 10); }

async function submitAnswer(selectedIndex) {
  if (state.finalizing || !state.question) return;
  state.finalizing = true; clearInterval(state.timerId);
  try {
    const data = await request(ENDPOINT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'answer', sessionId: state.sessionId, questionId: state.question.id, seleccionada: selectedIndex }) });
    state.answers[state.index] = selectedIndex;
    if (data.finished) { renderResults(data); localStorage.removeItem(STORAGE_KEY); state.question = null; showScreen('result'); return; }
    state.index = data.index; state.question = data.question; state.remainingSeconds = data.remainingSeconds; state.finalizing = false; saveState(); renderQuestion();
  } catch (error) { state.finalizing = false; $('#registration-error').textContent = error.message; startTimer(Math.max(1, state.secondsLeft)); }
}

function renderResults(data) {
  $('#result-summary').textContent = `Puntaje: ${data.score}/${data.total} | Tiempo empleado: ${escapeHtml(data.tiempoEmpleado)}`;
  $('#result-details').innerHTML = data.details.map((detail) => `<div class="result-item"><h3>${escapeHtml(detail.id)}. ${escapeHtml(detail.pregunta)}</h3><p>Tu respuesta: ${escapeHtml(detail.seleccionadaTexto || 'Sin respuesta')}</p><p>Respuesta correcta: ${escapeHtml(detail.respuestaCorrectaTexto)}</p><p class="${detail.correcta ? 'correct' : 'incorrect'}">${escapeHtml(detail.correcta ? detail.mensajeExito : detail.mensajeFallo)}</p></div>`).join('');
  $('#send-status').textContent = 'Resultado calificado y enviado correctamente.';
}

async function finalizeExam(blocked) {
  if (state.finalizing || !state.sessionId) return;
  state.finalizing = true; clearInterval(state.timerId); showScreen(blocked ? 'blocked' : 'result');
  if (blocked) $('#blocked-status').textContent = 'Enviando el resultado...';
  try {
    const data = await request(ENDPOINT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'finish', sessionId: state.sessionId, bloqueado: blocked }) });
    if (blocked) $('#blocked-status').textContent = 'Resultado enviado y evaluación bloqueada.'; else renderResults(data);
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) { const message = 'No fue posible enviar el resultado. Informa al profesor.'; if (blocked) $('#blocked-status').textContent = message; else $('#send-status').textContent = message; console.error(error); }
}

function detectDevTools() {
  if (!state.sessionId || state.finalizing) return;
  const opened = window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160;
  if (opened && !state.devtoolsOpen) { state.devtoolsOpen = true; if (state.devtoolsTriggered) return finalizeExam(true); state.devtoolsTriggered = true; state.devtoolsOpenedAt = Date.now(); saveState(); window.alert('Advertencia: cierra las Herramientas de Desarrollador. Si permanecen abiertas durante 2 minutos, la evaluación terminará automáticamente.'); }
  else if (!opened) state.devtoolsOpen = false;
  if (state.devtoolsOpenedAt && Date.now() - state.devtoolsOpenedAt >= DEVTOOLS_GRACE_MS) finalizeExam(true);
}

$('#registration-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const nombre = String(form.get('nombre')).trim(); const correo = String(form.get('correo')).trim(); $('#registration-error').textContent = ''; if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { $('#registration-error').textContent = 'Ingresa un nombre y un correo institucional válido.'; return; } try { await startExam(nombre, correo); } catch (error) { $('#registration-error').textContent = error.message; } });
$('#answer-form').addEventListener('submit', (event) => { event.preventDefault(); const selected = document.querySelector('input[name="respuesta"]:checked'); submitAnswer(selected ? Number(selected.value) : null); });
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => { if (event.key === 'F12' || (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(event.key.toUpperCase()))) event.preventDefault(); });
setInterval(detectDevTools, 1000);
restoreSession().catch((error) => { localStorage.removeItem(STORAGE_KEY); console.error('No se pudo restaurar la sesión:', error); });