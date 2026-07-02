const stopwords = new Set([
  'הרבה', 'כצפוי', 'מילים', 'חודשיים', 'מאוד', 'קצת', 'כמו', 'אחרי', 'לפני', 'על', 'אל',
  'עם', 'את', 'של', 'זה', 'הוא', 'היא', 'הם', 'הן', 'אני', 'אנחנו', 'אתה', 'אתם', 'כן', 'לא',
  'כדי', 'כל', 'רק', 'עוד', 'כבר', 'בין', 'שוב', 'אך', 'אפילו', 'אלא', 'אולי', 'אבל'
]);

export function cleanEntityName(name: string): string {
  let clean = (name || '').trim();
  if (!clean) return '';

  // Remove leading/trailing quotes or brackets
  clean = clean.replace(/^["'\[\(]+|["'\]\)]+$/g, '').trim();

  // Basic Hebrew morphological normalization:
  // Remove ה הידיעה if the word starts with 'ה' and length > 3 (e.g. הבית -> בית)
  if (clean.startsWith('ה') && clean.length > 3) {
    clean = clean.substring(1);
  }

  return clean;
}

export function isStopwordOrInvalid(name: string): boolean {
  const clean = name.trim().toLowerCase();
  
  // Reject empty or very short strings
  if (!clean || clean.length < 2) return true;
  
  // Reject stopwords
  if (stopwords.has(clean)) return true;
  
  // Reject single generic words that don't have enough context (unless it is a known family name or self)
  const exceptions = new Set(['גיא', 'טלי', 'גיל', 'איתן', 'נוה']);
  if (clean.split(/\s+/).length === 1 && !exceptions.has(clean) && clean.length < 3) {
    return true; // Single generic short words are ignored
  }

  return false;
}
