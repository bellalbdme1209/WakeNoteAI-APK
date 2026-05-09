import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export const generateSpeech = async (text: string, voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Kore'): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  } catch (error) {
    console.error("TTS error:", error);
    return "";
  }
};

export const transcribeAudio = async (base64Audio: string): Promise<string> => {
  try {
    // Remove data:audio/wav;base64, prefix if present
    const cleanBase64 = base64Audio.includes(",") ? base64Audio.split(",")[1] : base64Audio;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: cleanBase64,
          },
        },
        {
          text: "Please transcribe this audio accurately. If it is empty or noise, return an empty string. Only return the transcription.",
        },
      ],
    });
    
    return response.text || "";
  } catch (error) {
    console.error("Transcription error:", error);
    return "";
  }
};

export const generateMotivation = async (prompt: string, tone: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: `You are a highly effective life coach. The user wants a short, powerful motivational message to wake up to. The tone should be ${tone}. Keep it under 200 characters.`,
      },
    });
    
    return response.text || "Rise and shine!";
  } catch (error) {
    console.error("Motivation generation error:", error);
    return "Time to seize the day!";
  }
};

export const parseCommandWithAI = async (command: string): Promise<{ action: string; params?: any }> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: command,
      config: {
        systemInstruction: "You are an assistant for an alarm app. Interpret the user's command and return a JSON object with 'action' and optional 'params'. Actions: SET_ALARM (params: hour, minute, period, label, noteContent, noteType), CANCEL_ALL, LIST_ALARMS. Example: 'Set alarm for 7am with a note to go to gym' -> { action: 'SET_ALARM', params: { hour: 7, minute: 0, period: 'AM', label: 'Gym', noteContent: 'Go to gym', noteType: 'text' } }",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: ["SET_ALARM", "CANCEL_ALL", "LIST_ALARMS", "UNKNOWN"] },
            params: {
              type: Type.OBJECT,
              properties: {
                hour: { type: Type.NUMBER },
                minute: { type: Type.NUMBER },
                period: { type: Type.STRING, enum: ["AM", "PM"] },
                label: { type: Type.STRING },
                noteContent: { type: Type.STRING },
                noteType: { type: Type.STRING, enum: ["text", "none"] }
              }
            }
          },
          required: ["action"]
        }
      },
    });
    
    return JSON.parse(response.text || '{"action": "UNKNOWN"}');
  } catch (error) {
    console.error("Command parsing error:", error);
    return { action: "UNKNOWN" };
  }
};
