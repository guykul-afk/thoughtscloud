export interface ExtractedQuote {
  text: string;
  source?: string;
  contexts?: string[];
}

export function parseQuotesFromTranscript(transcript: string): ExtractedQuote[] {
  if (!transcript) return [];
  
  const results: ExtractedQuote[] = [];
  const normalized = transcript.replace(/[\u200e\u200f]/g, '');

  // 1. Check for standard quotation marks: "...", “...”, ”...”, ״...״
  const quoteRegex = /["“”״]([^"“”״]{3,})["“”״]/g;
  let match;
  while ((match = quoteRegex.exec(normalized)) !== null) {
    const quoteText = match[1].trim();
    if (quoteText) {
      results.push({
        text: quoteText,
        contexts: []
      });
    }
  }

  // 2. Check for curly single quotes ‘...’ or ’...’ or straight single quotes '...'
  // Only match if the text inside contains at least one space (more than one word)
  // to avoid matching Hebrew contractions (e.g. משהו כמו ג'ק או משהו'לוגי)
  const singleQuoteRegex = /['‘’]([^'‘’]{5,})['‘’]/g;
  while ((match = singleQuoteRegex.exec(normalized)) !== null) {
    const quoteText = match[1].trim();
    if (quoteText && quoteText.includes(' ')) {
      // Check if already captured by double quotes to avoid duplicates
      if (!results.some(r => r.text === quoteText)) {
        results.push({
          text: quoteText,
          contexts: []
        });
      }
    }
  }

  // 3. Check for explicit "ציטוט:" prefix
  const explicitRegex = /(?:ציטוט|הציטוט)\s*:\s*([^\n.]{5,})/gi;
  while ((match = explicitRegex.exec(normalized)) !== null) {
    const quoteText = match[1].trim();
    if (quoteText) {
      // Check if already captured to avoid duplicates
      if (!results.some(r => r.text === quoteText)) {
        results.push({
          text: quoteText,
          contexts: []
        });
      }
    }
  }

  return results;
}
