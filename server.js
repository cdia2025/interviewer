const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Google Sheets Setup ---
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function ensureTabs() {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const titles = meta.data.sheets.map(s => s.properties.title);
    const required = ['Slots', 'Interviewers', 'Notes'];
    const requests = [];

    required.forEach(reqTitle => {
      if (!titles.includes(reqTitle)) {
        requests.push({ addSheet: { properties: { title: reqTitle } } });
      }
    });

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests }
      });
    }
  } catch (error) {
    console.error('Error ensuring tabs:', error);
  }
}

// API: Get Data
app.get('/api/data', async (req, res) => {
  try {
    if (!SPREADSHEET_ID) throw new Error("Missing SPREADSHEET_ID");
    
    const ranges = ['Slots!A:F', 'Interviewers!A:C', 'Notes!A:C'];
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });

    const slotRows = response.data.valueRanges[0].values || [];
    const invRows = response.data.valueRanges[1].values || [];
    const noteRows = response.data.valueRanges[2].values || [];

    const slots = slotRows.slice(1).map(r => ({
      id: r[0], interviewerId: r[1], date: r[2], startTime: r[3], endTime: r[4], isBooked: r[5] === 'true'
    }));

    const interviewers = invRows.slice(1).map(r => ({
      id: r[0], name: r[1], color: r[2]
    }));

    const notes = noteRows.slice(1).map(r => ({
      date: r[0], content: r[1], color: r[2]
    }));

    res.json({ slots, interviewers, notes });
  } catch (error) {
    console.error('Sheet Read Error:', error);
    res.status(500).json({ error: error.message, slots: [], interviewers: [], notes: [] });
  }
});

// API: Sync Data
app.post('/api/sync', async (req, res) => {
  try {
    const { slots, interviewers, notes } = req.body;
    if (!SPREADSHEET_ID) throw new Error("Missing SPREADSHEET_ID");

    const slotValues = [['ID', 'InterviewerID', 'Date', 'Start', 'End', 'IsBooked'], 
      ...slots.map(s => [s.id, s.interviewerId, s.date, s.startTime, s.endTime, s.isBooked])];
    
    const invValues = [['ID', 'Name', 'Color'], 
      ...interviewers.map(i => [i.id, i.name, i.color])];
    
    const noteValues = [['Date', 'Content', 'Color'], 
      ...notes.map(n => [n.date, n.content, n.color])];

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: 'Slots!A1', values: slotValues },
          { range: 'Interviewers!A1', values: invValues },
          { range: 'Notes!A1', values: noteValues }
        ]
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Sheet Write Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: DeepSeek Proxy
app.post('/api/ai-parse', async (req, res) => {
  try {
    const { text, currentYear } = req.body;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) return res.status(500).json({ error: "DeepSeek API Key not configured" });

    const systemPrompt = `
      You are a scheduling assistant. Extract interviewer availability from text.
      Current Year: ${currentYear}.
      Output strictly pure JSON array of objects. No markdown, no backticks.
      Format: [{"interviewerName": "Name", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm"}]
      Rules:
      - 24h format for time.
      - If only start time given, assume 1 hour duration.
      - Handle multiple people/dates.
    `;

    const response = await axios.post('https://api.deepseek.com/chat/completions', {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      stream: false,
      response_format: { type: "json_object" } 
    }, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let parsed;
    try {
        parsed = JSON.parse(cleanJson);
        if (!Array.isArray(parsed) && parsed.interviewers) parsed = parsed.interviewers;
        if (!Array.isArray(parsed) && parsed.slots) parsed = parsed.slots;
        if (!Array.isArray(parsed)) parsed = Object.values(parsed)[0];
        if (!Array.isArray(parsed)) throw new Error("Not an array");
    } catch (e) {
        throw e;
    }

    res.json(parsed);

  } catch (error) {
    console.error('DeepSeek Error:', error.response?.data || error.message);
    res.status(500).json({ error: "AI Processing Failed" });
  }
});

// Serve static files from 'dist' (Vite build output)
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React Routing (SPA fallback)
app.get('*', (req, res) => {
  // If request is not starting with /api, serve index.html
  if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
      res.status(404).json({ error: "Not found" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.SPREADSHEET_ID) ensureTabs();
});