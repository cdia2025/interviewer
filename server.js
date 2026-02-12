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

// --- Helper Functions ---

// Find row index by ID (Column A) in a specific sheet
async function findRowIndexById(sheetName, id) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`, 
  });
  const rows = response.data.values || [];
  // Arrays are 0-indexed, Sheets rows are 1-indexed. 
  // API responses map index 0 to Row 1.
  // Ensure we compare strings
  const index = rows.findIndex(row => String(row[0]).trim() === String(id).trim());
  return index; // Returns -1 if not found, or 0-based index (Row 1 = index 0)
}

// Find row index by Date (Column A) for Notes
async function findRowIndexByDate(sheetName, dateStr) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`, 
  });
  const rows = response.data.values || [];
  const index = rows.findIndex(row => row[0] === dateStr);
  return index;
}

// Get Sheet ID by Title (needed for deleteDimension)
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
    
    const ranges = ['Slots!A:F', 'Interviewers!A:C', 'Notes!A:C'];
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });

    const slotRows = response.data.valueRanges[0].values || [];
    const invRows = response.data.valueRanges[1].values || [];
    const noteRows = response.data.valueRanges[2].values || [];

    // Filter out rows that don't have an ID or Date to prevent frontend crashes
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

    res.json({ slots, interviewers, notes });
  } catch (error) {
    console.error('Sheet Read Error:', error);
    res.status(500).json({ error: error.message, slots: [], interviewers: [], notes: [] });
  }
});

// --- ATOMIC OPERATIONS ---

// 1. Slots Operations

// ADD Slot (Single)
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

// ADD Slots (Batch)
app.post('/api/slots/batch', async (req, res) => {
  try {
    const slots = req.body; // Array of slots
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

// UPDATE Slot
app.put('/api/slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const s = req.body;
    const rowIndex = await findRowIndexById('Slots', id);

    if (rowIndex === -1) {
      // If not found, create it (fallback)
      const values = [[s.id, s.interviewerId, s.date, s.startTime, s.endTime, s.isBooked]];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Slots!A:F',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    } else {
      // Update specific row (Row index 0 is A1, so rowIndex + 1)
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

// DELETE Slot
app.delete('/api/slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sheetId = await getSheetIdByTitle('Slots');
    if (sheetId === null) throw new Error("Sheet not found");

    // Loop to delete duplicates if any exist
    // This fixes the issue where deleting once leaves a duplicate behind
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

// 2. Notes Operations (Keyed by Date)

// UPSERT Note
app.post('/api/notes', async (req, res) => {
  try {
    const n = req.body;
    const rowIndex = await findRowIndexByDate('Notes', n.date);

    if (rowIndex === -1) {
      // Create new
      const values = [[n.date, n.content, n.color]];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Notes!A:C',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    } else {
      // Update existing
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

// DELETE Note
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

// 3. Interviewers Operations

// UPSERT Interviewer (If ID exists update, else add. Simplified to Add if not exists)
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
       // Optional: Update name/color if it changes, but for now we assume they are static or low freq
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


// API: DeepSeek Proxy
app.post('/api/ai-parse', async (req, res) => {
  try {
    const { text, currentYear } = req.body;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) return res.status(500).json({ error: "DeepSeek API Key not configured" });

    // Enhanced Prompt for complex parsing
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
      Strictly a JSON array of objects. NO markdown formatting, NO backticks.
      [
        { "interviewerName": "Name", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm" }
      ]

      Rules:
      1. Time: Convert all times to 24-hour format (HH:mm). e.g., "2pm" -> "14:00".
      2. Date: Use the Current Year (${currentYear}) unless specified. Format YYYY-MM-DD.
      3. Multiple Slots: If a person has multiple times, create separate objects.
      4. Name Persistence: If a line starts with a name, apply it to all following times until a new name appears.
      5. Do not hallucinate. If info is missing, do your best or omit.
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
        if (!Array.isArray(parsed)) {
            const values = Object.values(parsed);
            const foundArray = values.find(v => Array.isArray(v));
            parsed = foundArray || [];
        }
    } catch (e) {
        console.error("JSON Parse Error", e);
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