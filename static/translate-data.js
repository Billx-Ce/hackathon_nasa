// Translate display values only. API field names, numbers and identifiers are preserved.
const response = await fetch('/static/translations.en.json');
if (!response.ok) throw new Error('Could not load English translations.');
const entries = Object.entries(await response.json()).sort((a,b)=>b[0].length-a[0].length);
export function translateData(value) {
  if (typeof value === 'string') {
    for (const [source, target] of entries) value = value.split(source).join(target);
    return value;
  }
  if (Array.isArray(value)) return value.map(translateData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,translateData(item)]));
  return value;
}
