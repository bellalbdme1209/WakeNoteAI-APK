
export const parseVoiceCommand = (text: string) => {
  const lower = text.toLowerCase();
  
  if (lower.includes("cancel all alarms")) {
    return { action: 'CANCEL_ALL' };
  }

  if (lower.includes("set alarm for")) {
    // Basic parser for "set alarm for X"
    // e.g. "set alarm for 7 am"
    const timeMatch = lower.match(/set alarm for (\d+)\s*(am|pm)?/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const period = timeMatch[2] || 'AM';
      return { action: 'SET_ALARM', params: { hour, period } };
    }
  }

  return { action: 'UNKNOWN' };
};
