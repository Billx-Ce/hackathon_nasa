// URL choice wins over the saved preference. Never send preferences to a service.
const url = new URL(location.href);
let saved;
try { saved = localStorage.getItem('analog-language'); } catch {}
const explicit = url.searchParams.get('lang');
const current = document.documentElement.lang;
if (!explicit && saved === 'en' && current !== 'en') {
  url.searchParams.set('lang', 'en');
  location.replace(url);
} else {
  const label = document.createElement('label');
  label.className = 'language-picker';
  label.textContent = current === 'en' ? 'Language ' : 'Idioma ';
  const select = document.createElement('select');
  select.id = 'language';
  select.setAttribute('aria-label', current === 'en' ? 'Interface language' : 'Idioma de la interfaz');
  for (const [code, name] of [['es', 'Español'], ['en', 'English']]) {
    const option = new Option(name, code, false, current === code);
    select.append(option);
  }
  select.addEventListener('change', () => {
    try { localStorage.setItem('analog-language', select.value); } catch {}
    url.searchParams.set('lang', select.value);
    const candidate = document.getElementById('candidate');
    if (candidate?.value) url.searchParams.set('candidate', candidate.value);
    location.assign(url);
  });
  label.append(select);
  document.querySelector('header').append(label);
  if (explicit === 'en' || explicit === 'es') {
    try { localStorage.setItem('analog-language', explicit); } catch {}
  }
}
