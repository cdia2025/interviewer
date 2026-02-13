
import { ParsedSlot } from "../types";

// This service now calls our own backend which uses DeepSeek
export const parseSchedulingText = async (text: string): Promise<ParsedSlot[]> => {
  try {
    const response = await fetch('/api/ai-parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        currentYear: new Date().getFullYear()
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }

    const data = await response.json();
    return data as ParsedSlot[];
  } catch (error) {
    console.error("AI Parsing Error:", error);
    throw new Error("Failed to parse scheduling text via DeepSeek.");
  }
};