// @ts-ignore
import XLSX from 'xlsx-js-style';
import { AvailabilitySlot, Interviewer, DayNote } from '../types';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, parse, addMinutes } from 'date-fns';
import { generateTimeSlots } from '../constants';

export const exportToExcel = (
  month: Date,
  slots: AvailabilitySlot[],
  interviewers: Interviewer[],
  notes: DayNote[]
) => {
  const workbook = XLSX.utils.book_new();
  const timeSlots = generateTimeSlots();
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  
  // --- Sheet 1: Calendar View (Visual Layout) ---
  const calendarSheetData: any[][] = [];
  
  // Title Row
  calendarSheetData.push([`${format(month, 'MMMM yyyy')}`]);
  
  // Weekday Headers
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  calendarSheetData.push(daysOfWeek);

  // Generate Calendar Days
  const calendarStartDate = startOfWeek(monthStart);
  const calendarEndDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStartDate, end: calendarEndDate });

  let currentWeekCells: string[] = [];
  
  calendarDays.forEach((day, index) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayLabel = format(day, 'd');
    const isCurrent = isSameMonth(day, month);
    
    let cellContent = "";

    if (isCurrent) {
        cellContent += `${dayLabel}\n\n`;

        // Note
        const note = notes.find(n => n.date === dateStr)?.content || '';
        if (note) {
          cellContent += `[${note}]\n`;
        }
        
        // Slots
        const daySlots = slots
          .filter(s => s.date === dateStr)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));

        if (daySlots.length > 0) {
          daySlots.forEach(s => {
            const inv = interviewers.find(i => i.id === s.interviewerId);
            const invName = inv ? inv.name : '未知';
            cellContent += `${invName} (${s.startTime})\n`;
          });
        }
    } else {
        cellContent = ""; 
    }

    currentWeekCells.push(cellContent);

    if ((index + 1) % 7 === 0) {
      calendarSheetData.push(currentWeekCells);
      currentWeekCells = [];
    }
  });

  const calendarSheet = XLSX.utils.aoa_to_sheet(calendarSheetData);
  
  // --- Styling Logic ---
  const range = XLSX.utils.decode_range(calendarSheet['!ref']);
  
  const borderStyle = {
    top: { style: "thin", color: { rgb: "000000" } },
    bottom: { style: "thin", color: { rgb: "000000" } },
    left: { style: "thin", color: { rgb: "000000" } },
    right: { style: "thin", color: { rgb: "000000" } }
  };

  const titleStyle = {
    font: { sz: 14, bold: true, name: "Arial" },
    alignment: { horizontal: "center", vertical: "center" }
  };

  const headerStyle = {
    fill: { fgColor: { rgb: "EFEFEF" } }, // Light Gray
    font: { bold: true, name: "Arial" },
    border: borderStyle,
    alignment: { horizontal: "center", vertical: "center" }
  };

  const cellStyle = {
    border: borderStyle,
    alignment: { vertical: "top", wrapText: true, horizontal: "left" },
    font: { name: "Arial", sz: 10 }
  };

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      
      // Ensure cell exists to apply border
      if (!calendarSheet[cellAddress]) {
        calendarSheet[cellAddress] = { t: 's', v: '' };
      }
      
      const cell = calendarSheet[cellAddress];

      if (R === 0) {
        cell.s = titleStyle;
      } else if (R === 1) {
        cell.s = headerStyle;
      } else {
        cell.s = cellStyle;
      }
    }
  }

  // Column widths
  calendarSheet['!cols'] = daysOfWeek.map(() => ({ wch: 25 }));
  
  // Merge Title Row
  calendarSheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } } 
  ];

  XLSX.utils.book_append_sheet(workbook, calendarSheet, 'Calendar');

  // --- Sheet 2: Timeline ---
  const summaryData: any[] = [];
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  const headerRow = ['時間', ...monthDays.map(d => format(d, 'MM/dd'))];
  summaryData.push(headerRow);

  timeSlots.forEach(time => {
    const row = [time];
    monthDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const activeSlots = slots.filter(s => {
        if (s.date !== dateStr) return false;
        return s.startTime <= time && s.endTime > time;
      });
      
      const statusInfo = activeSlots.map(s => {
        const inv = interviewers.find(i => i.id === s.interviewerId);
        const name = inv ? inv.name : '未知';
        const status = s.isBooked ? '已預約' : '可面試';
        return `${name}(${status})`;
      });
      
      row.push(statusInfo.join(', '));
    });
    summaryData.push(row);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  // Narrower columns for Timeline (wch 12 instead of 20)
  const timelineCols = [{ wch: 10 }, ...monthDays.map(() => ({ wch: 12 }))];
  summarySheet['!cols'] = timelineCols;
  
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Timeline');

  // --- Sheet 3: Raw Data (Split into 30 min intervals) ---
  const rawData: any[] = [];
  
  // Sort for better readability
  const sortedSlots = [...slots].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
  });

  sortedSlots.forEach(s => {
    const inv = interviewers.find(i => i.id === s.interviewerId);
    
    // Parse start and end times to support splitting
    const baseDate = new Date(); // Dummy date for time parsing
    let current = parse(s.startTime, 'HH:mm', baseDate);
    const end = parse(s.endTime, 'HH:mm', baseDate);

    while (current < end) {
        const next = addMinutes(current, 30);
        // Safety check to ensure we don't exceed the slot's actual end time
        if (next > end) break;

        rawData.push({
          '面試員': inv?.name || '未知',
          '日期': s.date,
          '開始時間': format(current, 'HH:mm'),
          '結束時間': format(next, 'HH:mm'),
          '狀態': s.isBooked ? '已預約' : '可面試'
        });

        current = next;
    }
  });

  const rawSheet = XLSX.utils.json_to_sheet(rawData);
  XLSX.utils.book_append_sheet(workbook, rawSheet, 'Raw Data');

  // Trigger Download
  XLSX.writeFile(workbook, `Interview_Schedule_${format(month, 'yyyy_MM')}.xlsx`);
};