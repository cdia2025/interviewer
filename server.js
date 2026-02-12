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

// --- Cache ---
let cachedData = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

const invalidateCache = () => {
  cachedData = null;
  lastCacheTime = 0;
};

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

// --- Helper Functions ---

async function findRowIndexById(sheetName, id) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`, 
  });
  const rows = response.data.values || [];
  const index = rows.findIndex(row => String(row[0]).trim() === String(id).trim());
  return index;
}

async function findRowIndexByDate(sheetName, dateStr) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`, 
  });
  const rows = response.data.values || [];
  const index = rows.findIndex(row => row[0] === dateStr);
  return index;
}

async function getSheetIdByTitle(title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === title);
  return sheet ? sheet.properties.sheetId : null;
}

// --- API Routes ---

// GET Data (Read All)
app.get('/api/data', async (req, res) => {
  try {
    if (!SPREADSHEET_ID) throw new Error("Missing SPREADSHEET_ID");
    
    // Check Cache
    const now = Date.now();
    if (cachedData && (now - lastCacheTime < CACHE_TTL)) {
       return res.json(cachedData);
    }
    
    const ranges = ['Slots!A:F', 'Interviewers!A:C', 'Notes!A:C'];
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });

    const slotRows = response.data.valueRanges[0].values || [];
    const invRows = response.data.valueRanges[1].values || [];
    const noteRows = response.data.valueRanges[2].values || [];

    const slots = slotRows.slice(1)
      .map(r => ({
        id: r[0], interviewerId: r[1], date: r[2], startTime: r[3], endTime: r[4], isBooked: r[5] === 'true'
      }))
      .filter(s => s.id && s.date); 

    const interviewers = invRows.slice(1)
      .map(r => ({
        id: r[0], name: r[1], color: r[2]
      }))
      .filter(i => i.id && i.name);

    const notes = noteRows.slice(1)
      .map(r => ({
        date: r[0], content: r[1], color: r[2]
      }))
      .filter(n => n.date);

    const result = { slots, interviewers, notes };
    
    // Update Cache
    cachedData = result;
    lastCacheTime = now;

    res.json(result);
  } catch (error) {
    console.error('Sheet Read Error:', error);
    res.status(500).json({ error: error.message, slots: [], interviewers: [], notes: [] });
  }
});

// --- ATOMIC OPERATIONS ---

// 1. Slots Operations

app.post('/api/slots', async (req, res) => {
  invalidateCache();
  try {
    const s = req.body;
    const values = [[s.id, s.interviewerId, s.date, s.startTime, s.endTime, s.isBooked]];
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Slots!A:F',
      valueInputOption: 'RAW',
      requestBody: { values }
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Add Slot Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/slots/batch', async (req, res) => {
  invalidateCache();
  try {
    const slots = req.body;
    if (!slots || slots.length === 0) return res.json({ success: true });

    const values = slots.map(s => [s.id, s.interviewerId, s.date, s.startTime, s.endTime, s.isBooked]);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Slots!A:F',
      valueInputOption: 'RAW',
      requestBody: { values }
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Batch Add Slots Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/slots/:id', async (req, res) => {
  invalidateCache();
  try {
    const { id } = req.params;
    const s = req.body;
    const rowIndex = await findRowIndexById('Slots', id);

    if (rowIndex === -1) {
      const values = [[s.id, s.interviewerId, s.date, s.startTime, s.endTime, s.isBooked]];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Slots!A:F',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    } else {
      const range = `Slots!A${rowIndex + 1}:F${rowIndex + 1}`;
      const values = [[s.id, s.interviewerId, s.date, s.startTime, s.endTime, s.isBooked]];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Update Slot Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/slots/:id', async (req, res) => {
  invalidateCache();
  try {
    const { id } = req.params;
    const sheetId = await getSheetIdByTitle('Slots');
    if (sheetId === null) throw new Error("Sheet not found");

    let found = true;
    while (found) {
        const rowIndex = await findRowIndexById('Slots', id);
        if (rowIndex !== -1) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
              requests: [{
                deleteDimension: {
                  range: {
                    sheetId: sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1
                  }
                }
              }]
            }
          });
        } else {
            found = false;
        }
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Delete Slot Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 2. Notes Operations

app.post('/api/notes', async (req, res) => {
  invalidateCache();
  try {
    const n = req.body;
    const rowIndex = await findRowIndexByDate('Notes', n.date);

    if (rowIndex === -1) {
      const values = [[n.date, n.content, n.color]];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Notes!A:C',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    } else {
      const range = `Notes!A${rowIndex + 1}:C${rowIndex + 1}`;
      const values = [[n.date, n.content, n.color]];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Save Note Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/notes/:date', async (req, res) => {
  invalidateCache();
  try {
    const { date } = req.params;
    const rowIndex = await findRowIndexByDate('Notes', date);
    
    if (rowIndex !== -1) {
      const sheetId = await getSheetIdByTitle('Notes');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1
              }
            }
          }]
        }
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Delete Note Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3. Interviewers Operations

app.post('/api/interviewers', async (req, res) => {
  invalidateCache();
  try {
    const inv = req.body;
    const rowIndex = await findRowIndexById('Interviewers', inv.id);

    if (rowIndex === -1) {
       const values = [[inv.id, inv.name, inv.color]];
       await sheets.spreadsheets.values.append({
         spreadsheetId: SPREADSHEET_ID,
         range: 'Interviewers!A:C',
         valueInputOption: 'RAW',
         requestBody: { values }
       });
    } else {
       const range = `Interviewers!A${rowIndex + 1}:C${rowIndex + 1}`;
       const values = [[inv.id, inv.name, inv.color]];
       await sheets.spreadsheets.values.update({
         spreadsheetId: SPREADSHEET_ID,
         range,
         valueInputOption: 'RAW',
         requestBody: { values }
       });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Save Interviewer Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai-parse', async (req, res) => {
  try {
    const { text, currentYear } = req.body;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "DeepSeek API Key not configured" });

    const systemPrompt = `
      You are a specialized scheduling assistant. 
      Your Task: Extract interviewer availability from unstructured text.
      Current Year: ${currentYear}.
      Output Format: Strictly a JSON array of objects. NO markdown.
      [ { "interviewerName": "Name", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm" } ]
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    let parsed = JSON.parse(cleanJson);
    if (!Array.isArray(parsed) && parsed.interviewers) parsed = parsed.interviewers;
    if (!Array.isArray(parsed) && parsed.slots) parsed = parsed.slots;
    if (!Array.isArray(parsed)) parsed = Object.values(parsed).find(v => Array.isArray(v)) || [];

    res.json(parsed);

  } catch (error) {
    console.error('DeepSeek Error:', error.response?.data || error.message);
    res.status(500).json({ error: "AI Processing Failed" });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
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