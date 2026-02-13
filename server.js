const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Google Sheets Setup ---
const authConfig = {
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
};

if (process.env.GOOGLE_CREDENTIALS) {
  try {
    authConfig.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch (err) {
    console.warn('Warning: GOOGLE_CREDENTIALS provided but invalid JSON. Attempting to use default credentials (ADC).');
  }
}

const auth = new google.auth.GoogleAuth(authConfig);
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function ensureTabs() {
  if (!SPREADSHEET_ID) return;
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
      console.log('Tabs ensured/created.');
    }
  } catch (error) {
    console.error('Error ensuring tabs. Please check Service Account permissions on the Sheet.', error.message);
  }
}

// --- Helper Functions ---

async function findRowIndexById(sheetName, id) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`, 
  });
  const rows = response.data.values || [];
  const index = rows.findIndex(row => row[0] === id);
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

app.get('/api/data', async (req, res) => {
  try {
    if (!SPREADSHEET_ID) throw new Error("Server Error: Missing SPREADSHEET_ID environment variable");
    
    const ranges = ['Slots!A:F', 'Interviewers!A:C', 'Notes!A:C'];
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });

    const slotRows = response.data.valueRanges[0].values || [];
    const invRows = response.data.valueRanges[1].values || [];
    const noteRows = response.data.valueRanges[2].values || [];

    const slots = slotRows.slice(1).map(r => ({
      id: r[0], 
      interviewerId: r[1], 
      date: r[2], 
      startTime: r[3], 
      endTime: r[4], 
      isBooked: String(r[5]).toLowerCase() === 'true' 
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
    res.status(500).json({ error: error.message || "Unknown error reading Google Sheets" });
  }
});

// --- ATOMIC OPERATIONS ---

app.post('/api/slots', async (req, res) => {
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
  try {
    const { id } = req.params;
    const rowIndex = await findRowIndexById('Slots', id);
    
    if (rowIndex !== -1) {
      const sheetId = await getSheetIdByTitle('Slots');
      if (sheetId === null) throw new Error("Sheet not found");

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
    console.error('Delete Slot Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/notes', async (req, res) => {
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

app.post('/api/interviewers', async (req, res) => {
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

// --- API: Google Gemini Proxy ---
app.post('/api/ai-parse', async (req, res) => {
  try {
    const { text, currentYear } = req.body;
    
    // Coding Guideline: The API key must be obtained exclusively from the environment variable process.env.API_KEY.
    const apiKey = process.env.API_KEY;
    
    if (!apiKey) {
        console.error("Missing API Key");
        return res.status(500).json({ error: "Server Error: API Key not configured" });
    }

    const systemPrompt = `
      You are a specialized scheduling assistant. 
      Your Task: Extract interviewer availability from unstructured text.
      Current Year: ${currentYear}.
      
      Input Scenarios:
      1. Single person: "John 5/12 10-12"
      2. Multiple people: "Alex: 5/12 9am-11am, Sarah: 5/13 2pm-4pm"
      3. Implicit Name: "5/12 10:00-12:00" (If no name found, use "Unknown")
      4. Month/Day handling: Parse "5月12日", "5/12", "May 12th".

      Output Format:
      Strictly a JSON array of objects.
      [
        { "interviewerName": "Name", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm" }
      ]

      Rules:
      1. Time: Convert all times to 24-hour format (HH:mm). e.g., "2pm" -> "14:00".
      2. Date: Use the Current Year (${currentYear}) unless specified. Format YYYY-MM-DD.
      3. Multiple Slots: If a person has multiple times, create separate objects.
      4. Name Persistence: If a line starts with a name, apply it to all following times until a new name appears.
    `;

    // Coding Guideline: Use @google/genai SDK
    // Using dynamic import because server.js is CommonJS
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    
    // Coding Guideline: Use 'gemini-3-flash-preview' for basic text tasks
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: systemPrompt + "\n---\nUser Input:\n" + text,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    const content = response.text;
    const parsed = JSON.parse(content);
    
    res.json(parsed);

  } catch (error) {
    console.error('AI Error:', error.message);
    res.status(500).json({ 
        error: "AI Parsing Failed", 
        details: error.message 
    });
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