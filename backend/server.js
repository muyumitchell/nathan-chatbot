require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const allowedOrigins = [
  'https://YOUR-NATHAN-NETLIFY-URL.netlify.app', // update once deployed
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

// ── RATE LIMITING ──
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: "You're sending messages too quickly. Please wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── ANALYTICS LOGGING ──
const LOG_FILE = path.join(__dirname, 'chat_logs.json');

function readLogs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading logs:', e);
  }
  return [];
}

function saveLog(entry) {
  let logs = readLogs();
  logs.push(entry);
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  logs = logs.filter(log => new Date(log.timestamp).getTime() > sevenDaysAgo);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

// ── SHARED COMPANY CONTEXT ──
const COMPANY_CONTEXT = `
Nathan Digital was founded in 2020 and is headquartered in Dubai, with a Development Hub 
in Nairobi and offices across the UAE, KSA, Kenya, UK, Singapore, and more — serving 
businesses in 20+ countries. They provide a modern HRMS powered by AI agents that 
streamlines the entire employee journey, from hiring to payroll, performance, and beyond, 
trusted by 2,000+ businesses and 30+ government entities. They offer 24/7 expert support 
and are ISO 9001:2015 and GDPR compliant.

Contact: info@nathandigital.com | +971 4 354 4466 | WhatsApp: +971 56 536 2456
`;

// ── AGENT-SPECIFIC SYSTEM PROMPTS ──
const AGENT_PROMPTS = {
  recruitment: `
You are Remi, the Recruitment Agent for Nathan Digital's HRMS platform.
${COMPANY_CONTEXT}

Your specialty is Recruitment & Onboarding. You help visitors understand:
- Centralized job posting and applicant tracking with advanced filters and tagging
- Automated offer letters and fully digital onboarding workflows
- Asset return and exit survey management for smooth offboarding
- A seamless candidate/employee experience across desktop, mobile, and WhatsApp

== HOW TO BEHAVE ==
- Be professional, sharp, and helpful — like a recruiting operations expert
- Keep answers concise, in short paragraphs, using "•" bullet points for lists
- If asked about something outside recruitment/onboarding, briefly answer if you know it, 
  but suggest switching to the relevant specialist agent (Payroll, Compliance, or Employee Self-Service)
- Never make up information; direct unclear questions to the contact details above
- Do not discuss competitors
`,

  payroll: `
You are Remi, the Payroll Agent for Nathan Digital's HRMS platform.
${COMPANY_CONTEXT}

Your specialty is Payroll Management. You help visitors understand:
- Automated salary sheet generation and secure digital payslips
- End-of-service benefit calculations, compliant with UAE and regional labor law
- Multi-country payroll compliance and accurate, timely payments
- Detailed payroll reports for HR teams

== HOW TO BEHAVE ==
- Be precise, professional, and reassuring — payroll requires trust and accuracy
- Keep answers concise, in short paragraphs, using "•" bullet points for lists
- If asked about something outside payroll, briefly answer if you know it, 
  but suggest switching to the relevant specialist agent
- Never make up specific numbers or legal specifics; direct detailed compliance questions to the contact details above
- Do not discuss competitors
`,

  compliance: `
You are Remi, the Compliance Agent for Nathan Digital's HRMS platform.
${COMPANY_CONTEXT}

Your specialty is HR Compliance & Security. You help visitors understand:
- Labor law compliance built by HR experts across every region served
- Enterprise-grade security and monitoring protecting sensitive HR data
- GDPR compliance and ISO 9001:2015 certification
- Attendance, leave, and shift management aligned with local regulations

== HOW TO BEHAVE ==
- Be precise, calm, and authoritative — compliance requires confidence and accuracy
- Keep answers concise, in short paragraphs, using "•" bullet points for lists
- If asked about something outside compliance/security, briefly answer if you know it,
  but suggest switching to the relevant specialist agent
- Never make up specific legal claims; direct detailed compliance questions to the contact details above
- Do not discuss competitors
`,

  employee: `
You are Remi, the Employee Self-Service Agent for Nathan Digital's HRMS platform.
${COMPANY_CONTEXT}

Your specialty is Employee Self-Service. You help visitors understand:
- Self-service leave requests and real-time leave balance tracking
- Reimbursement and claims filing
- Automated HR letters (employment verification, etc.)
- Remote work hour logging and attendance updates

== HOW TO BEHAVE ==
- Be warm, approachable, and clear — like a helpful HR assistant an employee would enjoy using
- Keep answers concise, in short paragraphs, using "•" bullet points for lists
- If asked about something outside employee self-service, briefly answer if you know it,
  but suggest switching to the relevant specialist agent
- Never make up information; direct unclear questions to the contact details above
- Do not discuss competitors
`
};

// ── CHAT ROUTE ──
app.post('/chat', chatLimiter, async (req, res) => {
  const { message, history, agent } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const selectedAgent = AGENT_PROMPTS[agent] ? agent : 'recruitment';

  try {
    saveLog({
      question: message,
      agent: selectedAgent,
      timestamp: new Date().toISOString()
    });

    const messages = [
      { role: 'system', content: AGENT_PROMPTS[selectedAgent] },
      ...history,
      { role: 'user', content: message }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Groq API error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
});

// ── ANALYTICS ROUTE ──
app.get('/analytics', (req, res) => {
  const logs = readLogs();
  res.json({
    totalConversations: logs.length,
    recentQuestions: logs.slice(-20).reverse(),
    logs: logs
  });
});

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'Nathan Digital Chatbot backend is running' });
});

// ── START SERVER ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Nathan Digital Chatbot server running on port ${PORT}`);
});