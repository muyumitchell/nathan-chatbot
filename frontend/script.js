// ── CONFIG ──
const BACKEND_URL = 'http://localhost:3000/chat'; // will update once deployed to Render

// Generate floating particles for background
const pageBg = document.getElementById('pageBg');
for (let i = 0; i < 18; i++) {
  const p = document.createElement('div');
  p.className = 'particle';
  p.style.left = Math.random() * 100 + '%';
  p.style.bottom = '-10px';
  p.style.animationDuration = (8 + Math.random() * 8) + 's';
  p.style.animationDelay = (Math.random() * 8) + 's';
  pageBg.appendChild(p);
}

// ── GRAB ELEMENTS ──
const bubbleBtn = document.getElementById('bubbleBtn');
const unreadBadge = document.getElementById('unreadBadge');
const chatWindow = document.getElementById('chatWindow');
const closeBtn = document.getElementById('closeBtn');
const messagesEl = document.getElementById('messages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const agentLabel = document.getElementById('agentLabel');
const agentChips = document.querySelectorAll('.agent-chip');

// ── STATE ──
let conversationHistory = [];
let chatOpened = false;
let currentAgent = 'recruitment';

// ── AGENT GREETINGS ──
const AGENT_GREETINGS = {
  recruitment: "Hi, I'm Remi — your Recruitment Agent 🧑‍💼. Ask me about job posting, applicant tracking, offer letters, or digital onboarding.",
  payroll: "Hi, I'm Remi — your Payroll Agent 💰. Ask me about salary processing, payslips, or end-of-service benefits.",
  compliance: "Hi, I'm Remi — your Compliance Agent 🛡️. Ask me about labor law compliance, data security, or certifications.",
  employee: "Hi, I'm Remi — your Employee Self-Service Agent 🙋. Ask me about leave requests, claims, or HR letters."
};

// ── START: chat window starts hidden ──
chatWindow.classList.add('hidden');

// ── HELPER: get current time ──
function getTime() {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

// ── HELPER: format message text (bullets/paragraphs) ──
function formatMessage(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n').filter(line => line.trim() !== '');
  let html = '';
  let inList = false;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('•')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${trimmed.slice(1).trim()}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${trimmed}</p>`;
    }
  });

  if (inList) html += '</ul>';
  return html;
}

// ── HELPER: add a message bubble ──
function addMessage(text, type) {
  const msg = document.createElement('div');
  msg.className = 'message ' + type;

  if (type === 'bot') {
    msg.innerHTML = formatMessage(text);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy response';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text);
      copyBtn.innerHTML = '✓';
      setTimeout(() => { copyBtn.innerHTML = '📋'; }, 1500);
    };
    msg.appendChild(copyBtn);
    msg.style.position = 'relative';
  } else {
    msg.textContent = text;
  }

  messagesEl.appendChild(msg);

  const time = document.createElement('div');
  time.className = 'timestamp';
  time.textContent = getTime();
  messagesEl.appendChild(time);

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── HELPER: typing indicator ──
function showTyping() {
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.id = 'typingIndicator';
  typing.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(typing);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

// ── CORE: send a message with streaming ──
async function sendMessage(text) {
  if (!text.trim()) return;

  addMessage(text, 'user');
  conversationHistory.push({ role: 'user', content: text });

  const msgEl = document.createElement('div');
  msgEl.className = 'message bot';
  msgEl.style.position = 'relative';
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let fullReply = '';

  let wakingUpTimeout = setTimeout(() => {
    msgEl.innerHTML = `<em style="opacity:0.6;">Waking up Remi's servers, just a moment... ⏳</em>`;
  }, 3000);

  try {
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: conversationHistory.slice(0, -1),
        agent: currentAgent
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        const dataStr = line.replace('data: ', '');
        if (dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);
          if (data.content) {
            clearTimeout(wakingUpTimeout);
            fullReply += data.content;
            msgEl.innerHTML = formatMessage(fullReply);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          if (data.error) {
            msgEl.innerHTML = formatMessage(data.error);
          }
        } catch (e) {}
      }
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy response';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(fullReply);
      copyBtn.innerHTML = '✓';
      setTimeout(() => { copyBtn.innerHTML = '📋'; }, 1500);
    };
    msgEl.appendChild(copyBtn);

    conversationHistory.push({ role: 'assistant', content: fullReply });

    const time = document.createElement('div');
    time.className = 'timestamp';
    time.textContent = getTime();
    messagesEl.appendChild(time);

  } catch (error) {
    console.error('Error talking to backend:', error);
    msgEl.textContent = "I'm having trouble connecting right now. Please try again shortly.";
  }
}

// ── AGENT SWITCHING ──
agentChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const newAgent = chip.dataset.agent;
    if (newAgent === currentAgent) return;

    agentChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    currentAgent = newAgent;
    agentLabel.textContent = chip.dataset.label;

    // Reset conversation context for the new specialist
    conversationHistory = [];
    addMessage(AGENT_GREETINGS[newAgent], 'bot');
  });
});

// ── EVENT: open chat ──
function openChat() {
  chatWindow.classList.remove('hidden');
  chatWindow.style.animation = 'none';
  chatWindow.offsetHeight;
  chatWindow.style.animation = 'bounce-in-right 1.1s both';

  unreadBadge.classList.add('hidden');

  if (!chatOpened) {
    chatOpened = true;
    addMessage(AGENT_GREETINGS[currentAgent], 'bot');
  }
}

function closeChat() {
  console.log('closeChat was triggered!'); // TEMP DEBUG
  console.trace(); // TEMP DEBUG - shows us exactly what called this
  chatWindow.style.animation = 'bounce-out-left 1.5s both';
  setTimeout(() => {
    chatWindow.classList.add('hidden');
  }, 1500);
}

// ── WIRE UP EVENTS ──
bubbleBtn.addEventListener('click', openChat);
closeBtn.addEventListener('click', closeChat);

sendBtn.addEventListener('click', () => {
  const text = chatInput.value;
  chatInput.value = '';
  sendMessage(text);
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value;
    chatInput.value = '';
    sendMessage(text);
  }
});