import { ParsedSlot } from "../types";

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
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.details || errorData.error || `Server error: ${response.statusText}`);
    }

    const data = await response.json();
    return data as ParsedSlot[];
  } catch (error: any) {
    console.error("AI Parsing Error:", error);
    throw new Error(error.message || "Failed to parse scheduling text.");
  }
};