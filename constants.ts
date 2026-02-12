
export const INTERVIEWER_COLORS = [
  '#3B82F6', // blue-500
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#06B6D4', // cyan-500
  '#F97316', // orange-500
  '#6366F1', // indigo-500
  '#84CC16', // lime-500
];

export const TIME_RANGE_START = 9; // 9:00 AM
export const TIME_RANGE_END = 22; // 10:00 PM
export const TIME_STEP_MINUTES = 30;

export const generateTimeSlots = () => {
  const slots: string[] = [];
  for (let hour = TIME_RANGE_START; hour <= TIME_RANGE_END; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
    if (hour < TIME_RANGE_END) {
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }
  }
  return slots;
};
