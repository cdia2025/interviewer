import React, { Component, useState, useEffect, useMemo } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMinutes,
  parse,
  isValid
} from 'date-fns';
import { AvailabilitySlot, Interviewer, ParsedSlot, DayInfo, DayNote, NoteColor } from './types';
import { INTERVIEWER_COLORS } from './constants';
import { Button } from './components/Button';
import { AIInputModal } from './components/AIInputModal';
import { SlotEditorModal } from './components/SlotEditorModal';
import { NoteEditorModal } from './components/NoteEditorModal';
import { StatisticsModal } from './components/StatisticsModal';
import { BatchAddModal } from './components/BatchAddModal';
import { exportToExcel } from './services/exportService';

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Robust UUID generator that works in all environments
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch(e) {
      // Fallback if crypto.randomUUID throws (insecure contexts)
    }
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const NOTE_STYLES: Record<string, string> = {
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-100',
  blue: 'bg-blue-50 text-blue-800 border-blue-100',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  red: 'bg-red-50 text-red-800 border-red-100',
  purple: 'bg-purple-50 text-purple-800 border-purple-100',
};

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Simple Error Boundary Component
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h2 className="text-xl font-bold text-red-600 mb-4">應用程式發生錯誤</h2>
          <pre className="text-left bg-gray-100 p-4 rounded overflow-auto text-sm">
            {this.state.error?.toString()}
          </pre>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">重新整理</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppContent: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [selectedInterviewerIds, setSelectedInterviewerIds] = useState<Set<string>>(new Set());
  const [showNames, setShowNames] = useState(true);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Modals state
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<(AvailabilitySlot & { interviewer: Interviewer }) | undefined>();
  
  // Note Modal state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNoteDate, setEditingNoteDate] = useState<Date | null>(null);

  // Clipboard State for Notes
  const [clipboardNote, setClipboardNote] = useState<{content: string, color: string} | null>(null);

  // --- API Functions ---
  const fetchData = async (showSyncState = false) => {
    try {
      if (showSyncState) setIsSyncing(true);
      else setIsLoading(true);
      
      const res = await fetch('/api/data');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server Error: ${res.status}`);
      }
      const data = await res.json();
      
      // Robustly map slots to ensure no undefined fields cause crashes
      const safeSlots = (data.slots || []).map((s: any) => ({
        ...s,
        startTime: s.startTime || '09:00', // Default if missing
        endTime: s.endTime || '09:30',     // Default if missing
        isBooked: !!s.isBooked
      }));

      setSlots(safeSlots);
      
      const fetchedInterviewers = data.interviewers || [];
      setInterviewers(fetchedInterviewers);
      
      // Sanitizing notes data
      const rawNotes = data.notes || [];
      const validNotes: DayNote[] = rawNotes.map((n: any) => {
        const colorInput = String(n.color || 'yellow');
        const validColors = ['yellow', 'blue', 'green', 'red', 'purple'];
        const finalColor = (validColors.includes(colorInput) ? colorInput : 'yellow') as NoteColor;
        
        return {
          date: String(n.date),
          content: String(n.content),
          color: finalColor
        };
      });
      setDayNotes(validNotes);
      
      // FIX: Ensure new interviewers found during sync are automatically selected
      setSelectedInterviewerIds(prev => {
         const newSet = new Set(prev);
         if (newSet.size === 0) {
            // Initial load or nothing selected: select all
            fetchedInterviewers.forEach((i: Interviewer) => newSet.add(i.id));
         } else {
            // If already managing selection, check for *newly* added interviewers on server
            // We assume if an interviewer wasn't in state before, they should be shown.
            const existingKnownIds = interviewers.map(i => i.id);
            fetchedInterviewers.forEach((i: Interviewer) => {
               if (!existingKnownIds.includes(i.id)) {
                  newSet.add(i.id);
               }
            });
         }
         return newSet;
      });

    } catch (e: any) {
      console.error("Fetch Error", e);
      // Only alert if manual sync
      if (showSyncState) alert(`同步失敗: ${e.message}`);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  // Helper to sync an interviewer if needed
  const ensureInterviewerExists = async (inv: Interviewer) => {
     try {
       await fetch('/api/interviewers', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(inv)
       });
     } catch (e) {
       console.error("Failed to sync interviewer", e);
     }
  };

  // Initial Load
  useEffect(() => {
    fetchData();
  }, []);

  const timeToMins = (t: string) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const handleAIScheduleConfirm = async (parsedSlots: ParsedSlot[]) => {
    setIsSaving(true);
    let currentInterviewers = [...interviewers];
    const newSlots: AvailabilitySlot[] = [];
    const createdInterviewerIds = new Set<string>();

    for (const ps of parsedSlots) {
      const rawName = ps.interviewerName;
      const trimmedName = rawName.trim();
      let inv = currentInterviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());

      if (!inv) {
        inv = {
          id: generateUUID(),
          name: trimmedName,
          color: INTERVIEWER_COLORS[currentInterviewers.length % INTERVIEWER_COLORS.length]
        };
        currentInterviewers.push(inv);
        createdInterviewerIds.add(inv.id);
        await ensureInterviewerExists(inv);
      }

      newSlots.push({
        id: generateUUID(),
        interviewerId: inv.id,
        date: ps.date,
        startTime: ps.startTime,
        endTime: ps.endTime,
        isBooked: false
      });
    }

    setInterviewers(currentInterviewers);
    // Optimistic Update
    setSlots(prev => [...prev, ...newSlots]);
    
    if (createdInterviewerIds.size > 0) {
      setSelectedInterviewerIds(prev => {
        const next = new Set(prev);
        createdInterviewerIds.forEach(id => next.add(id));
        return next;
      });
    }

    try {
       await fetch('/api/slots/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSlots)
       });
    } catch (e) {
       console.error("Batch save failed", e);
       alert("批量儲存失敗");
       // Only fetch on error
       fetchData();
    } finally {
       setIsSaving(false);
    }
  };

  // New Function for Batch Manual Add
  const handleBatchManualConfirm = async (data: { name: string; dates: string[]; timeRanges: { startTime: string; endTime: string }[] }) => {
    setIsSaving(true);
    let currentInterviewers = [...interviewers];
    const trimmedName = data.name.trim();
    
    // 1. Find or Create Interviewer
    let inv = currentInterviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());
    let isNewInterviewer = false;

    if (!inv) {
      inv = {
        id: generateUUID(),
        name: trimmedName,
        color: INTERVIEWER_COLORS[currentInterviewers.length % INTERVIEWER_COLORS.length]
      };
      currentInterviewers.push(inv);
      isNewInterviewer = true;
      await ensureInterviewerExists(inv);
    }

    // 2. Generate Slots
    const newSlots: AvailabilitySlot[] = [];
    data.dates.forEach(date => {
      data.timeRanges.forEach(range => {
        newSlots.push({
          id: generateUUID(),
          interviewerId: inv!.id,
          date: date,
          startTime: range.startTime,
          endTime: range.endTime,
          isBooked: false
        });
      });
    });

    // 3. Update State
    setInterviewers(currentInterviewers);
    setSlots(prev => [...prev, ...newSlots]);
    
    if (isNewInterviewer || !selectedInterviewerIds.has(inv.id)) {
      setSelectedInterviewerIds(prev => new Set(prev).add(inv!.id));
    }

    // 4. API Call
    try {
       await fetch('/api/slots/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSlots)
       });
    } catch (e) {
       console.error("Batch manual save failed", e);
       alert("批量儲存失敗");
       fetchData();
    } finally {
       setIsSaving(false);
    }
  };

  const handleSaveSlot = async (slotData: Partial<AvailabilitySlot>, interviewerName: string) => {
    setIsSaving(true);
    const trimmedName = interviewerName.trim();
    let inv = interviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());
    let nextInterviewers = [...interviewers];

    if (!inv) {
       inv = {
          id: generateUUID(),
          name: trimmedName,
          color: INTERVIEWER_COLORS[interviewers.length % INTERVIEWER_COLORS.length]
       };
       nextInterviewers.push(inv);
       setInterviewers(nextInterviewers);
       setSelectedInterviewerIds(prev => new Set([...prev, inv!.id]));
       await ensureInterviewerExists(inv);
    } else {
       // Ensure existing interviewer is selected (visible)
       setSelectedInterviewerIds(prev => {
          const next = new Set(prev);
          next.add(inv!.id);
          return next;
       });
    }
    
    try {
      if (slotData.id) {
        const existingSlot = slots.find(s => s.id === slotData.id);
        if (existingSlot) {
            // Check if we need to split the slot (e.g. Booking a sub-range)
            const oldStart = timeToMins(existingSlot.startTime);
            const oldEnd = timeToMins(existingSlot.endTime);
            const newStart = slotData.startTime ? timeToMins(slotData.startTime) : oldStart;
            const newEnd = slotData.endTime ? timeToMins(slotData.endTime) : oldEnd;

            // Condition: New range is strictly smaller than old range (Splitting scenario)
            if (newStart >= oldStart && newEnd <= oldEnd && (newStart > oldStart || newEnd < oldEnd)) {
                
                const remainders: AvailabilitySlot[] = [];
                // CRITICAL: When splitting, the remainders usually inherit the ORIGINAL availability (usually Available/false)
                // If we are booking a part, the rest stays available.
                const originalStatus = false; // Force remainders to be Available for now to solve "Both Booked" issue
                
                // 1. Create Head Remainder (if any)
                if (newStart > oldStart) {
                    remainders.push({
                        ...existingSlot,
                        id: generateUUID(),
                        startTime: existingSlot.startTime, // Start at original start
                        endTime: slotData.startTime!,      // End at new booking start
                        isBooked: originalStatus, 
                        interviewerId: inv!.id
                    });
                }

                // 2. Create Tail Remainder (if any)
                if (newEnd < oldEnd) {
                    remainders.push({
                        ...existingSlot,
                        id: generateUUID(),
                        startTime: slotData.endTime!,     // Start at new booking end
                        endTime: existingSlot.endTime,    // End at original end
                        isBooked: originalStatus,
                        interviewerId: inv!.id
                    });
                }

                // 3. Update the Main Slot to be the "edited" part (The Booked Part)
                const updatedMainSlot = { 
                    ...existingSlot, 
                    ...slotData, 
                    isBooked: !!slotData.isBooked, // Explicit boolean conversion
                    interviewerId: inv!.id 
                } as AvailabilitySlot;

                // Optimistic Update
                setSlots(prev => {
                    const filtered = prev.filter(s => s.id !== slotData.id);
                    return [...filtered, updatedMainSlot, ...remainders];
                });

                // API Calls: Update Main, Create Remainders
                await Promise.all([
                    fetch(`/api/slots/${updatedMainSlot.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updatedMainSlot)
                    }),
                    remainders.length > 0 && fetch('/api/slots/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(remainders)
                    })
                ]);

            } else {
                // Normal Update (Full slot update or expansion)
                const updatedSlot = { 
                  ...existingSlot, 
                  ...slotData, 
                  isBooked: !!slotData.isBooked,
                  interviewerId: inv!.id 
                } as AvailabilitySlot;
                
                setSlots(prev => prev.map(s => s.id === slotData.id ? updatedSlot : s));

                await fetch(`/api/slots/${updatedSlot.id}`, {
                   method: 'PUT',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify(updatedSlot)
                });
            }
        }
      } else {
        // New Slot
        const newSlot: AvailabilitySlot = {
          id: generateUUID(),
          interviewerId: inv!.id,
          date: slotData.date!,
          startTime: slotData.startTime!,
          endTime: slotData.endTime!,
          isBooked: !!slotData.isBooked
        };
        
        setSlots(prev => [...prev, newSlot]);

        await fetch('/api/slots', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(newSlot)
        });
      }
    } catch (e) {
      console.error("Save slot error", e);
      alert("儲存失敗");
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSlot = async (id: string, targetStart: string, targetEnd: string) => {
    setIsSaving(true);
    setIsEditorOpen(false);

    const parentSlot = slots.find(s => s.id === id);
    if (!parentSlot) {
      setIsSaving(false);
      return;
    }

    const pStart = parentSlot.startTime;
    const pEnd = parentSlot.endTime;

    // Check if it's a full delete or fallback if args missing
    if ((!targetStart && !targetEnd) || (targetStart === pStart && targetEnd === pEnd)) {
      setSlots(prev => prev.filter(s => s.id !== id));
      try {
         await fetch(`/api/slots/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Delete failed", e);
        fetchData();
      }
    } 
    // Case: Delete Head (Trim Start)
    else if (targetStart === pStart && targetEnd < pEnd) {
      const updatedSlot = { ...parentSlot, startTime: targetEnd };
      setSlots(prev => prev.map(s => s.id === id ? updatedSlot : s));
      try {
        await fetch(`/api/slots/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedSlot) });
      } catch(e) { fetchData(); }
    }
    // Case: Delete Tail (Trim End)
    else if (targetEnd === pEnd && targetStart > pStart) {
      const updatedSlot = { ...parentSlot, endTime: targetStart };
      setSlots(prev => prev.map(s => s.id === id ? updatedSlot : s));
      try {
        await fetch(`/api/slots/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedSlot) });
      } catch(e) { fetchData(); }
    }
    // Case: Delete Middle (Split)
    else if (targetStart > pStart && targetEnd < pEnd) {
      const updatedPart1 = { ...parentSlot, endTime: targetStart };
      const newPart2 = {
        ...parentSlot,
        id: generateUUID(),
        startTime: targetEnd,
        endTime: pEnd
      };

      setSlots(prev => prev.map(s => s.id === id ? updatedPart1 : s).concat(newPart2));
      
      try {
        await Promise.all([
          fetch(`/api/slots/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedPart1) }),
          fetch(`/api/slots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPart2) })
        ]);
      } catch(e) { fetchData(); }
    }

    setIsSaving(false);
  };

  const handleSaveNote = async (date: string, content: string, color: NoteColor = 'yellow') => {
    setIsSaving(true);
    const newNote: DayNote = { date, content, color: color as NoteColor };

    // Optimistic Update: Update UI immediately
    setDayNotes(prev => {
        const filtered = prev.filter(n => n.date !== date);
        return content.trim() ? [...filtered, newNote] : filtered;
    });

    try {
      await fetch('/api/notes', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(newNote)
      });
    } catch (e) {
      console.error("Note save failed", e);
      fetchData(); // Sync on error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyNote = (e: React.MouseEvent, note: DayNote) => {
    e.stopPropagation();
    setClipboardNote({ content: note.content, color: note.color || 'yellow' });
  };

  // Improved Type-Safe Paste Function using Generics
  const handlePasteNote = (date: Date) => {
    if (clipboardNote) {
      // 使用泛型輔助函數來解決類型問題
      const getValidColor = <T extends string>(color: T | undefined): NoteColor => {
        const validColors = ['yellow', 'blue', 'green', 'red', 'purple'] as const;
        if (color && (validColors as readonly string[]).includes(color)) {
          return color as NoteColor;
        }
        return 'yellow';
      };
      
      const noteColor: NoteColor = getValidColor(clipboardNote.color);
      handleSaveNote(format(date, 'yyyy-MM-dd'), clipboardNote.content, noteColor);
    }
  };

  const handleDeleteNote = async (date: string) => {
    setIsSaving(true);
    // Optimistic Delete
    setDayNotes(prev => prev.filter(n => n.date !== date));

    try {
      await fetch(`/api/notes/${date}`, { method: 'DELETE' });
    } catch (e) {
      console.error("Note delete failed", e);
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const openNoteEditor = (date: Date) => {
    setEditingNoteDate(date);
    setIsNoteModalOpen(true);
  };

  const toggleInterviewerFilter = (id: string) => {
    setSelectedInterviewerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const uniqueInterviewersForDisplay = useMemo(() => {
    const seen = new Set();
    const activeIds = new Set<string>();
    slots.forEach(s => {
      if (!s.date) return;
      const sDate = parse(s.date, 'yyyy-MM-dd', new Date());
      if (isValid(sDate) && isSameMonth(sDate, currentDate)) activeIds.add(s.interviewerId);
    });
    return interviewers.filter(inv => {
      if (!activeIds.has(inv.id)) return false;
      const lowerName = inv.name.toLowerCase().trim();
      if (seen.has(lowerName)) return false;
      seen.add(lowerName);
      return true;
    });
  }, [interviewers, slots, currentDate]);

  const splitSlotsForDisplay = (daySlots: (AvailabilitySlot & { interviewer: Interviewer })[]) => {
    const result: (AvailabilitySlot & { interviewer: Interviewer })[] = [];
    daySlots.forEach(slot => {
      if (!slot.startTime || !slot.endTime) {
        result.push(slot);
        return;
      }
      
      const startTime = parse(slot.startTime, 'HH:mm', new Date());
      const endTime = parse(slot.endTime, 'HH:mm', new Date());
      
      if (!isValid(startTime) || !isValid(endTime)) {
        result.push(slot);
        return;
      }
      
      // Safety check: prevent infinite loops
      if (startTime >= endTime) {
        result.push(slot);
        return;
      }
      
      let current = startTime;
      let safety = 0;
      while (current < endTime && safety < 50) {
        const next = addMinutes(current, 30);
        if (next > endTime) break;
        result.push({
          ...slot,
          originalId: slot.id, 
          id: `${slot.id}__${format(current, 'HHmm')}`, 
          startTime: format(current, 'HH:mm'),
          endTime: format(next, 'HH:mm'),
        });
        current = next;
        safety++;
      }
      
      if (result.length === 0) result.push(slot);
    });
    return result;
  };

  const calendarDays: DayInfo[] = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: startDate, end: endDate }).map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const daySlotsRaw = slots
        .filter(s => s.date === dateStr && selectedInterviewerIds.has(s.interviewerId))
        .map(s => {
           const inv = interviewers.find(i => i.id === s.interviewerId);
           if (!inv) return null;
           return { ...s, interviewer: inv };
        })
        .filter((s): s is (AvailabilitySlot & { interviewer: Interviewer }) => s !== null);

      const displayedSlots = splitSlotsForDisplay(daySlotsRaw);
      return { date, isCurrentMonth: isSameMonth(date, monthStart), slots: displayedSlots, note: dayNotes.find(n => n.date === dateStr) };
    });
  }, [currentDate, slots, interviewers, selectedInterviewerIds, dayNotes]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">正在從 Google Sheets 載入資料...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col font-tc">
      <header className="no-print bg-white border-b border-gray-200 sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-blue-500">面試排程助理</h1>
            {isSaving && <span className="text-[10px] text-blue-400 animate-pulse font-medium">雲端同步中...</span>}
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => fetchData(true)} isLoading={isSyncing} className="border border-gray-200">
            <svg className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357-2H15"></path></svg>
            同步
          </Button>
          <Button variant="secondary" onClick={() => exportToExcel(currentDate, slots, interviewers, dayNotes)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M7 10l5 5m0 0l5-5m-5 5V3"></path></svg>
            Excel
          </Button>
          <Button variant="secondary" onClick={() => setIsStatsModalOpen(true)}>
             <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
             統計
          </Button>
          <div className="h-8 w-[1px] bg-gray-200 mx-1 self-center hidden md:block"></div>
          
          <Button variant="success" onClick={() => setIsBatchAddModalOpen(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z"></path></svg>
            批量新增
          </Button>

          <Button variant="success" onClick={() => { setEditingSlot(undefined); setIsEditorOpen(true); }}>
             <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
             新增時段
          </Button>
          
          <Button variant="primary" onClick={() => setIsAIModalOpen(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            AI 輸入
          </Button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <aside className="no-print w-full md:w-64 bg-gray-50 border-r border-gray-200 p-6 flex flex-col gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">本月面試員 ({uniqueInterviewersForDisplay.length})</h3>
              <button 
                onClick={() => setShowNames(!showNames)}
                className="text-[10px] bg-gray-200 px-2 py-0.5 rounded-full hover:bg-gray-300 transition-colors"
              >
                {showNames ? '隱藏名稱' : '顯示名稱'}
              </button>
            </div>
            <div className="space-y-1">
              {uniqueInterviewersForDisplay.map(inv => (
                <button
                  key={inv.id}
                  onClick={() => toggleInterviewerFilter(inv.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                    selectedInterviewerIds.has(inv.id) ? 'bg-white shadow-sm' : 'hover:bg-gray-100'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: inv.color }} />
                  <span className={`flex-1 text-left ${selectedInterviewerIds.has(inv.id) ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                    {inv.name}
                  </span>
                  {selectedInterviewerIds.has(inv.id) && (
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path></svg>
                  )}
                </button>
              ))}
              {uniqueInterviewersForDisplay.length === 0 && <p className="text-sm text-gray-400 italic">本月暫無面試資料</p>}
            </div>
          </div>
          
          <div className="mt-auto pt-6 border-t border-gray-200">
            <div className="text-[11px] text-gray-400 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full border border-gray-300 bg-white" /> <span>可面試</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-200 ring-1 ring-gray-400" /> <span>已預約</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-gray-50 p-4 md:p-8">
          <div className="max-w-6xl mx-auto space-y-6 bg-gray-50 p-4 rounded-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-gray-800">{format(currentDate, 'yyyy年 MMMM')}</h2>
              <div className="no-print flex bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 hover:bg-gray-50 border-r border-gray-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 text-sm font-medium hover:bg-gray-50">返回今天</button>
                <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 hover:bg-gray-50 border-l border-gray-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
                {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                  <div key={day} className="py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">星期{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => (
                  <div
                    key={idx}
                    className={`min-h-[140px] border-r border-b border-gray-100 p-2 flex flex-col gap-1 transition-colors hover:bg-gray-50/50 relative group/cell ${
                      !day.isCurrentMonth ? 'bg-gray-50/50 opacity-40' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${
                        isSameDay(day.date, new Date()) ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400'
                      }`}>
                        {format(day.date, 'd')}
                      </span>
                      
                      <div className="flex gap-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                         {clipboardNote && (
                           <button 
                             onClick={(e) => { e.stopPropagation(); handlePasteNote(day.date); }}
                             className="p-1 rounded text-gray-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                             title="貼上備註"
                           >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
                           </button>
                         )}
                         <button 
                           onClick={(e) => { e.stopPropagation(); openNoteEditor(day.date); }}
                           className={`p-1 rounded ${day.note ? 'text-blue-500 opacity-100' : 'text-gray-300 hover:text-blue-500'}`}
                           title="編輯備註"
                         >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                         </button>
                      </div>
                    </div>

                    {day.note && (
                      <div 
                        onClick={(e) => { e.stopPropagation(); openNoteEditor(day.date); }}
                        className={`group/note relative mb-2 text-xs p-1.5 rounded border break-words whitespace-pre-wrap cursor-pointer hover:shadow-sm transition-shadow ${day.note.color ? NOTE_STYLES[day.note.color] : NOTE_STYLES.yellow}`}
                      >
                        {day.note.content}
                        <button
                           onClick={(e) => handleCopyNote(e, day.note!)}
                           className="absolute top-1 right-1 p-0.5 rounded-full bg-white/50 hover:bg-white text-gray-500 hover:text-blue-600 opacity-0 group-hover/note:opacity-100 transition-opacity"
                           title="複製備註"
                        >
                           <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                        </button>
                      </div>
                    )}

                    <div className="flex-1 flex flex-row flex-wrap gap-1 overflow-y-auto max-h-48 content-start">
                      {day.slots.map(slot => (
                        <div
                          key={slot.id}
                          onClick={(e) => { 
                            e.stopPropagation();
                            const realId = slot.originalId || slot.id.split('__')[0];
                            const originalSlot = slots.find(s => s.id === realId);
                            if (originalSlot) {
                              setEditingSlot({ ...originalSlot, startTime: slot.startTime, endTime: slot.endTime, id: realId, interviewer: slot.interviewer }); 
                              setIsEditorOpen(true); 
                            }
                          }}
                          style={{ borderLeftColor: slot.interviewer.color, backgroundColor: slot.isBooked ? '#f3f4f6' : hexToRgba(slot.interviewer.color, 0.1), opacity: slot.isBooked ? 0.7 : 1 }}
                          className={`text-[10px] leading-tight p-1 rounded-r border-l-[3px] shadow-sm ring-1 ring-black/5 cursor-pointer hover:shadow transition-all group flex-grow basis-[calc(100%)] xl:basis-[calc(50%-4px)] ${slot.isBooked ? 'grayscale-[0.5]' : ''}`}
                        >
                          <div className="flex justify-between items-start">
                            {showNames && <div className={`font-bold truncate ${slot.isBooked ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{slot.interviewer.name}</div>}
                            {slot.isBooked && <span className="bg-gray-200 text-gray-600 px-1 rounded text-[8px] uppercase font-bold">已預約</span>}
                          </div>
                          <div className="text-gray-500 font-medium">{slot.startTime}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      <AIInputModal isOpen={isAIModalOpen} onClose={() => setIsAIModalOpen(false)} onConfirm={handleAIScheduleConfirm} />
      <SlotEditorModal isOpen={isEditorOpen} onClose={() => { setIsEditorOpen(false); setEditingSlot(undefined); }} onSave={handleSaveSlot} onDelete={handleDeleteSlot} initialSlot={editingSlot} />
      <BatchAddModal isOpen={isBatchAddModalOpen} onClose={() => setIsBatchAddModalOpen(false)} onConfirm={handleBatchManualConfirm} existingInterviewers={interviewers} />
      <NoteEditorModal isOpen={isNoteModalOpen} onClose={() => setIsNoteModalOpen(false)} onSave={handleSaveNote} onDelete={handleDeleteNote} date={editingNoteDate} initialNote={editingNoteDate ? dayNotes.find(n => n.date === format(editingNoteDate, 'yyyy-MM-dd')) : undefined} />
      <StatisticsModal isOpen={isStatsModalOpen} onClose={() => setIsStatsModalOpen(false)} slots={slots} interviewers={interviewers} currentDate={currentDate} />
    </div>
  );
};

// Wrap AppContent with ErrorBoundary
const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
};

export default App;